import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { archiveMetadata, inspectRuntime, parseArgs, writeReport } from './check-fabric-runtime.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const archive = (name, value) => Buffer.from(zipSync({ [name]: strToU8(JSON.stringify(value)) }))
const fixture = async action => {
  await mkdir(join(root, 'artifacts'), { recursive: true })
  assert.equal(await realpath(join(root, 'artifacts')), join(await realpath(root), 'artifacts'))
  const path = await mkdtemp(join(root, 'artifacts', 'fabric-readiness-test-'))
  try { await action(path) }
  finally {
    assert.equal(dirname(path), join(root, 'artifacts'))
    assert.equal(dirname(await realpath(path)), join(await realpath(root), 'artifacts'))
    await rm(path, { recursive: true, force: true })
  }
}

test('explicit instance uses metadata identity and fingerprints, never claims world proof', async () => fixture(async path => {
  const instance = join(path, '26.2-fabric-fixture')
  await mkdir(join(instance, 'mods'), { recursive: true })
  await mkdir(join(instance, 'resourcepacks', 'fixture-pack'), { recursive: true })
  const version = { id: '26.2-fabric-fixture', mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient', javaVersion: { majorVersion: 25 }, libraries: [{ name: 'net.fabricmc:fabric-loader:0.19.5' }] }
  await writeFile(join(instance, '26.2-fabric-fixture.json'), JSON.stringify(version))
  await writeFile(join(instance, '26.2-fabric-fixture.jar'), archive('version.json', { id: '26.2', world_version: 4903 }))
  const misleading = archive('fabric.mod.json', { schemaVersion: 1, id: 'ordinary_mod', version: '1.0', depends: { minecraft: '26.2' } })
  await writeFile(join(instance, 'mods', 'fabric-api-lie.jar'), misleading)
  const api = archive('fabric.mod.json', { schemaVersion: 1, id: 'fabric-api', version: 'fixture-api', depends: { fabricloader: '>=0.19.5' } })
  await writeFile(join(instance, 'mods', 'unrelated-name.jar'), api)
  await writeFile(join(instance, 'resourcepacks', 'fixture-pack', 'pack.mcmeta'), JSON.stringify({ pack: { min_format: 88, max_format: 88, description: 'fixture' } }))
  await writeFile(join(instance, 'resourcepacks', 'tiny.zip'), archive('pack.mcmeta', { pack: { pack_format: 88 } }))
  const report = await inspectRuntime({ instance }, {})
  assert.equal(report.readiness, 'INVENTORIED_NOT_LAUNCHED')
  assert.deepEqual(report.problems, [])
  assert.equal(report.worldReadback.status, 'UNVERIFIED')
  assert.equal(report.instance.clients[0].embeddedVersion, '26.2')
  assert.equal(report.instance.clients[0].dataVersion, 4903)
  assert.equal(report.instance.targetClient, 'MATCHING_METADATA_PRESENT')
  assert.equal(report.instance.runtimeJava, 'UNVERIFIED_LAUNCHER_SELECTION_NOT_READ')
  assert.equal(report.instance.loaders[0].version, '0.19.5')
  assert.equal(report.instance.loaders[0].present, false)
  assert.deepEqual(report.instance.fabricApi, [{ version: 'fixture-api', sha256: hash(api) }])
  assert.equal(report.instance.mods.find(mod => mod.id === 'ordinary_mod').sha256, hash(misleading))
  assert.equal(report.instance.resourcePacks.length, 2)
  assert.equal(report.instance.packEnablement, 'UNVERIFIED_OPTIONS_NOT_READ')
  assert.equal(report.instance.nestedMods, 'NOT_ENUMERATED')
}))

test('default discovery reads only exact version manifests and known mise release files', async () => fixture(async path => {
  const appdata = join(path, 'roaming')
  const version = join(appdata, '.minecraft', 'versions', 'named-fixture')
  await mkdir(version, { recursive: true })
  await writeFile(join(version, 'named-fixture.json'), JSON.stringify({ id: 'named-fixture', libraries: [{ name: 'net.fabricmc:fabric-loader:0.19.3' }] }))
  // Malformed sensitive filenames would fail JSON parsing if the audit read them.
  await writeFile(join(version, 'usercache.json'), 'DO NOT READ')
  await writeFile(join(version, 'debug-profile.json'), 'DO NOT READ')
  await mkdir(join(appdata, '.minecraft', 'mods'))
  await writeFile(join(appdata, '.minecraft', 'mods', 'not-an-archive.jar'), 'DO NOT READ')
  const localappdata = join(path, 'local')
  const java = join(localappdata, 'mise', 'installs', 'java', 'fixture-25')
  await mkdir(java, { recursive: true })
  await writeFile(join(java, 'release'), 'JAVA_VERSION="25.0.4"\nIMPLEMENTOR="Fixture"\n')
  const report = await inspectRuntime({}, { APPDATA: appdata, LOCALAPPDATA: localappdata })
  assert.equal(report.readiness, 'INSTANCE_SELECTION_REQUIRED')
  assert.deepEqual(report.problems, [])
  assert.equal(report.candidates.length, 1)
  assert.deepEqual(report.candidates[0].loaderVersions, ['0.19.3'])
  assert.equal(report.instance, null)
  assert.equal(report.java[0].version, '25.0.4')
  assert.equal(report.java[0].probe, undefined)
}))

test('oversized archive metadata and directory enumeration are rejected before expansion', async () => fixture(async path => {
  const compressed = archive('fabric.mod.json', { id: 'x', padding: 'x'.repeat(1024 * 1024) })
  assert.throws(() => archiveMetadata(compressed, 'fabric.mod.json'), /bounded input/)
  assert.throws(() => archiveMetadata(Buffer.from('not zip'), 'fabric.mod.json'), /ZIP directory/)
  const mods = join(path, 'mods')
  await mkdir(mods)
  await Promise.all(Array.from({ length: 257 }, (_, index) => writeFile(join(mods, `${index}.txt`), '')))
  const report = await inspectRuntime({ instance: path }, {})
  assert.equal(report.readiness, 'INCOMPLETE_INVENTORY')
  assert.match(report.problems[0].reason, /256 entries/)
  assert.equal(report.worldReadback.status, 'UNVERIFIED')
}))

test('instance metadata cannot redirect outside the supplied directory', async () => fixture(async path => {
  const instance = join(path, 'named-instance')
  await mkdir(instance)
  const other = join(path, 'outside-mods')
  await mkdir(other)
  await writeFile(join(other, 'unrelated.jar'), 'DO NOT READ')
  await symlink(other, join(instance, 'mods'), process.platform === 'win32' ? 'junction' : 'dir')
  const report = await inspectRuntime({ instance }, {})
  assert.equal(report.readiness, 'INCOMPLETE_INVENTORY')
  assert.equal(report.instance, null)
  assert.match(report.problems[0].reason, /escapes its metadata root/)
  assert.equal(report.worldReadback.status, 'UNVERIFIED')
}))

test('report output stays in workspace artifacts and rejects links and unsupported proof flags', async () => fixture(async path => {
  const report = { worldReadback: { status: 'UNVERIFIED' } }
  await assert.rejects(writeReport('../escape.json', report, path), /workspace artifacts/)
  await assert.rejects(writeReport('source.json', report, path), /workspace artifacts/)
  const output = await writeReport('artifacts/report.json', report, path)
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), report)
  await mkdir(join(path, 'elsewhere'))
  const link = join(path, 'artifacts', 'redirect')
  await symlink(join(path, 'elsewhere'), link, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(writeReport('artifacts/redirect/report.json', report, path), /symbolic links or junctions/)
  assert.throws(() => parseArgs(['--world-verified', 'true']), /Unknown argument/)
  assert.throws(() => parseArgs(['--instance']), /requires a path/)
}))
