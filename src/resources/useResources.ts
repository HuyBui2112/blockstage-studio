import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { importPack } from '../io/resources'
import { storage } from '../io/storage'
import { ModelResolver } from '../render/models'
import { ResourceWorkspace } from './workspace'

export function useResources() {
  const [workspace] = useState(() => new ResourceWorkspace({
    storage,
    readPack: importPack,
    fallbackProfile: async () => {
      const response = await fetch(`${import.meta.env.BASE_URL}generated/26.2.profile.json`, { signal: AbortSignal.timeout(15000) })
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      // Development servers may return the application HTML for absent generated files.
      if (!response.headers.get('content-type')?.includes('json')) return null
      return response.json()
    },
  }))
  const snapshot = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot)
  useEffect(() => { void workspace.restore() }, [workspace])
  const resolver = useMemo(() => new ModelResolver(snapshot.packs), [snapshot.packs])
  return {
    ...snapshot, resolver,
    clearError: workspace.clearError,
    importPack: workspace.importPack,
    importProfile: workspace.importProfile,
    togglePack: workspace.togglePack,
    movePack: workspace.movePack,
    removePack: workspace.removePack,
  }
}

export type ResourceSession = ReturnType<typeof useResources>
