import { DEMO_MATERIALS, type Material } from '../core/catalog'
import { gameProfileSchema, profileMaterials, type GameProfile } from '../core/profile'
import { orderedPacks, type ResourcePack } from '../io/resources'
import { ZodError } from 'zod'

export type ResourceSnapshot = { packs: ResourcePack[]; profile: GameProfile | null; catalog: Material[]; ready: boolean; busy: boolean; error: string | null }
export type ResourceStorage = {
  packs: () => Promise<ResourcePack[]>;
  profile: () => Promise<{ value: GameProfile } | undefined>;
  savePack: (pack: ResourcePack) => Promise<unknown>;
  savePacks: (packs: ResourcePack[]) => Promise<unknown>;
  removePack: (id: string) => Promise<unknown>;
  saveProfile: (profile: GameProfile) => Promise<unknown>;
}
type Dependencies = { storage: ResourceStorage; readPack: (file: File) => Promise<ResourcePack>; fallbackProfile: () => Promise<unknown | null> }
const message = (error: unknown) => {
  if (error instanceof ZodError) {
    const issues = error.issues.slice(0, 3).map(issue => `${String(issue.path.join('.') || 'profile').slice(0, 100)}: ${issue.message.slice(0, 180)}`)
    const remaining = error.issues.length - issues.length
    return `Invalid game profile. ${issues.join('; ')}${remaining ? `; ${remaining} more issues` : ''}`
  }
  return error instanceof Error ? error.message : String(error)
}

/** Validate stored records independently; never rewrite or remove invalid records on restore. */
export function validStoredPack(value: unknown): value is ResourcePack {
  if (!value || typeof value !== 'object') return false
  const pack = value as ResourcePack
  return typeof pack.id === 'string' && !!pack.id && typeof pack.name === 'string' && pack.gameVersion === '26.2'
    && typeof pack.enabled === 'boolean' && Number.isFinite(pack.priority)
    && !!pack.files && typeof pack.files === 'object' && !Array.isArray(pack.files)
    && Object.values(pack.files).every(bytes => bytes instanceof Uint8Array)
    && !!pack.counts && ['textures', 'models', 'blockstates', 'entityTextures'].every(key => {
      const count = pack.counts[key as keyof ResourcePack['counts']]
      return Number.isSafeInteger(count) && count >= 0
    })
}

export function movePack(packs: ResourcePack[], id: string, direction: 'up' | 'down'): ResourcePack[] {
  const next = orderedPacks(packs), index = next.findIndex(pack => pack.id === id)
  if (index < 0) throw new Error('Resource pack no longer exists.')
  const target = index + (direction === 'up' ? -1 : 1)
  if (target < 0 || target >= next.length) return packs
  ;[next[index], next[target]] = [next[target], next[index]]
  return next.map((pack, i) => ({ ...pack, priority: next.length - i }))
}

export function assertProfileMatches(packs: ResourcePack[], profile: GameProfile | null) {
  if (profile && packs.some(pack => pack.sourceSha1 && pack.sourceSha1 !== profile.sourceSha1)) {
    throw new Error('Client JAR and game profile fingerprints differ. Import a profile generated from this JAR.')
  }
}

/** User mutations persist before publishing. An optional local profile remains usable
 * for this session if caching it fails; that failure is reported. No project APIs are used. */
export class ResourceWorkspace {
  private snapshot: ResourceSnapshot = { packs: [], profile: null, catalog: DEMO_MATERIALS, ready: false, busy: false, error: null }
  private listeners = new Set<() => void>()
  private restoring?: Promise<void>
  private dependencies: Dependencies
  constructor(dependencies: Dependencies) { this.dependencies = dependencies }
  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish(change: Partial<ResourceSnapshot>) {
    this.snapshot = { ...this.snapshot, ...change }
    this.listeners.forEach(listener => listener())
  }
  clearError = () => { this.publish({ error: null }) }
  restore = (): Promise<void> => {
    this.restoring ??= this.restoreResources()
    return this.restoring
  }
  private async restoreResources() {
    const { storage, fallbackProfile } = this.dependencies
    const failures: string[] = []
    const [packResult, profileResult] = await Promise.allSettled([storage.packs(), storage.profile()])
    let packs: ResourcePack[] = [], profile: GameProfile | null = null
    if (packResult.status === 'fulfilled') {
      const records = packResult.value
      const ids = new Set<string>()
      for (const record of records) {
        if (validStoredPack(record) && !ids.has(record.id)) { packs.push(record); ids.add(record.id) }
        else failures.push('A stored resource pack is invalid or unsupported and was left untouched.')
      }
      packs = orderedPacks(packs)
    } else failures.push(`Could not restore resources: ${message(packResult.reason)}`)
    if (profileResult.status === 'fulfilled' && profileResult.value) {
      const parsed = gameProfileSchema.safeParse(profileResult.value.value)
      if (parsed.success) profile = parsed.data
      else failures.push('Stored game profile is invalid. Import a Java 26.2 profile JSON.')
    } else if (profileResult.status === 'rejected') failures.push(`Could not restore game profile: ${message(profileResult.reason)}`)
    if (!profile) {
      try {
        const fallback = await fallbackProfile()
        if (fallback) {
          const parsed = gameProfileSchema.parse(fallback)
          assertProfileMatches(packs, parsed)
          profile = parsed
          try { await storage.saveProfile(parsed) }
          catch (error) { failures.push(`Game profile is available for this session but could not be saved: ${message(error)}`) }
        }
      } catch (error) { failures.push(`Could not load game profile: ${message(error)}`) }
    }
    try { assertProfileMatches(packs, profile) }
    catch (error) { profile = null; failures.push(`${message(error)} Profile rendering is unavailable until they match.`) }
    this.publish({ packs, profile, catalog: profile ? profileMaterials(profile) : DEMO_MATERIALS, ready: true, error: failures.length ? failures.join(' ') : null })
  }
  private async run(operation: () => Promise<void>) {
    if (!this.snapshot.ready || this.snapshot.busy) return
    this.publish({ busy: true, error: null })
    try { await operation() }
    catch (error) { this.publish({ error: message(error) }) }
    finally { this.publish({ busy: false }) }
  }
  importPack = (file: File) => this.run(async () => {
    const pack = await this.dependencies.readPack(file)
    if (!validStoredPack(pack) || pack.gameVersion !== '26.2') throw new Error('Invalid Java 26.2 resource pack.')
    if (this.snapshot.packs.some(existing => existing.id === pack.id || pack.fingerprint && existing.fingerprint === pack.fingerprint)) {
      throw new Error('This resource pack has already been imported.')
    }
    assertProfileMatches([pack], this.snapshot.profile)
    const ordered = orderedPacks(this.snapshot.packs)
    // A monotonic bounded integer puts this import above every existing pack.
    const priority = Math.max(0, ...ordered.map(existing => existing.priority)) + 1
    if (!Number.isSafeInteger(priority)) throw new Error('Resource priorities are out of range. Reorder a pack first.')
    const next = { ...pack, priority }
    await this.dependencies.storage.savePack(next)
    this.publish({ packs: orderedPacks([...this.snapshot.packs, next]) })
  })
  importProfile = (file: File) => this.run(async () => {
    if (file.size > 64 * 1024 ** 2) throw new Error('Game profile JSON must be at most 64 MiB.')
    const profile = gameProfileSchema.parse(JSON.parse(await file.text()))
    assertProfileMatches(this.snapshot.packs, profile)
    await this.dependencies.storage.saveProfile(profile)
    this.publish({ profile, catalog: profileMaterials(profile) })
  })
  togglePack = (id: string) => this.run(async () => {
    const pack = this.snapshot.packs.find(pack => pack.id === id)
    if (!pack) throw new Error('Resource pack no longer exists.')
    const next = { ...pack, enabled: !pack.enabled }
    await this.dependencies.storage.savePack(next)
    this.publish({ packs: this.snapshot.packs.map(pack => pack.id === id ? next : pack) })
  })
  movePack = (id: string, direction: 'up' | 'down') => this.run(async () => {
    const packs = movePack(this.snapshot.packs, id, direction)
    if (packs === this.snapshot.packs) return
    await this.dependencies.storage.savePacks(packs)
    this.publish({ packs })
  })
  removePack = (id: string) => this.run(async () => {
    if (!this.snapshot.packs.some(pack => pack.id === id)) throw new Error('Resource pack no longer exists.')
    await this.dependencies.storage.removePack(id)
    this.publish({ packs: this.snapshot.packs.filter(pack => pack.id !== id) })
  })
}
