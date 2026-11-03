import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, open, opendir, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { strFromU8, unzipSync } from 'fflate'

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MiB = 1024 * 1024
const limits = Object.freeze({ entries: 256, archiveEntries: 100000, metadataBytes: MiB, archiveBytes: 128 * MiB, profileBytes: 16 * MiB, totalBytes: 768 * MiB })
const inside = (root, path) => { const part = relative(root, path); return part === '' || (!part.startsWith(`..${sep}`) && part !== '..' && !isAbsolute(part)) }
const text = value => typeof value === 'string' && value.length <= 256 ? value : null
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

export function parseArgs(args) {
  const result = { output: 'artifacts/fabric-runtime-readiness.json', probeJava: false }
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    if (flag === '--help') result.help = true
    else if (flag === '--probe-java') result.probeJava = true
    else if (['--instance', '--output'].includes(flag)) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${flag} requires a path`)
      result[flag.slice(2)] = args[++i]
    } else throw new Error(`Unknown argument: ${flag}`)
  }
  return result
}

async function exists(path) { try { await lstat(path); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error } }

// Resolve every input before reading; instance entries may not redirect into unrelated data.
async function checkedPath(root, path) {
  const actual = await realpath(path)
  if (!inside(root, actual)) throw new Error('Input path escapes its metadata root')
  return actual
}

async function boundedEntries(root, path) {
  const actual = await checkedPath(root, path)
  const entries = []
  for await (const entry of await opendir(actual)) {
    if (entries.length >= limits.entries) throw new Error(`Directory exceeds ${limits.entries} entries`)
    entries.push(entry)
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))
}

function reader() {
  let consumed = 0
  const reserve = async (root, path, maximum) => {
    const actual = await checkedPath(root, path)
    const stat = await lstat(actual)
    if (!stat.isFile() || stat.size > maximum) throw new Error(`File exceeds bounded input policy (${maximum} bytes)`)
    consumed += stat.size
    if (consumed > limits.totalBytes) throw new Error('Aggregate input budget exceeded')
    return { actual, size: stat.size }
  }
  return {
    async bytes(root, path, maximum = limits.metadataBytes) {
      const { actual, size } = await reserve(root, path, maximum)
      const file = await open(actual, 'r')
      try {
        const bytes = Buffer.alloc(size + 1)
        let offset = 0
        while (offset < bytes.length) {
          const result = await file.read(bytes, offset, bytes.length - offset, offset)
          if (!result.bytesRead) break
          offset += result.bytesRead
        }
        if (offset > size) throw new Error('Input changed size during bounded read; retry inventory')
        return bytes.subarray(0, offset)
      } finally { await file.close() }
    },
    async fingerprint(root, path, maximum = limits.archiveBytes) {
      const { actual, size } = await reserve(root, path, maximum)
      const hash = createHash('sha256')
      let observed = 0
      for await (const chunk of createReadStream(actual)) {
        observed += chunk.length
        if (observed > size) throw new Error('Input changed size during bounded hash; retry inventory')
        hash.update(chunk)
      }
      if (observed !== size) throw new Error('Input changed size during bounded hash; retry inventory')
      return { file: path, bytes: size, sha256: hash.digest('hex') }
    },
    get consumed() { return consumed },
  }
}

// Inspect central-directory declarations before fflate can allocate metadata output.
// Only one exact metadata entry is ever decompressed; game assets/classes are ignored.
export function archiveMetadata(bytes, wanted) {
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break }
  }
  if (end < 0) throw new Error('Missing ZIP directory')
  const count = bytes.readUInt16LE(end + 10)
  const directoryBytes = bytes.readUInt32LE(end + 12)
  let offset = bytes.readUInt32LE(end + 16)
  const directoryEnd = offset + directoryBytes
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || count === 65535 || count > limits.archiveEntries || directoryEnd !== end) throw new Error('Unsupported ZIP directory')
  let found = false
  for (let i = 0; i < count; i++) {
    if (offset + 46 > directoryEnd || bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid ZIP directory entry')
    const nameBytes = bytes.readUInt16LE(offset + 28)
    const entryEnd = offset + 46 + nameBytes + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32)
    if (entryEnd > directoryEnd) throw new Error('ZIP directory entry out of bounds')
    const name = bytes.subarray(offset + 46, offset + 46 + nameBytes).toString('utf8')
    if (name === wanted) {
      if (found) throw new Error('Duplicate archive metadata')
      found = true
      if (bytes.readUInt32LE(offset + 24) > limits.metadataBytes || bytes.readUInt16LE(offset + 8) & 1) throw new Error('Archive metadata exceeds bounded input policy')
    }
    offset = entryEnd
  }
  if (offset !== directoryEnd) throw new Error('ZIP directory length mismatch')
  if (!found) return null
  const files = unzipSync(bytes, { filter: entry => {
    if (entry.name !== wanted) return false
    if (entry.originalSize > limits.metadataBytes) throw new Error('Archive metadata exceeds bounded input policy')
    return true
  } })
  const metadata = files[wanted]
  if (!metadata || metadata.length > limits.metadataBytes) throw new Error('Invalid archive metadata')
  return { sha256: sha256(metadata), value: JSON.parse(strFromU8(metadata)) }
}

async function inspectVersion(read, root, path) {
  const bytes = await read.bytes(root, path)
  const value = JSON.parse(bytes)
  const libraries = Array.isArray(value.libraries) ? value.libraries : []
  if (libraries.length > 4096) throw new Error('Version library metadata exceeds budget')
  const loaderLibraries = libraries.map(item => text(item?.name)).filter(name => name?.startsWith('net.fabricmc:fabric-loader:'))
  return {
    file: path, sha256: sha256(bytes), id: text(value.id), inheritsFrom: text(value.inheritsFrom),
    mainClass: text(value.mainClass), declaredJavaMajor: Number.isInteger(value.javaVersion?.majorVersion) ? value.javaVersion.majorVersion : null,
    loaderVersions: loaderLibraries.map(name => name.split(':')[2]),
    declaredClientSha1: /^[a-f0-9]{40}$/i.test(value.downloads?.client?.sha1 ?? '') ? value.downloads.client.sha1 : null,
    // Library coordinates, rather than launcher names, identify the declared loader.
    loaderLibraries,
  }
}

async function inspectArchive(read, root, path, metadataName) {
  const bytes = await read.bytes(root, path, limits.archiveBytes)
  return { file: path, bytes: bytes.length, sha256: sha256(bytes), metadata: archiveMetadata(bytes, metadataName) }
}

async function inspectInstance(read, requested, problems) {
  const root = await realpath(resolve(requested))
  const nested = join(root, '.minecraft')
  const gameRoot = await exists(nested) ? await checkedPath(root, nested) : root
  const name = root.split(sep).at(-1)
  const direct = join(root, `${name}.json`)
  const result = { path: root, gameDirectory: gameRoot, versions: [], clients: [], loaders: [], mods: [], resourcePacks: [] }
  const attempt = async (label, action) => { try { return await action() } catch (error) { problems.push({ scope: label, reason: error.message }); return null } }
  if (await exists(direct)) {
    const version = await attempt('version metadata', () => inspectVersion(read, root, direct))
    if (version) result.versions.push(version)
  } else if (await exists(join(gameRoot, 'versions'))) {
    for (const entry of await boundedEntries(root, join(gameRoot, 'versions'))) {
      if (!entry.isDirectory()) continue
      const path = join(gameRoot, 'versions', entry.name, `${entry.name}.json`)
      if (!await exists(path)) continue
      const version = await attempt(`version ${entry.name}`, () => inspectVersion(read, root, path))
      if (version) result.versions.push(version)
    }
  }
  for (const version of result.versions) {
    const path = join(dirname(version.file), `${version.id}.jar`)
    // An untrusted version id must never become a path traversal.
    if (version.id && !/[\\/]/.test(version.id) && await exists(path)) {
      const archive = await attempt('client archive', () => inspectArchive(read, root, path, 'version.json'))
      if (archive) result.clients.push({ file: archive.file, bytes: archive.bytes, sha256: archive.sha256,
        embeddedVersion: text(archive.metadata?.value?.id), dataVersion: archive.metadata?.value?.world_version ?? null,
        metadataSha256: archive.metadata?.sha256 ?? null })
    }
  }
  // Version-directory installs conventionally share only libraries with their .minecraft parent.
  const libraryRoot = dirname(root).split(sep).at(-1) === 'versions' ? resolve(root, '../..') : gameRoot
  const actualLibraryRoot = await realpath(libraryRoot)
  for (const version of result.versions) for (const loader of version.loaderVersions) {
    if (!/^[a-zA-Z0-9.+_-]{1,100}$/.test(loader)) continue
    const path = join(actualLibraryRoot, 'libraries/net/fabricmc/fabric-loader', loader, `fabric-loader-${loader}.jar`)
    const archive = await exists(path) ? await attempt('loader archive', () => inspectArchive(read, actualLibraryRoot, path, 'fabric.mod.json')) : null
    result.loaders.push({ version: loader, coordinate: `net.fabricmc:fabric-loader:${loader}`, present: Boolean(archive),
      ...(archive ? { file: archive.file, sha256: archive.sha256, metadataId: text(archive.metadata?.value?.id), metadataVersion: text(archive.metadata?.value?.version) } : {}) })
  }
  const mods = join(gameRoot, 'mods')
  if (await exists(mods)) for (const entry of await boundedEntries(root, mods)) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.jar')) continue
    const archive = await attempt(`mod ${entry.name}`, () => inspectArchive(read, root, join(mods, entry.name), 'fabric.mod.json'))
    if (!archive) continue
    const meta = archive.metadata?.value
    const depends = Object.fromEntries(['minecraft', 'fabricloader', 'java', 'fabric-api'].flatMap(id => {
      const value = meta?.depends?.[id]
      return typeof value === 'string' && value.length <= 256 ? [[id, value]] : []
    }))
    result.mods.push({ file: archive.file, bytes: archive.bytes, sha256: archive.sha256, id: text(meta?.id), version: text(meta?.version), metadataSha256: archive.metadata?.sha256 ?? null, declaredDepends: depends,
      metadataStatus: meta ? 'PRESENT_NOT_RESOLVED' : 'NO_ROOT_FABRIC_METADATA' })
  }
  const packs = join(gameRoot, 'resourcepacks')
  if (await exists(packs)) for (const entry of await boundedEntries(root, packs)) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.zip')) {
      const archive = await attempt(`pack ${entry.name}`, () => inspectArchive(read, root, join(packs, entry.name), 'pack.mcmeta'))
      if (archive) result.resourcePacks.push({ file: archive.file, sha256: archive.sha256, manifestSha256: archive.metadata?.sha256 ?? null })
    } else if (entry.isDirectory() && await exists(join(packs, entry.name, 'pack.mcmeta'))) {
      const manifest = await attempt(`pack manifest ${entry.name}`, () => read.fingerprint(root, join(packs, entry.name, 'pack.mcmeta'), limits.metadataBytes))
      if (manifest) result.resourcePacks.push({ ...manifest, coverage: 'MANIFEST_ONLY_NO_ASSET_HASH' })
    }
  }
  result.fabricApi = result.mods.filter(mod => mod.id === 'fabric-api').map(mod => ({ version: mod.version, sha256: mod.sha256 }))
  result.targetClient = result.clients.some(client => client.embeddedVersion === '26.2' && client.dataVersion === 4903) ? 'MATCHING_METADATA_PRESENT' : 'UNVERIFIED_NO_MATCHING_CLIENT_METADATA'
  result.runtimeJava = 'UNVERIFIED_LAUNCHER_SELECTION_NOT_READ'
  result.modEnablement = 'AVAILABLE_ROOT_JARS_ONLY_NOT_LOADER_RESOLVED'
  result.packEnablement = 'UNVERIFIED_OPTIONS_NOT_READ'
  result.nestedMods = 'NOT_ENUMERATED'
  return result
}

async function discoverVersions(read, env, problems) {
  if (!env.APPDATA) return []
  const rootPath = join(env.APPDATA, '.minecraft')
  if (!await exists(join(rootPath, 'versions'))) return []
  const root = await realpath(rootPath)
  const candidates = []
  for (const entry of await boundedEntries(root, join(root, 'versions'))) {
    if (!entry.isDirectory()) continue
    const path = join(root, 'versions', entry.name, `${entry.name}.json`)
    if (!await exists(path)) continue
    try { candidates.push(await inspectVersion(read, root, path)) }
    catch (error) { problems.push({ scope: `candidate ${entry.name}`, reason: error.message }) }
  }
  return candidates
}

async function inspectJava(read, env, probe) {
  if (!env.LOCALAPPDATA) return []
  const rootPath = join(env.LOCALAPPDATA, 'mise/installs/java')
  if (!await exists(rootPath)) return []
  const root = await realpath(rootPath)
  const results = []
  for (const entry of await boundedEntries(root, root)) {
    if (!entry.isDirectory()) continue
    const release = join(root, entry.name, 'release')
    if (!await exists(release)) continue
    const bytes = await read.bytes(root, release)
    const fields = Object.fromEntries(bytes.toString('utf8').split(/\r?\n/).flatMap(line => {
      const match = /^(JAVA_VERSION|IMPLEMENTOR)="([^"\r\n]{1,256})"$/.exec(line)
      return match ? [[match[1], match[2]]] : []
    }))
    const result = { installation: entry.name, releaseFile: release, version: fields.JAVA_VERSION ?? null, implementor: fields.IMPLEMENTOR ?? null, releaseSha256: sha256(bytes) }
    if (probe) {
      const executable = await checkedPath(root, join(root, entry.name, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'))
      const run = spawnSync(executable, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 8192 })
      result.probe = { exitCode: run.status, output: `${run.stdout ?? ''}${run.stderr ?? ''}`.slice(0, 4096), error: run.error?.message ?? null }
    }
    results.push(result)
  }
  return results
}

export async function inspectRuntime(options = {}, env = process.env) {
  const read = reader()
  const problems = []
  const report = {
    schema: 'blockstage-fabric-readiness-v1', generatedAt: new Date().toISOString(),
    target: { minecraft: '26.2', dataVersion: 4903, javaMajor: 25 },
    readiness: options.instance ? 'INVENTORIED_NOT_LAUNCHED' : 'INSTANCE_SELECTION_REQUIRED',
    worldReadback: { status: 'UNVERIFIED', reason: 'No Minecraft launch, datapack enable/reload/place, or world readback was performed. Metadata and fingerprints cannot close Q02.' },
    candidates: [], instance: null, java: [], workspaceFingerprints: [], problems,
    limits, scope: 'Read-only exact version manifests, root mod metadata, pack fingerprints and known mise Java release metadata. No accounts, worlds, options, logs, network or installation changes.',
  }
  try {
    if (options.instance) report.instance = await inspectInstance(read, options.instance, problems)
    else report.candidates = await discoverVersions(read, env, problems)
  } catch (error) { problems.push({ scope: 'instance discovery', reason: error.message }) }
  try { report.java = await inspectJava(read, env, options.probeJava) }
  catch (error) { problems.push({ scope: 'known mise Java', reason: error.message }) }
  for (const file of ['public/26.2.jar', 'public/generated/26.2.profile.json', 'node_modules/.cache/game-profile/26.2/metadata.json']) {
    const path = join(workspace, file)
    if (!await exists(path)) continue
    try { report.workspaceFingerprints.push(await read.fingerprint(workspace, path, file.endsWith('.jar') ? limits.archiveBytes : limits.profileBytes)) }
    catch (error) { problems.push({ scope: file, reason: error.message }) }
  }
  report.readBytes = read.consumed
  if (problems.length) report.readiness = 'INCOMPLETE_INVENTORY'
  return report
}

export async function writeReport(output, report, root = workspace) {
  const artifacts = join(root, 'artifacts')
  const target = resolve(root, output)
  if (!inside(artifacts, target) || target === artifacts || !target.endsWith('.json')) throw new Error('--output must be a JSON file inside workspace artifacts/')
  // Check existing ancestor links before mkdir/write; output may never follow a junction out.
  for (let current = target; inside(root, current); current = dirname(current)) {
    if (await exists(current)) {
      const actual = await realpath(current)
      if (!inside(await realpath(root), actual)) throw new Error('Output path resolves outside workspace')
      if ((await lstat(current)).isSymbolicLink()) throw new Error('Output may not traverse symbolic links or junctions')
    }
    if (current === root) break
  }
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, { flag: 'w' })
  return target
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.help) console.log('Usage: node scripts/check-fabric-runtime.mjs [--instance <game-or-version-directory>] [--output artifacts/fabric-runtime-readiness.json] [--probe-java]\nDefault discovers only exact conventional version manifests; pass an explicit instance to inventory mods/packs. Never launches Minecraft. World readback stays UNVERIFIED.')
    else {
      const report = await inspectRuntime(options)
      const output = await writeReport(options.output, report)
      console.log(JSON.stringify({ readiness: report.readiness, worldReadback: report.worldReadback.status, candidates: report.candidates.length, mods: report.instance?.mods.length ?? 0, problems: report.problems.length, output }, null, 2))
      if (report.problems.length) process.exitCode = 1
    }
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
