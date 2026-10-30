import { inflateRawSync } from 'node:zlib'
// Public Mojang metadata only. Reads ZIP metadata with HTTP ranges, no game assets saved.
const manifest = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json').then(r => r.json())
const entry = manifest.versions.find(v => v.id === (process.argv[2] ?? '26.2'))
if (!entry) throw new Error('Version not found')
const metadata = await fetch(entry.url).then(r => r.json())
console.log(JSON.stringify({ id: metadata.id, releaseTime: metadata.releaseTime, javaVersion: metadata.javaVersion, client: metadata.downloads.client.url }, null, 2))
if (process.argv.includes('--verify-jar')) {
  const url = metadata.downloads.client.url
  async function range(value) {
    const res = await fetch(url, { headers: { Range: value } })
    if (res.status !== 206) { await res.body?.cancel(); throw new Error('Server must support HTTP Range') }
    return Buffer.from(await res.arrayBuffer())
  }
  const tail = await range('bytes=-65557')
  let end = tail.length - 22
  while (end >= 0 && tail.readUInt32LE(end) !== 0x06054b50) end--
  if (end < 0) throw new Error('Missing ZIP directory')
  const directoryOffset = tail.readUInt32LE(end + 16), directorySize = tail.readUInt32LE(end + 12)
  const directory = await range(`bytes=${directoryOffset}-${directoryOffset + directorySize - 1}`)
  for (let p = 0; p < directory.length;) {
    if (directory.readUInt32LE(p) !== 0x02014b50) throw new Error('Invalid ZIP directory')
    const length = directory.readUInt16LE(p + 28), extra = directory.readUInt16LE(p + 30), comment = directory.readUInt16LE(p + 32)
    const name = directory.toString('utf8', p + 46, p + 46 + length)
    if (name === 'version.json') {
      const offset = directory.readUInt32LE(p + 42), size = directory.readUInt32LE(p + 20), method = directory.readUInt16LE(p + 10)
      const header = await range(`bytes=${offset}-${offset + 29}`)
      const start = offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28)
      const bytes = await range(`bytes=${start}-${start + size - 1}`)
      const version = JSON.parse((method === 8 ? inflateRawSync(bytes) : bytes).toString('utf8'))
      console.log(JSON.stringify(version, null, 2)); break
    }
    p += 46 + length + extra + comment
  }
}
