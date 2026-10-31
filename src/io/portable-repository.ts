import { componentAssetSchema,editorDocumentSchema } from '../editor/model'
import { openStorageDatabase } from './storage'
import { notifyRecoveryChanged } from './draft-storage'
import type { PortablePlan } from './portable-backup'
import type { StoredEditorDocument } from './editor-repository'

/** Restore only creates new records, atomically. Never overwrite even on an ID collision. */
export async function commitPortableRestore(plan:PortablePlan,database:()=>Promise<IDBDatabase>=openStorageDatabase):Promise<StoredEditorDocument> {
  const document=editorDocumentSchema.parse(plan.document),components=plan.components.map(asset=>componentAssetSchema.parse(asset))
  if(components.length>256||new Set(components.map(asset=>asset.id)).size!==components.length)throw new Error('Invalid restore component set')
  const db=await database()
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(['editorDocuments','editorRevisions','componentAssets','preferences'],'readwrite')
    let failure:unknown
    const token={generation:crypto.randomUUID(),version:1},updatedAt=Date.now()
    tx.oncomplete=()=>{notifyRecoveryChanged();resolve({document,token,updatedAt})}
    tx.onabort=tx.onerror=()=>reject(failure??tx.error??new Error('Could not restore portable backup; existing data was kept.'))
    const fail=(error:unknown)=>{failure=error;tx.abort()}
    const documents=tx.objectStore('editorDocuments'),revisions=tx.objectStore('editorRevisions'),assets=tx.objectStore('componentAssets')
    const docRequest=documents.get(document.id),revRequest=revisions.get(document.id)
    const requests=components.map(asset=>assets.get(asset.id))
    const finish=()=>{
      try {
        if(docRequest.result!==undefined||revRequest.result!==undefined||requests.some(request=>request.result!==undefined))throw new Error('Restore ID conflict. Existing records were kept. Retry with a new restore plan.')
        documents.add(document);revisions.add({id:document.id,...token,updatedAt,deleted:false})
        for(const asset of components)assets.add(asset)
        tx.objectStore('preferences').put({id:`editor:${document.workspace}`,value:document.id})
      }catch(error){fail(error)}
    }
    const last=requests.at(-1)??revRequest
    last.onsuccess=finish
  })
}
