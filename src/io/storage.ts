import { projectSchema, type Project } from '../core/schema'
import type { ResourcePack } from './resources'
import type { Material } from '../core/catalog'
import type { GameProfile } from '../core/profile'
import { componentAssetSchema, type ComponentAsset } from '../editor/model'

let opened: Promise<IDBDatabase> | undefined
export const STORAGE_VERSION = 6
export function upgradeStorageDatabase(database: IDBDatabase) {
  for (const name of ['projects', 'packs', 'catalogs', 'profiles', 'preferences', 'editorDocuments', 'componentAssets', 'editorRevisions']) {
    if (!database.objectStoreNames.contains(name)) database.createObjectStore(name, { keyPath: 'id' })
  }
}
export function openStorageDatabase() {
  opened ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('blockstage-studio', STORAGE_VERSION)
    req.onupgradeneeded = () => upgradeStorageDatabase(req.result)
    let blocked = false
    req.onblocked = () => { blocked = true; opened = undefined; reject(new Error('Close older Blockstage tabs, then reload to upgrade local storage. Your data is preserved.')) }
    req.onsuccess = () => {
      if (blocked) { req.result.close(); return }
      req.result.onversionchange = () => { req.result.close(); opened = undefined }
      resolve(req.result)
    }
    req.onerror = () => { opened = undefined; reject(req.error) }
  })
  return opened
}
async function operation<T>(store: string, mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const database = await openStorageDatabase()
  return new Promise((resolve, reject) => {
    const tx = database.transaction(store, mode), req = work(tx.objectStore(store))
    tx.oncomplete = () => resolve(req.result as T)
    tx.onerror = tx.onabort = () => reject(tx.error ?? req.error ?? new Error('Lỗi IndexedDB'))
  })
}
export const storage = {
  projects: async () => (await operation<unknown[]>('projects', 'readonly', s => s.getAll())).map(p => projectSchema.parse(p)),
  save: (p: Project) => operation('projects', 'readwrite', s => s.put(projectSchema.parse(p))),
  remove: (id: string) => operation('projects', 'readwrite', s => s.delete(id)),
  packs: () => operation<ResourcePack[]>('packs', 'readonly', s => s.getAll()),
  savePack: (p: ResourcePack) => operation('packs', 'readwrite', s => s.put(p)),
  savePacks: async (packs: ResourcePack[]) => {
    const database = await openStorageDatabase()
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction('packs', 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('Could not save resource order'))
      for (const pack of packs) tx.objectStore('packs').put(pack)
    })
  },
  removePack: (id: string) => operation('packs', 'readwrite', s => s.delete(id)),
  catalog: () => operation<{ id: string; materials: Material[] } | undefined>('catalogs', 'readonly', s => s.get('26.2')),
  saveCatalog: (materials: Material[]) => operation('catalogs', 'readwrite', s => s.put({ id: '26.2', materials })),
  profile: () => operation<{ id: string; value: GameProfile } | undefined>('profiles','readonly',s=>s.get('26.2')),
  saveProfile: (value: GameProfile) => operation('profiles','readwrite',s=>s.put({id:'26.2',value})),
  activeProject: () => operation<{id:string;value:string}|undefined>('preferences','readonly',s=>s.get('active-project')),
  setActiveProject: (value:string) => operation('preferences','readwrite',s=>s.put({id:'active-project',value})),
  componentAssets: () => operation<unknown[]>('componentAssets', 'readonly', s => s.getAll()),
  saveComponentAsset: (asset: ComponentAsset) => operation('componentAssets', 'readwrite', s => s.put(componentAssetSchema.parse(asset))),
  removeComponentAsset: (id: string) => operation('componentAssets', 'readwrite', s => s.delete(id)),
  editorPreference: (scope: string) => operation<{ id: string; value: string } | undefined>('preferences', 'readonly', s => s.get(`editor:${scope}`)),
  setEditorPreference: (scope: string, value: string) => operation('preferences', 'readwrite', s => s.put({ id: `editor:${scope}`, value })),
}
export function download(name: string, bytes: Uint8Array | string, type: string) {
  const blob = new Blob([typeof bytes === 'string' ? bytes : new Uint8Array(bytes).buffer], { type })
  const url = URL.createObjectURL(blob), a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
