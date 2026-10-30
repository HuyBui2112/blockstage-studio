import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { delimiter, join, resolve } from 'node:path'

// Reuses the verified prepare:game cache. All mutable world data is isolated in
// ignored artifacts; no dedicated server, network listener or user world is used.
const cache = resolve('node_modules/.cache/game-profile/26.2')
const classpath = (await readFile(join(cache, 'classpath.txt'), 'utf8')).trim()
const client = classpath.split(delimiter)[0]
const metadata = JSON.parse(await readFile(join(cache, 'metadata.json'), 'utf8'))
assert.equal(metadata.id, '26.2')
assert.equal(createHash('sha1').update(await readFile(client)).digest('hex'), metadata.downloads.client.sha1)
const profile = JSON.parse(await readFile(resolve('public/generated/26.2.profile.json'), 'utf8'))
assert.equal(profile.sourceSha1, metadata.downloads.client.sha1)
let javaHome = process.env.BLOCKSTAGE_JAVA_HOME
if (!javaHome) {
  const found = spawnSync('mise', ['where', 'java@temurin-25.0.4+7.0.LTS'], { encoding: 'utf8', windowsHide: true })
  if (found.status === 0) javaHome = found.stdout.trim()
}
if (!javaHome) throw new Error('Use the existing Java 25 JDK through mise or BLOCKSTAGE_JAVA_HOME; run prepare:game first.')
const executable = name => join(javaHome, 'bin', name + (process.platform === 'win32' ? '.exe' : ''))
await access(executable('javac'))
await mkdir(resolve('artifacts'), { recursive: true })
const output = await mkdtemp(resolve('artifacts/placement-world-'))
await writeFile(join(output, 'invocation.json'), JSON.stringify({
  gameVersion: '26.2', dataVersion: 4903, verifiedClientSha1: metadata.downloads.client.sha1,
  oracleSha256: createHash('sha256').update(await readFile(resolve('scripts/java/PlacementOracle.java'))).digest('hex'),
  runtime: 'vanilla GameTestServer ServerLevel; real ServerPlayer BlockPlaceContext; default vanilla feature flags',
}, null, 2))
function run(program, args) {
  const result = spawnSync(executable(program), args, { cwd: output, stdio: 'inherit', windowsHide: true, timeout: 180_000 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${program} failed (${result.status}); evidence: ${output}`)
}
run('javac', ['-cp', classpath, '-d', cache, resolve('scripts/java/PlacementOracle.java')])
run('java', ['-Xmx2G', '-Djava.awt.headless=true', '-cp', [cache, classpath].join(delimiter), 'PlacementOracle', output])
const report = JSON.parse(await readFile(join(output, 'placement-oracle.json'), 'utf8'))
assert.equal(report.gameVersion, '26.2')
assert.equal(report.dataVersion, 4903)
assert.deepEqual(report.enabledFeatures, ['minecraft:vanilla'])
assert.ok(report.placementCases.length >= 50)
assert.equal(report.families.chain.length, 9)
assert.equal(report.families.lantern.length, 10)
assert.equal(report.lanternAttachmentCases.length, 336)
assert.ok(report.neighborCases.length > 400)
for(const fixture of report.neighborCases){assert.equal(fixture.ticks,20);assert.deepEqual(fixture.afterTicks,fixture.readback)}
for (const fixture of report.lanternAttachmentCases) {
  assert.equal(fixture.ticks, 20)
  assert.equal(fixture.itemPlaced, !fixture.state.null)
  assert.equal(fixture.afterSupportRemoval.name, 'minecraft:air')
  if (fixture.itemPlaced) {
    assert.deepEqual(fixture.readback, fixture.state)
    assert.deepEqual(fixture.afterTicks, fixture.state)
  } else assert.equal(fixture.readback.name, 'minecraft:air')
}
assert.equal(report.supportCases.find(entry => entry.name === 'floating-bed-pair').survivesAfterTicks, true)
report.verifiedClientSha1 = metadata.downloads.client.sha1
await writeFile(join(output, 'placement-oracle.json'), JSON.stringify(report, null, 2))
await writeFile(join(cache, 'placement-oracle.json'), JSON.stringify(report, null, 2))
console.log(`Verified ${report.placementCases.length} actual placement contexts, ${report.supportCases.length} survival, ${report.lanternAttachmentCases.length} lantern and ${report.neighborCases.length} neighbor readback fixtures. Evidence: ${output}`)
