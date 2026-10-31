import { editorDocumentSchema, type EditorDocument } from '../editor/model'
import { decodeStoredEditorDocument, sameRepositoryToken, type RepositoryToken, type StoredEditorDocument } from './editor-repository'
import { openStorageDatabase } from './storage'
import { countDocumentCells, DRAFT_STORES, DraftConflict, draftHeadSchema, MAX_DRAFT_BYTES, MAX_DRAFTS, notifyRecoveryChanged, retired, retireDraft, sameDraft, type DraftHead, type DraftIdentity } from './draft-storage'

export type DraftWrite = DraftIdentity & { document: EditorDocument; revision: number; base: RepositoryToken | null; componentAssetId?: string }
export type DraftListing = { records: DraftHead[]; issues: string[] }
export type RecoveredDraft = { head: DraftHead; document: EditorDocument; saved: StoredEditorDocument | null }
export type DraftActivation = { id: string | null; token: RepositoryToken | null }

function snapshot(document: EditorDocument) {
  const parsed = editorDocumentSchema.parse(document)
  const bytes = new TextEncoder().encode(JSON.stringify(parsed)).byteLength
  if (bytes > 32 * 1024 ** 2) throw new Error('Recovery snapshot exceeds 32 MiB. Save/export JSON; the current document was kept.')
  return { document: parsed, bytes }
}
function recoverySnapshot(head: DraftHead, raw: EditorDocument) {
  const copy = snapshot(raw)
  if (copy.document.id !== head.documentId || copy.document.workspace !== head.workspace || copy.document.name !== head.name || copy.bytes !== head.bytes || countDocumentCells(copy.document) !== head.cells) {
    throw new Error('Recovery snapshot does not match its metadata; storage was left untouched.')
  }
  return copy
}
function verify(head: DraftHead, expected: DraftIdentity & { revision: number }) {
  if (head.status !== 'live' || !sameDraft(head, expected) || head.revision !== expected.revision) throw new DraftConflict()
}
function budget(raw: unknown[], head: DraftHead, replacing?: string) {
  const others = raw.map(value => draftHeadSchema.parse(value)).filter(value => value.id !== head.id && value.id !== replacing)
  if (others.length >= MAX_DRAFTS || others.reduce((sum, entry) => sum + entry.bytes, head.bytes) > MAX_DRAFT_BYTES) {
    throw new Error('Recovery storage limit reached (32 drafts / 64 MiB). Back up or discard old recovery drafts; no existing draft was deleted.')
  }
}
function currentBase(raw: unknown, revision: unknown, base: RepositoryToken | null, workspace: EditorDocument['workspace']) {
  const saved = decodeStoredEditorDocument(raw, revision)
  if ((!saved && revision !== undefined) || !sameRepositoryToken(saved?.token ?? null, base)) throw new DraftConflict('The saved document changed or was deleted. Recover a copy or export JSON; local edits were kept.')
  if (saved && saved.document.workspace !== workspace) throw new DraftConflict()
  return saved
}

/** Payloads and small recovery heads are separate; listing/budget checks never load all snapshots. */
export function createDraftRepository(database: () => Promise<IDBDatabase> = openStorageDatabase) {
  async function transaction<T>(mode: IDBTransactionMode, work: (tx: IDBTransaction, finish: (value: T) => void, fail: (error: unknown) => void) => void): Promise<T> {
    const db = await database()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['editorDocuments', 'editorRevisions', 'preferences', ...DRAFT_STORES], mode)
      let value: T, failure: unknown
      tx.oncomplete = () => { if (mode === 'readwrite') notifyRecoveryChanged(); resolve(value) }
      tx.onabort = tx.onerror = () => reject(failure ?? tx.error ?? new Error('Could not access recovery storage'))
      const fail = (error: unknown) => { failure = error; tx.abort() }
      try { work(tx, result => { value = result }, fail) } catch (error) { fail(error) }
    })
  }
  return {
    async write(input: DraftWrite): Promise<DraftHead> {
      const copy = snapshot(input.document)
      const { document: _document, ...identity } = input
      const head = draftHeadSchema.parse({ ...identity, name: copy.document.name, status: 'live', bytes: copy.bytes, cells: countDocumentCells(copy.document), updatedAt: Date.now() })
      if (head.documentId !== copy.document.id || head.workspace !== copy.document.workspace || head.revision < 1) throw new Error('Draft identity/revision mismatch')
      return transaction('readwrite', (tx, finish, fail) => {
        const heads = tx.objectStore('editorDraftHeads'), payloads = tx.objectStore('editorDrafts')
        const saved = tx.objectStore('editorDocuments').get(head.documentId), revision = tx.objectStore('editorRevisions').get(head.documentId)
        const previous = heads.get(head.id), live = heads.index('status').getAll('live')
        live.onsuccess = () => {
          try {
            currentBase(saved.result, revision.result, head.base, head.workspace)
            if (previous.result !== undefined) {
              const old = draftHeadSchema.parse(previous.result)
              if (old.status !== 'live' || !sameDraft(old, head) || old.revision >= head.revision || !sameRepositoryToken(old.base, head.base)) throw new DraftConflict()
            }
            budget(live.result, head)
            heads.put(head); payloads.put({ id: head.id, document: copy.document }); finish(head)
          } catch (error) { fail(error) }
        }
      })
    },
    list(): Promise<DraftListing> {
      return transaction('readonly', (tx, finish) => {
        const request = tx.objectStore('editorDraftHeads').index('status').getAll('live')
        request.onsuccess = () => {
          const records: DraftHead[] = [], issues: string[] = []
          for (const raw of request.result) {
            const parsed = draftHeadSchema.safeParse(raw)
            if (parsed.success) records.push(parsed.data)
            else issues.push('An invalid recovery record was left untouched in storage.')
          }
          finish({ records, issues })
        }
      })
    },
    load(expected: DraftHead): Promise<EditorDocument> {
      return transaction('readonly', (tx, finish, fail) => {
        const head = tx.objectStore('editorDraftHeads').get(expected.id), body = tx.objectStore('editorDrafts').get(expected.id)
        body.onsuccess = () => {
          try {
            const current = draftHeadSchema.parse(head.result)
            verify(current, expected)
            const copy = recoverySnapshot(current, body.result?.document)
            finish(copy.document)
          } catch (error) { fail(error) }
        }
      })
    },
    discard(identity: DraftIdentity, expectedRevision?: number, activate?: DraftActivation): Promise<void> {
      return transaction('readwrite', (tx, finish, fail) => {
        const retire = () => { retireDraft(tx, identity, fail, expectedRevision); finish() }
        if (!activate) { retire(); return }
        const preference = tx.objectStore('preferences')
        if (activate.id === null) { preference.delete(`editor:${identity.workspace}`); retire(); return }
        const saved = tx.objectStore('editorDocuments').get(activate.id), revision = tx.objectStore('editorRevisions').get(activate.id)
        revision.onsuccess = () => {
          try {
            const checkpoint = currentBase(saved.result, revision.result, activate.token, identity.workspace)
            if (!checkpoint || checkpoint.document.workspace !== identity.workspace) throw new DraftConflict()
            preference.put({ id: `editor:${identity.workspace}`, value: activate.id }); retire()
          } catch (error) { fail(error) }
        }
      })
    },
    restore(expected: DraftHead, target: { id: string; epoch: string; copyDocumentId?: string }): Promise<RecoveredDraft> {
      return transaction('readwrite', (tx, finish, fail) => {
        const heads = tx.objectStore('editorDraftHeads'), payloads = tx.objectStore('editorDrafts')
        const oldHead = heads.get(expected.id), body = payloads.get(expected.id)
        body.onsuccess = () => {
          try {
            const old = draftHeadSchema.parse(oldHead.result)
            verify(old, expected)
            const copy = recoverySnapshot(old, body.result?.document)
            const id = target.copyDocumentId ?? old.documentId
            const saved = tx.objectStore('editorDocuments').get(id), revision = tx.objectStore('editorRevisions').get(id)
            const targetHead = heads.get(target.id), live = heads.index('status').getAll('live')
            live.onsuccess = () => {
              try {
                if (targetHead.result !== undefined || target.id === old.id || target.epoch === old.epoch) throw new DraftConflict()
                const checkpoint = currentBase(saved.result, revision.result, target.copyDocumentId ? null : old.base, old.workspace)
                const { document, bytes } = snapshot({ ...copy.document, id })
                const { componentAssetId, ...metadata } = old
                const head = draftHeadSchema.parse({ ...metadata, ...(!target.copyDocumentId && componentAssetId ? { componentAssetId } : {}), id: target.id, epoch: target.epoch, documentId: id, revision: 1, base: checkpoint?.token ?? null, bytes, updatedAt: Date.now() })
                budget(live.result, head, old.id)
                heads.put(retired(old, old)); payloads.delete(old.id)
                heads.put(head); payloads.put({ id: head.id, document })
                const preferences = tx.objectStore('preferences')
                if (checkpoint) preferences.put({ id: `editor:${head.workspace}`, value: checkpoint.document.id })
                else preferences.delete(`editor:${head.workspace}`)
                finish({ head, document, saved: checkpoint })
              } catch (error) { fail(error) }
            }
          } catch (error) { fail(error) }
        }
      })
    },
  }
}
export const draftRepository = createDraftRepository()
