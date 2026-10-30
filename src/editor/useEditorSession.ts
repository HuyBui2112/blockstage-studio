import { useEffect, useRef, useState } from 'react'
import type { Material } from '../core/catalog'
import type { NeighborRules } from '../core/profile'
import { planNeighborConnections } from './neighbors'
import { projectSchema, type Vec3 } from '../core/schema'
import { storage } from '../io/storage'
import { createHistory, executeHistory, redoHistory, undoHistory, type EditorHistory } from './history'
import { componentAssetSchema, editorDocumentSchema, fromLegacyProject, newEditorDocument, validateDocument, type ComponentAsset, type CoordinateSpace, type EditorDocument, type PivotMode, type QuarterTurn } from './model'
import { componentFromSelection, groupObjects, insertObject, moveObjects, previewTransform, removeObjects, rotateObjects, setObjectPivot, ungroupObjects, updateObjectsState } from './operations'
import { planBlockPlacement, planComponentPlacement, type PlacementHit, type PlacementOptions } from './placement-plan'
import type { BlockState } from '../core/schema'

export type EditorScope = 'architecture' | 'component'
export type TransformIntent = { kind: 'move'; delta: Vec3 } | { kind: 'rotate'; turns: number }
type Slot = { history: EditorHistory; selection: string[]; saved: EditorDocument | null; editingAssetId: string | null }
type Preview = { scope: EditorScope; result: ReturnType<typeof previewTransform> }
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error)
const makeSlot = (scope: EditorScope): Slot => ({ history: createHistory(newEditorDocument(scope)), selection: [], saved: null, editingAssetId: null })

export function useEditorSession(catalog: Material[], neighborRules?: NeighborRules) {
  const [autoConnections, setAutoConnections] = useState<Record<EditorScope,boolean>>({architecture:false,component:false})
  const [connectionNotes, setConnectionNotes] = useState<{scope:EditorScope;document:EditorDocument;notes:string[]}|null>(null)
  const [slots, setSlots] = useState<Record<EditorScope, Slot>>(() => ({ architecture: makeSlot('architecture'), component: makeSlot('component') }))
  const [documents, setDocuments] = useState<EditorDocument[]>([])
  const [components, setComponents] = useState<ComponentAsset[]>([])
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const currentSlots = useRef(slots)
  useEffect(() => { currentSlots.current = slots }, [slots])

  useEffect(() => {
    let active = true
    void Promise.allSettled([storage.editorDocuments(), storage.componentAssets(), storage.editorPreference('architecture'), storage.editorPreference('component')]).then(results => {
      if (!active) return
      const issues: string[] = []
      const restoredDocuments: EditorDocument[] = [], restoredComponents: ComponentAsset[] = []
      if (results[0].status === 'fulfilled') for (const raw of results[0].value) {
        const parsed = editorDocumentSchema.safeParse(raw)
        if (parsed.success) restoredDocuments.push(parsed.data)
        else issues.push('An invalid editor document was left untouched in storage.')
      }
      else issues.push(messageOf(results[0].reason))
      if (results[1].status === 'fulfilled') for (const raw of results[1].value) {
        const parsed = componentAssetSchema.safeParse(raw)
        if (parsed.success) restoredComponents.push(parsed.data)
        else issues.push('An invalid component asset was left untouched in storage.')
      }
      else issues.push(messageOf(results[1].reason))
      setDocuments(restoredDocuments)
      setComponents(restoredComponents)
      setSlots(previous => {
        const next = { ...previous }
        for (const [scope, index] of [['architecture', 2], ['component', 3]] as const) {
          const preference = results[index]
          const id = preference.status === 'fulfilled' ? preference.value?.value : undefined
          const doc = restoredDocuments.find(document => document.workspace === scope && document.id === id)
          if (doc) {
            const history = createHistory(doc)
            next[scope] = { history, selection: [], saved: history.document, editingAssetId: scope === 'component' && restoredComponents.some(asset => asset.id === doc.id) ? doc.id : null }
          }
        }
        return next
      })
      setError(issues.join(' '))
    }).finally(() => { if (active) setReady(true) })
    return () => { active = false }
  }, [])

  function commit(scope: EditorScope, next: EditorDocument, label: string, selection?: string[]) {
    const before = slots[scope].history.document
    const plan=autoConnections[scope] && neighborRules ? planNeighborConnections(before,next,neighborRules) : {document:next,notes:[]}
    next=plan.document
    validateDocument(next, catalog)
    setConnectionNotes({scope,document:next,notes:plan.notes})
    setSlots(previous => {
      const slot = previous[scope]
      if (slot.history.document !== before) return previous
      const available = new Set(next.objects.map(object => object.id))
      return { ...previous, [scope]: { ...slot, history: executeHistory(slot.history, next, label), selection: (selection ?? slot.selection).filter(id => available.has(id)) } }
    })
    setPreview(null)
    setError('')
  }
  function perform(scope: EditorScope, label: string, operation: (document: EditorDocument) => EditorDocument, selection?: string[]) {
    try { commit(scope, operation(slots[scope].history.document), label, selection); return true }
    catch (error) { setError(messageOf(error)); return false }
  }
  function select(scope: EditorScope, ids: string[], toggle: boolean) {
    setPreview(null)
    setSlots(previous => {
      const slot = previous[scope], available = new Set(slot.history.document.objects.map(object => object.id))
      const selection = toggle ? new Set(slot.selection) : new Set<string>()
      for (const id of ids) if (available.has(id)) { if (toggle && selection.has(id)) selection.delete(id); else selection.add(id) }
      return { ...previous, [scope]: { ...slot, selection: [...selection] } }
    })
  }
  function history(scope: EditorScope, redo: boolean) {
    setPreview(null)
    setError('')
    setSlots(previous => {
      const slot = previous[scope], next = redo ? redoHistory(slot.history) : undoHistory(slot.history)
      return { ...previous, [scope]: { ...slot, history: next, selection: slot.selection.filter(id => next.document.objects.some(object => object.id === id)) } }
    })
  }
  function transform(scope: EditorScope, intent: TransformIntent, phase: 'preview' | 'commit' | 'cancel', space: CoordinateSpace, pivot: PivotMode) {
    if (phase === 'cancel') { setPreview(null); setError(''); return }
    const slot = slots[scope]
    const result = previewTransform(slot.history.document, slot.selection, intent, space, pivot, catalog, autoConnections[scope]?neighborRules:undefined)
    if (phase === 'preview') { setPreview({ scope, result }); return }
    setPreview(null)
    if (!result.valid || !result.document) { setError(result.error ?? 'Cannot commit this transform'); return }
    try { commit(scope, result.document, intent.kind === 'move' ? 'Move objects' : 'Rotate objects') }
    catch (error) { setError(messageOf(error)) }
  }
  function place(scope: EditorScope, state: BlockState, pos: Vec3, hit?: PlacementHit, options: PlacementOptions = { mode: 'design', turns: 0 }) {
    try {
      const { object } = planBlockPlacement(state, pos, catalog, hit, options)
      commit(scope, insertObject(slots[scope].history.document, object, catalog), 'Place object', [object.id])
    } catch (error) { setError(messageOf(error)) }
  }
  function group(scope: EditorScope) {
    try {
      const before = slots[scope].history.document
      const next = groupObjects(before, slots[scope].selection, 'Group', catalog)
      commit(scope, next, 'Group objects', next.objects.filter(object => !before.objects.some(previous => previous.id === object.id)).map(object => object.id))
    } catch (error) { setError(messageOf(error)) }
  }
  function ungroup(scope: EditorScope) {
    try {
      const before = slots[scope].history.document
      const children = before.objects.filter(object => slots[scope].selection.includes(object.id) && object.kind === 'group').flatMap(object => object.children.map(child => child.id))
      commit(scope, ungroupObjects(before, slots[scope].selection, catalog), 'Ungroup objects', children)
    } catch (error) { setError(messageOf(error)) }
  }
  function remove(scope: EditorScope) { perform(scope, 'Delete objects', document => removeObjects(document, slots[scope].selection, catalog), []) }
  function updateState(scope: EditorScope, property: string, value: string) { perform(scope, 'Change block state', document => updateObjectsState(document, slots[scope].selection, property, value, catalog)) }
  function setPivot(scope: EditorScope, id: string, pivot2: Vec3) { perform(scope, 'Set object pivot', document => setObjectPivot(document, id, pivot2, catalog)) }
  function move(scope: EditorScope, delta: Vec3, space: CoordinateSpace) { perform(scope, 'Move objects', document => moveObjects(document, slots[scope].selection, delta, space, catalog)) }
  function rotate(scope: EditorScope, degrees: number, pivot: PivotMode) { perform(scope, 'Rotate objects', document => rotateObjects(document, slots[scope].selection, degrees / 90, pivot, catalog)) }
  function rename(scope: EditorScope, name: string) {
    perform(scope, 'Rename document', document => ({ ...document, name: name.trim() || 'Untitled' }))
  }
  async function save(scope: EditorScope) {
    const snapshot = slots[scope].history.document
    try {
      await storage.saveEditorDocument(snapshot)
      await storage.setEditorPreference(scope, snapshot.id)
      setDocuments(previous => [...previous.filter(document => document.id !== snapshot.id), snapshot])
      setSlots(previous => previous[scope].history.document.id === snapshot.id ? ({ ...previous, [scope]: { ...previous[scope], saved: snapshot } }) : previous)
      setError('')
      return true
    } catch (error) { setError(messageOf(error)); return false }
  }
  async function newDocument(scope: EditorScope) {
    const startingDocument = slots[scope].history.document
    if (!await save(scope)) return
    if (currentSlots.current[scope].history.document !== startingDocument) { setError('The document changed during save. Retry New when the save finishes.'); return }
    setPreview(null)
    setSlots(previous => previous[scope].history.document === startingDocument ? ({ ...previous, [scope]: makeSlot(scope) }) : previous)
  }
  async function open(scope: EditorScope, document: EditorDocument) {
    const startingDocument = slots[scope].history.document
    if (!await save(scope)) return
    if (currentSlots.current[scope].history.document !== startingDocument) { setError('The document changed during save. Retry Open after saving.'); return }
    setPreview(null)
    setSlots(previous => {
      if (previous[scope].history.document !== startingDocument) return previous
      const history = createHistory(document)
      return { ...previous, [scope]: { history, selection: [], saved: history.document, editingAssetId: scope === 'component' && components.some(asset => asset.id === document.id) ? document.id : null } }
    })
    await storage.setEditorPreference(scope, document.id).catch(error => setError(messageOf(error)))
  }
  async function importDocument(scope: EditorScope, file: File) {
    const startingDocument = slots[scope].history.document
    try {
      if (file.size > 32 * 1024 ** 2) throw new Error('Editor JSON must be at most 32 MiB')
      const raw = JSON.parse(await file.text()) as { schemaVersion?: number }
      const document = raw.schemaVersion === 2 ? editorDocumentSchema.parse(raw) : fromLegacyProject(projectSchema.parse(raw))
      validateDocument(document, catalog)
      if (!await save(scope)) return
      if (currentSlots.current[scope].history.document !== startingDocument) { setError('The document changed while importing. Retry after saving.'); return }
      const imported = { ...document, id: crypto.randomUUID(), workspace: scope }
      setPreview(null)
      setSlots(previous => previous[scope].history.document === startingDocument ? ({ ...previous, [scope]: { history: createHistory(imported), selection: [], saved: null, editingAssetId: null } }) : previous)
    } catch (error) { setError(messageOf(error)) }
  }
  async function saveComponent(scope: EditorScope, selectionOnly = true) {
    try {
      const slot = slots[scope], doc = slot.history.document
      const ids = selectionOnly ? slot.selection : doc.objects.map(object => object.id)
      const asset = componentFromSelection(doc, ids, scope === 'component' ? doc.name : `Component ${components.length + 1}`)
      if (scope === 'component') asset.id = slot.editingAssetId ?? doc.id
      await storage.saveComponentAsset(asset)
      setComponents(previous => [...previous.filter(component => component.id !== asset.id), asset])
      if (scope === 'component') {
        setSlots(previous => previous.component.history.document.id === doc.id ? ({ ...previous, component: { ...previous.component, editingAssetId: asset.id } }) : previous)
        await save('component')
      }
      setError('')
      return asset
    } catch (error) { setError(messageOf(error)) }
  }
  async function editComponent(asset: ComponentAsset) {
    const startingDocument = slots.component.history.document
    if (!await save('component')) return false
    if (currentSlots.current.component.history.document !== startingDocument) { setError('The component draft changed during save. Retry after saving.'); return false }
    const document = { ...newEditorDocument('component'), id: asset.id, name: asset.name, objects: structuredClone(asset.objects) }
    setPreview(null)
    setSlots(previous => previous.component.history.document === startingDocument ? ({ ...previous, component: { history: createHistory(document), selection: [], saved: null, editingAssetId: asset.id } }) : previous)
    return true
  }
  function placeComponent(scope: EditorScope, asset: ComponentAsset, pos: Vec3, turns: QuarterTurn = 0) {
    try {
      const object = planComponentPlacement(asset, pos, turns, catalog)
      commit(scope, insertObject(slots[scope].history.document, object, catalog), 'Place component', [object.id])
    } catch (error) { setError(messageOf(error)) }
  }
  async function importComponent(file: File) {
    try {
      if (file.size > 32 * 1024 ** 2) throw new Error('Component JSON must be at most 32 MiB')
      const source = componentAssetSchema.parse(JSON.parse(await file.text()))
      const asset = { ...source, id: crypto.randomUUID() }
      validateDocument({ ...newEditorDocument('component'), objects: asset.objects }, catalog)
      await storage.saveComponentAsset(asset)
      setComponents(previous => [...previous, asset])
      setError('')
    } catch (error) { setError(messageOf(error)) }
  }
  async function removeComponent(id: string) {
    try {
      await storage.removeComponentAsset(id)
      setComponents(previous => previous.filter(asset => asset.id !== id))
    } catch (error) { setError(messageOf(error)) }
  }
  function configureConnections(scope:EditorScope,enabled:boolean){setPreview(null);setConnectionNotes(null);setAutoConnections(previous=>({...previous,[scope]:enabled}))}
  return { autoConnections, connectionNotes, configureConnections, slots, documents, components, ready, error, setError, preview, cancelPreview: () => setPreview(null), select, history, transform, place, group, ungroup, remove, updateState, setPivot, move, rotate, rename, save, newDocument, open, importDocument, saveComponent, editComponent, placeComponent, importComponent, removeComponent }
}

export type EditorSession = ReturnType<typeof useEditorSession>
