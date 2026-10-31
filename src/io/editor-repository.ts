import { z } from 'zod'
import { editorDocumentSchema, type EditorDocument } from '../editor/model'
import { openStorageDatabase } from './storage'

/** Storage version is independent of edit/history revision. null means never persisted. */
export type RepositoryToken = { generation: string; version: number }
export type StoredEditorDocument = { document: EditorDocument; token: RepositoryToken; componentAssetId?: string; updatedAt?: number }
export type RepositorySaveOptions = { activate?: boolean; componentAssetId?: string }
export type RepositoryListing = { records: StoredEditorDocument[]; issues: string[] }
const revisionSchema = z.object({
  id: z.string().min(1).max(200), generation: z.string().min(1).max(200),
  version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), deleted: z.boolean(),
  componentAssetId: z.string().min(1).max(200).optional(),
  updatedAt: z.number().int().min(0).max(8640000000000000).optional(),
}).strict()
type Revision = z.infer<typeof revisionSchema>
const legacyToken: RepositoryToken = { generation: 'legacy', version: 0 }

export class RepositoryConflict extends Error {
  constructor() {
    super('This document was changed or deleted in another session. Export your local JSON backup, then reload and reopen the saved document. Your local edits were kept.')
    this.name = 'RepositoryConflict'
  }
}

function stored(raw: unknown, metadata: unknown): StoredEditorDocument | null {
  const revision = metadata === undefined ? undefined : revisionSchema.parse(metadata)
  if (revision?.deleted) {
    if (raw !== undefined) throw new Error('Deleted editor document still has a snapshot; storage was left untouched.')
    return null
  }
  if (raw === undefined) {
    if (revision) throw new Error('Editor revision is missing its snapshot; storage was left untouched.')
    return null
  }
  const document = editorDocumentSchema.parse(raw)
  if (revision && revision.id !== document.id) throw new Error('Editor revision identity does not match its snapshot.')
  return { document, token: revision ? { generation: revision.generation, version: revision.version } : { ...legacyToken }, ...(revision?.componentAssetId ? { componentAssetId: revision.componentAssetId } : {}), ...(revision?.updatedAt !== undefined ? { updatedAt: revision.updatedAt } : {}) }
}

function matches(actual: RepositoryToken | null, expected: RepositoryToken | null) {
  return actual === null ? expected === null : expected !== null && actual.generation === expected.generation && actual.version === expected.version
}

/** Native IDB transactions are the concurrency boundary, including between tabs.
 * The database factory is injectable for isolated native-browser/fault tests.
 * No asynchronous work is allowed inside a transaction's request callbacks. */
export function createEditorRepository(database: () => Promise<IDBDatabase> = openStorageDatabase) {
  async function read<T>(work: (tx: IDBTransaction, finish: (value: T) => void, fail: (error: unknown) => void) => void): Promise<T> {
    const db = await database()
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(['editorDocuments', 'editorRevisions'], 'readonly')
      let result: T, failure: unknown
      tx.oncomplete = () => resolve(result)
      tx.onerror = tx.onabort = () => reject(failure ?? tx.error ?? new Error('Could not read editor storage'))
      const fail = (error: unknown) => { failure = error; tx.abort() }
      try { work(tx, value => { result = value }, fail) } catch (error) { fail(error) }
    })
  }

  return {
    load(id: string): Promise<StoredEditorDocument | null> {
      return read((tx, finish, fail) => {
        const snapshot = tx.objectStore('editorDocuments').get(id)
        const revision = tx.objectStore('editorRevisions').get(id)
        revision.onsuccess = () => {
          try { finish(stored(snapshot.result, revision.result)) }
          catch (error) { fail(error) }
        }
      })
    },
    list(): Promise<RepositoryListing> {
      return read((tx, finish, fail) => {
        const snapshots = tx.objectStore('editorDocuments').getAll()
        const revisions = tx.objectStore('editorRevisions').getAll()
        revisions.onsuccess = () => {
          try {
            const metadata = new Map((revisions.result as { id: string }[]).map(entry => [entry.id, entry]))
            const records: StoredEditorDocument[] = [], issues: string[] = []
            for (const raw of snapshots.result as { id?: string }[]) {
              try {
                const record = stored(raw, metadata.get(raw?.id ?? ''))
                if (record) records.push(record)
              } catch { issues.push('An invalid editor document or revision was left untouched in storage.') }
            }
            finish({ records, issues })
          } catch (error) { fail(error) }
        }
      })
    },
    async save(document: EditorDocument, expected: RepositoryToken | null, options: RepositorySaveOptions = {}): Promise<StoredEditorDocument> {
      // Parse/clone before the first await: caller edits cannot change the submitted snapshot.
      const snapshot = editorDocumentSchema.parse(document)
      return mutate(snapshot.id, expected, snapshot.workspace, snapshot, { ...options })
    },
    async remove(id: string, expected: RepositoryToken, scope: EditorDocument['workspace']): Promise<void> {
      await mutate(id, expected, scope, null)
    },
    async activate(scope: EditorDocument['workspace'], id: string | null, expected: RepositoryToken | null): Promise<void> {
      const token = expected && { ...expected }
      const db = await database()
      return new Promise((resolve, reject) => {
        const tx = db.transaction(['editorDocuments', 'editorRevisions', 'preferences'], 'readwrite')
        let failure: unknown
        tx.oncomplete = () => resolve()
        tx.onerror = tx.onabort = () => reject(failure ?? tx.error ?? new Error('Could not switch editor document'))
        const preferences = tx.objectStore('preferences')
        if (id === null) { preferences.delete(`editor:${scope}`); return }
        const snapshot = tx.objectStore('editorDocuments').get(id), revision = tx.objectStore('editorRevisions').get(id)
        revision.onsuccess = () => {
          try {
            const record = stored(snapshot.result, revision.result)
            if (!record || record.document.workspace !== scope || !matches(record.token, token)) throw new RepositoryConflict()
            preferences.put({ id: `editor:${scope}`, value: id })
          } catch (error) { failure = error; tx.abort() }
        }
      })
    },
  }

  function mutate(id: string, expected: RepositoryToken | null, scope: EditorDocument['workspace'], snapshot: EditorDocument, options: RepositorySaveOptions): Promise<StoredEditorDocument>
  function mutate(id: string, expected: RepositoryToken | null, scope: EditorDocument['workspace'], snapshot: null): Promise<void>
  async function mutate(id: string, expected: RepositoryToken | null, scope: EditorDocument['workspace'], snapshot: EditorDocument | null, options: RepositorySaveOptions = {}): Promise<StoredEditorDocument | void> {
    const expectedToken = expected && { ...expected }
    const db = await database()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['editorDocuments', 'editorRevisions', 'preferences'], 'readwrite')
      let result: StoredEditorDocument | void, failure: unknown
      tx.oncomplete = () => resolve(result)
      tx.onerror = tx.onabort = () => reject(failure ?? tx.error ?? new Error('Could not write editor storage'))
      const documents = tx.objectStore('editorDocuments'), revisions = tx.objectStore('editorRevisions'), preferences = tx.objectStore('preferences')
      const oldDocument = documents.get(id), oldRevision = revisions.get(id)
      oldRevision.onsuccess = () => {
        try {
          const previous = stored(oldDocument.result, oldRevision.result)
          // Tombstones are permanent guards. Restoring/deleting again needs an explicit future API.
          if (oldRevision.result?.deleted || !matches(previous?.token ?? null, expectedToken) || (!snapshot && !previous)) throw new RepositoryConflict()
          if (previous && previous.document.workspace !== scope) throw new Error('Editor workspace cannot be changed by saving')
          const version = (previous?.token.version ?? 0) + 1
          if (!Number.isSafeInteger(version)) throw new Error('Editor storage version limit reached')
          const generation = previous && previous.token.version > 0 ? previous.token.generation : crypto.randomUUID()
          const componentAssetId = options.componentAssetId ?? previous?.componentAssetId
          if (componentAssetId && scope !== 'component') throw new Error('Only component documents may reference a library asset')
          const revision: Revision = revisionSchema.parse({ id, generation, version, deleted: snapshot === null, updatedAt: Date.now(), ...(componentAssetId ? { componentAssetId } : {}) })
          revisions.put(revision)
          if (snapshot) {
            documents.put(snapshot)
            if (options.activate !== false) preferences.put({ id: `editor:${scope}`, value: id })
            result = { document: snapshot, token: { generation, version }, updatedAt: revision.updatedAt, ...(componentAssetId ? { componentAssetId } : {}) }
          } else {
            documents.delete(id)
            const preference = preferences.get(`editor:${scope}`)
            preference.onsuccess = () => { if (preference.result?.value === id) preferences.delete(`editor:${scope}`) }
          }
        } catch (error) { failure = error; tx.abort() }
      }
    })
  }
}

export const editorRepository = createEditorRepository()
