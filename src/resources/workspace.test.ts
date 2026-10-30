import { describe, expect, it, vi } from 'vitest'
import { DEMO_MATERIALS } from '../core/catalog'
import { gameProfileSchema } from '../core/profile'
import { effectiveAssetIndex, orderedPacks, type ResourcePack } from '../io/resources'
import { ModelResolver } from '../render/models'
import { movePack, ResourceWorkspace, type ResourceStorage } from './workspace'

const path = 'assets/minecraft/textures/block/test.png'
const pack = (id: string, priority = 1): ResourcePack => ({
  id, name: `${id}.zip`, gameVersion: '26.2', enabled: true, priority,
  fingerprint: id.repeat(64).slice(0, 64), files: { [path]: new Uint8Array([id.charCodeAt(0)]) },
  counts: { textures: 1, models: 0, blockstates: 0, entityTextures: 0 },
})
const profile = () => gameProfileSchema.parse({
  schemaVersion: 1, gameVersion: '26.2', dataVersion: 4903, sourceSha1: 'a'.repeat(40),
  blocks: [{ id: 'minecraft:test', item: 'minecraft:test', translationKey: 'block.test', defaults: {}, properties: {}, stateCount: 1, hasBlockEntity: false, gravity: false, friction: 0.6, blastResistance: 6 }],
  entities: [], creativeTabs: [], entityModels: {},
})
function setup(packs: ResourcePack[] = []) {
  const storage: ResourceStorage = {
    packs: vi.fn(async () => packs), profile: vi.fn(async () => undefined),
    savePack: vi.fn(async () => {}), savePacks: vi.fn(async () => {}), removePack: vi.fn(async () => {}), saveProfile: vi.fn(async () => {}),
  }
  const readPack = vi.fn(async () => pack('new'))
  const fallbackProfile = vi.fn(async (): Promise<unknown | null> => null)
  const workspace = new ResourceWorkspace({ storage, readPack, fallbackProfile })
  return { workspace, storage, readPack, fallbackProfile }
}

describe('resource workspace', () => {
  it('restores a valid pack beside a malformed record and falls back from a malformed profile', async () => {
    const { workspace, storage, fallbackProfile } = setup([pack('a'), { id: 'broken' } as ResourcePack])
    vi.mocked(storage.profile).mockResolvedValue({ value: { gameVersion: 'wrong' } as never })
    fallbackProfile.mockResolvedValue(profile())
    await workspace.restore()
    expect(workspace.getSnapshot()).toMatchObject({ ready: true, packs: [pack('a')], profile: { gameVersion: '26.2' } })
    expect(workspace.getSnapshot().error).toContain('invalid')
    expect(storage.saveProfile).toHaveBeenCalledOnce()
    expect(storage.removePack).not.toHaveBeenCalled()
    expect(storage.savePacks).not.toHaveBeenCalled()
  })

  it('keeps resources usable when the profile store fails and no fallback exists', async () => {
    const { workspace, storage } = setup([pack('a')])
    vi.mocked(storage.profile).mockRejectedValue(new Error('profile unavailable'))
    await workspace.restore()
    expect(workspace.getSnapshot()).toMatchObject({ ready: true, packs: [pack('a')], profile: null, catalog: DEMO_MATERIALS })
    expect(workspace.getSnapshot().error).toContain('profile unavailable')
  })

  it('uses a fetched profile for this session when caching fails and reports persistence explicitly', async () => {
    const { workspace, storage, fallbackProfile } = setup([pack('a')])
    fallbackProfile.mockResolvedValue(profile())
    vi.mocked(storage.saveProfile).mockRejectedValue(new Error('storage full'))
    await workspace.restore()
    expect(workspace.getSnapshot()).toMatchObject({ ready: true, profile: profile(), packs: [pack('a')] })
    expect(workspace.getSnapshot().catalog[0].id).toBe('minecraft:test')
    expect(workspace.getSnapshot().error).toContain('available for this session but could not be saved: storage full')
  })

  it('excludes unsupported stored game versions from the active stack without changing storage', async () => {
    const { workspace, storage } = setup([pack('a'), { ...pack('old', 10), gameVersion: '26.1' }])
    await workspace.restore()
    expect(workspace.getSnapshot().packs).toEqual([pack('a')])
    expect(workspace.getSnapshot().error).toContain('unsupported and was left untouched')
    expect(storage.savePack).not.toHaveBeenCalled()
    expect(storage.savePacks).not.toHaveBeenCalled()
    expect(storage.removePack).not.toHaveBeenCalled()
  })

  it('withholds a restored mismatched profile and its registry while retaining the client pack', async () => {
    const client = { ...pack('client'), source: 'client' as const, sourceSha1: 'b'.repeat(40) }
    const { workspace, storage } = setup([client])
    vi.mocked(storage.profile).mockResolvedValue({ value: profile() })
    await workspace.restore()
    expect(workspace.getSnapshot()).toMatchObject({ ready: true, profile: null, catalog: DEMO_MATERIALS, packs: [client] })
    expect(workspace.getSnapshot().error).toContain('fingerprints differ')
    expect(storage.saveProfile).not.toHaveBeenCalled()
    expect(storage.removePack).not.toHaveBeenCalled()
  })

  it('does not cache a fetched profile that mismatches restored client assets', async () => {
    const { workspace, storage, fallbackProfile } = setup([{ ...pack('client'), source: 'client', sourceSha1: 'b'.repeat(40) }])
    fallbackProfile.mockResolvedValue(profile())
    await workspace.restore()
    expect(workspace.getSnapshot()).toMatchObject({ ready: true, profile: null, catalog: DEMO_MATERIALS })
    expect(workspace.getSnapshot().error).toContain('fingerprints differ')
    expect(storage.saveProfile).not.toHaveBeenCalled()
  })

  it('retains the stored profile even if the pack store fails', async () => {
    const { workspace, storage, fallbackProfile } = setup()
    vi.mocked(storage.packs).mockRejectedValue(new Error('packs unavailable'))
    vi.mocked(storage.profile).mockResolvedValue({ value: profile() })
    await workspace.restore()
    expect(workspace.getSnapshot().profile).toEqual(profile())
    expect(fallbackProfile).not.toHaveBeenCalled()
    expect(workspace.getSnapshot().ready).toBe(true)
  })

  it('rejects duplicate content without writing or publishing a second pack', async () => {
    const { workspace, storage, readPack } = setup([pack('a')])
    readPack.mockResolvedValue({ ...pack('other'), fingerprint: pack('a').fingerprint })
    await workspace.restore()
    await workspace.importPack(new File([], 'duplicate.zip'))
    expect(workspace.getSnapshot().packs).toHaveLength(1)
    expect(workspace.getSnapshot().error).toContain('already been imported')
    expect(storage.savePack).not.toHaveBeenCalled()
  })

  it('does not publish a write until persistence succeeds and ignores overlapping mutations', async () => {
    const { workspace, storage } = setup([pack('a')])
    let complete!: () => void
    vi.mocked(storage.savePack).mockImplementation(() => new Promise<void>(resolve => { complete = resolve }))
    await workspace.restore()
    const pending = workspace.togglePack('a')
    expect(workspace.getSnapshot()).toMatchObject({ busy: true, packs: [{ enabled: true }] })
    await workspace.removePack('a')
    expect(storage.removePack).not.toHaveBeenCalled()
    complete()
    await pending
    expect(workspace.getSnapshot()).toMatchObject({ busy: false, packs: [{ enabled: false }] })
  })

  it('preserves the stack on reorder persistence failure and permits the next operation', async () => {
    const { workspace, storage } = setup([pack('a', 1), pack('b', 2)])
    vi.mocked(storage.savePacks).mockRejectedValueOnce(new Error('storage full'))
    await workspace.restore()
    const before = workspace.getSnapshot().packs
    await workspace.movePack('a', 'up')
    expect(workspace.getSnapshot().packs).toBe(before)
    expect(workspace.getSnapshot()).toMatchObject({ busy: false, error: 'storage full' })
    await workspace.movePack('a', 'up')
    expect(workspace.getSnapshot().packs.map(p => p.id)).toEqual(['a', 'b'])
    expect(workspace.getSnapshot().error).toBeNull()
    expect(storage.savePacks).toHaveBeenLastCalledWith(workspace.getSnapshot().packs)
  })

  it('recovers from archive failure and imports the next pack at the highest precedence', async () => {
    const { workspace, storage, readPack } = setup([pack('a', 100)])
    readPack.mockRejectedValueOnce(new Error('bad ZIP'))
    await workspace.restore()
    await workspace.importPack(new File([], 'bad.zip'))
    expect(workspace.getSnapshot()).toMatchObject({ busy: false, error: 'bad ZIP' })
    expect(storage.savePack).not.toHaveBeenCalled()
    await workspace.importPack(new File([], 'new.zip'))
    expect(workspace.getSnapshot().packs.map(p => p.id)).toEqual(['new', 'a'])
  })

  it('reports a JAR/profile mismatch before writing imported resources', async () => {
    const { workspace, storage, readPack } = setup()
    vi.mocked(storage.profile).mockResolvedValue({ value: profile() })
    readPack.mockResolvedValue({ ...pack('client'), source: 'client', sourceSha1: 'b'.repeat(40) })
    await workspace.restore()
    await workspace.importPack(new File([], 'client.jar'))
    expect(workspace.getSnapshot().error).toContain('fingerprints differ')
    expect(storage.savePack).not.toHaveBeenCalled()
  })

  it('keeps the previous profile after an invalid profile import or persistence failure', async () => {
    const { workspace, storage } = setup()
    vi.mocked(storage.profile).mockResolvedValue({ value: profile() })
    await workspace.restore()
    const before = workspace.getSnapshot().profile
    await workspace.importProfile(new File(['{}'], 'invalid.json'))
    expect(workspace.getSnapshot().profile).toBe(before)
    vi.mocked(storage.saveProfile).mockRejectedValueOnce(new Error('storage full'))
    await workspace.importProfile(new File([JSON.stringify(profile())], 'profile.json'))
    expect(workspace.getSnapshot().profile).toBe(before)
    expect(workspace.getSnapshot()).toMatchObject({ busy: false, error: 'storage full' })
  })

  it('summarizes a large profile validation failure without publishing its entire issue list', async () => {
    const { workspace } = setup()
    await workspace.restore()
    const invalid = { ...profile(), blocks: Array.from({ length: 100 }, () => ({})) }
    await workspace.importProfile(new File([JSON.stringify(invalid)], 'invalid.json'))
    expect(workspace.getSnapshot().error).toContain('Invalid game profile.')
    expect(workspace.getSnapshot().error).toContain('more issues')
    expect(workspace.getSnapshot().error!.length).toBeLessThan(1000)
    expect(workspace.getSnapshot().profile).toBeNull()
  })
})

describe('resource precedence', () => {
  it('uses deterministic ties for both model and texture indices independent of input order', () => {
    const a = pack('a'), b = pack('b'), disabled = { ...pack('c', 4), enabled: false }, foreign = { ...pack('d', 5), gameVersion: 'other' }
    expect(orderedPacks([b, a]).map(pack => pack.id)).toEqual(['a', 'b'])
    expect(effectiveAssetIndex([b, disabled, foreign, a]).get(path)).toBe(a.files[path])
    expect(new ModelResolver([a, foreign, b, disabled]).files.get(path)).toBe(a.files[path])
  })
  it('moves adjacent packs across equal priorities, renumbers without mutating originals, and keeps edge moves stable', () => {
    const a = pack('a'), b = pack('b'), packs = [a, b]
    expect(movePack(packs, 'a', 'up')).toBe(packs)
    const result = movePack(packs, 'b', 'up')
    expect(result.map(pack => pack.id)).toEqual(['b', 'a'])
    expect(result.map(pack => pack.priority)).toEqual([2, 1])
    expect(packs).toEqual([a, b])
    expect(a.priority).toBe(1)
    expect(b.priority).toBe(1)
  })
})
