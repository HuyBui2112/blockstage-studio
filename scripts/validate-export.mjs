import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { delimiter, join, resolve } from 'node:path'

// Uses only the existing prepare:game cache. GameTest's offline server creates a
// fresh world beneath ignored artifacts; no launcher saves/configuration is read.
const file = process.argv[2]
if (!file) throw new Error('Usage: node scripts/validate-export.mjs <structure.nbt> [expected.json] [datapack.zip]; run prepare:game first')
const expectedFile = process.argv[3]
const datapackFile = process.argv[4]
const cache = resolve('node_modules/.cache/game-profile/26.2')
const classpath = (await readFile(join(cache, 'classpath.txt'), 'utf8')).trim()
const client = classpath.split(delimiter)[0]
const metadata = JSON.parse(await readFile(join(cache, 'metadata.json'), 'utf8'))
assert.equal(metadata.id, '26.2', 'Expected the prepared Minecraft Java 26.2 cache')
assert.equal(createHash('sha1').update(await readFile(client)).digest('hex'), metadata.downloads.client.sha1, 'Client hash must match the prepared 26.2 metadata')
const profile = JSON.parse(await readFile(resolve('public/generated/26.2.profile.json'), 'utf8'))
assert.equal(profile.sourceSha1, metadata.downloads.client.sha1, 'Profile and verified client must match')
let javaHome = process.env.BLOCKSTAGE_JAVA_HOME
if (!javaHome) {
  const located = spawnSync('mise', ['where', 'java@temurin-25.0.4+7.0.LTS'], { encoding: 'utf8', windowsHide: true })
  if (located.status === 0) javaHome = located.stdout.trim()
}
if (!javaHome) throw new Error('Use the existing Java 25 JDK via mise or BLOCKSTAGE_JAVA_HOME')
const executable = name => join(javaHome, 'bin', name + (process.platform === 'win32' ? '.exe' : ''))
await access(executable('javac'))
await access(resolve(file))
await mkdir(resolve('artifacts'), { recursive: true })
const runDirectory = await mkdtemp(resolve('artifacts/export-world-'))
await writeFile(join(runDirectory, 'invocation.json'), JSON.stringify({
  gameVersion: '26.2', dataVersion: 4903,
  verifiedClientSha1: metadata.downloads.client.sha1,
  fixtureSha256: createHash('sha256').update(await readFile(resolve(file))).digest('hex'),
  fixture: resolve(file), expected: expectedFile ? resolve(expectedFile) : undefined,
  templateSource: datapackFile ? 'datapack ZIP' : 'world generated-template NBT',
  datapack: datapackFile ? resolve(datapackFile) : undefined,
  datapackSha256: datapackFile ? createHash('sha256').update(await readFile(resolve(datapackFile))).digest('hex') : undefined,
  runtime: 'vanilla GameTestServer; no Fabric, no dedicated-server entrypoint, no EULA file',
}, null, 2))
function run(program, args) {
  const result = spawnSync(executable(program), args, { cwd: runDirectory, stdio: 'inherit', windowsHide: true, timeout: 180_000 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${program} failed (${result.status}); isolated evidence: ${runDirectory}`)
}
run('javac', ['-cp', classpath, '-d', cache, resolve('scripts/java/ValidateExport.java')])
run('java', ['-Xmx2G', '-Djava.awt.headless=true', '-cp', [cache, classpath].join(delimiter), 'ValidateExport', resolve(file), runDirectory, ...(datapackFile ? [resolve(datapackFile)] : [])])
if (expectedFile) {
  const expected = JSON.parse(await readFile(resolve(expectedFile), 'utf8'))
  const report = JSON.parse(await readFile(join(runDirectory, 'readback.json'), 'utf8'))
  assert.deepEqual(report.templateSize, expected.size)
  const sort = blocks => blocks.toSorted((a, b) => a.pos.join(',').localeCompare(b.pos.join(',')))
  const readback = sample => sort(sample.map(block => ({ pos: block.position, state: block.state })))
  assert.deepEqual(readback(report.beforeTicks), sort(expected.blocks), 'Immediate actual world must match the committed editor fixture')
  assert.deepEqual(readback(report.afterTicks), sort(expected.blocks), 'World after 20 ticks must match the committed editor fixture')
  const remaining = [...report.entitiesBeforeTicks]
  for (const entity of expected.entities) {
    const index = remaining.findIndex(actual => actual.id === entity.nbt.id && actual.position.every((value, axis) => Math.abs(value - entity.pos[axis]) < 0.00001)
      && Math.abs(((actual.yaw - entity.nbt.Rotation[0]) % 360 + 540) % 360 - 180) < 0.0001 && Math.abs(actual.pitch - entity.nbt.Rotation[1]) < 0.0001)
    assert.notEqual(index, -1, 'Immediate world entity type/position/rotation must match the committed editor fixture')
    remaining.splice(index, 1)
  }
  assert.equal(remaining.length, 0, 'World contains no unexpected immediate entities')
  console.log('World readback also matches the independent committed-editor expected JSON.')
}
console.log(`Isolated game-world evidence: ${runDirectory}`)
