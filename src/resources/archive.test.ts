import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { parsePack } from '../io/archive'

describe('resource archive provenance and bounds', () => {
  const assets = { 'assets/minecraft/models/block/test.json': strToU8('{}') }
  it('distinguishes client assets from a resource override', () => {
    const client = parsePack(zipSync({ ...assets, 'version.json': strToU8(JSON.stringify({ id: '26.2', world_version: 4903 })) }), 'client.jar')
    const override = parsePack(zipSync({ ...assets, 'pack.mcmeta': strToU8(JSON.stringify({ pack: { pack_format: 88 } })) }), 'override.zip')
    expect(client.source).toBe('client')
    expect(override.source).toBe('resource')
  })
  it('rejects stored entries whose advertised original size understates their allocation', () => {
    const bytes = zipSync({ ...assets, 'pack.mcmeta': strToU8(JSON.stringify({ pack: { pack_format: 88 } })) }, { level: 0 })
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    for (let i = 0; i < bytes.length - 46; i++) {
      if (view.getUint32(i, true) === 0x02014b50) { view.setUint32(i + 24, 1, true); break }
    }
    expect(() => parsePack(bytes, 'inconsistent.zip')).toThrow('Invalid stored ZIP entry size')
  })
})
