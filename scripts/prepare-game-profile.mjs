import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, join, delimiter } from 'node:path'
import { spawnSync } from 'node:child_process'
import { unzipSync, strFromU8, zipSync, strToU8 } from 'fflate'

// Runs the user's vanilla client classes headlessly. Never modifies the client or a world.
const jar = resolve(process.argv[2] ?? 'public/26.2.jar')
const bytes = await readFile(jar)
const files = unzipSync(bytes, { filter: f => f.name === 'version.json' })
const version = JSON.parse(strFromU8(files['version.json']))
if (version.id !== '26.2' || version.world_version !== 4903) throw new Error('Only Java 26.2 / 4903 is supported')
const cache = resolve('node_modules/.cache/game-profile/26.2')
await mkdir(cache, { recursive: true })
const metadataFile = join(cache, 'metadata.json')
let metadata
try { metadata = JSON.parse(await readFile(metadataFile, 'utf8')) }
catch {
  const manifest = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json').then(r => r.json())
  const entry = manifest.versions.find(v => v.id === version.id)
  if (!entry) throw new Error('Version missing from Mojang manifest')
  metadata = await fetch(entry.url).then(r => r.json())
  await writeFile(metadataFile, JSON.stringify(metadata))
}
const digest = b => createHash('sha1').update(b).digest('hex')
if (digest(bytes) !== metadata.downloads.client.sha1) throw new Error('Client checksum differs from official 26.2; modded extraction requires its own profile')
const libraries = []
let reused = 0, downloaded = 0
for (const library of metadata.libraries) {
  const artifact = library.downloads?.artifact
  if (!artifact || library.name.includes(':natives-')) continue
  const existing = process.env.APPDATA ? join(process.env.APPDATA, '.minecraft/libraries', artifact.path) : ''
  const cached = join(cache, 'libraries', artifact.path)
  let selected
  for (const candidate of [existing, cached].filter(Boolean)) {
    try { if (digest(await readFile(candidate)) === artifact.sha1) { selected = candidate; reused++; break } } catch { /* missing local library */ }
  }
  if (!selected) {
    const response = await fetch(artifact.url)
    if (!response.ok) throw new Error(`Library download failed: ${library.name}`)
    const data = new Uint8Array(await response.arrayBuffer())
    if (digest(data) !== artifact.sha1) throw new Error(`Invalid library checksum: ${library.name}`)
    await mkdir(resolve(cached, '..'), { recursive: true }); await writeFile(cached, data)
    selected = cached; downloaded++
  }
  libraries.push(selected)
}
const configuredJava = process.env.BLOCKSTAGE_JAVA_HOME
let javaHome = configuredJava
if (!javaHome) {
  const found = spawnSync('mise', ['where', 'java@temurin-25.0.4+7.0.LTS'], { encoding: 'utf8', windowsHide: true })
  if (found.status === 0) javaHome = found.stdout.trim()
}
if (!javaHome) throw new Error('Java 25 JDK required. Set BLOCKSTAGE_JAVA_HOME to an existing JDK; no runtime is installed automatically.')
await access(join(javaHome, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac'))
const classpath = [jar, ...libraries].join(delimiter)
await writeFile(join(cache, 'classpath.txt'), classpath)
const run = (program, args) => {
  const result = spawnSync(join(javaHome, 'bin', program + (process.platform === 'win32' ? '.exe' : '')), args, { stdio: 'inherit', windowsHide: true, cwd: cache })
  if (result.status !== 0) throw new Error(`${program} failed (${result.status})`)
}
run('javac', ['-cp', classpath, '-d', cache, resolve('scripts/java/ExtractProfile.java')])
const output = join(cache, 'profile.json')
run('java', ['-Djava.awt.headless=true', '-Xmx2G', '-cp', [cache, classpath].join(delimiter), 'ExtractProfile', output, jar])
const profile = JSON.parse(await readFile(output, 'utf8'))
if(profile.creativeTabsError)throw new Error(`Creative tabs extraction failed: ${profile.creativeTabsError}`)
profile.sourceSha1 = digest(bytes)
await mkdir('public/generated', { recursive: true })
await writeFile('public/generated/26.2.profile.json', JSON.stringify(profile))
// An importable sidecar keeps generated model geometry separate from the client JAR.
await writeFile('public/generated/26.2.profile.zip', zipSync({ 'blockstage-profile.json': strToU8(JSON.stringify(profile)) }))
console.log(JSON.stringify({ blocks: profile.blocks.length, entities: profile.entities.length, modelLayers: Object.keys(profile.entityModels).length, tabs: profile.creativeTabs.length, librariesReused: reused, librariesDownloaded: downloaded, output: 'public/generated/26.2.profile.json' }, null, 2))
