import { readFile, access } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, join, delimiter } from 'node:path'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'

// Read-only class oracle using the existing prepare:game cache. No downloads,
// asset extraction or world construction. Output remains in ignored node_modules.
const cache = resolve('node_modules/.cache/game-profile/26.2')
const classpath = (await readFile(join(cache, 'classpath.txt'), 'utf8')).trim()
const client = classpath.split(delimiter)[0]
const metadata = JSON.parse(await readFile(join(cache, 'metadata.json'), 'utf8'))
assert.equal(createHash('sha1').update(await readFile(client)).digest('hex'), metadata.downloads.client.sha1, 'Local client must match the verified 26.2 cache')
let javaHome = process.env.BLOCKSTAGE_JAVA_HOME
if (!javaHome) {
  const result = spawnSync('mise', ['where', 'java@temurin-25.0.4+7.0.LTS'], { encoding: 'utf8', windowsHide: true })
  if (result.status === 0) javaHome = result.stdout.trim()
}
if (!javaHome) throw new Error('Use the existing Java 25 JDK through mise or BLOCKSTAGE_JAVA_HOME; run prepare:game first if the verified cache is missing.')
const executable = name => join(javaHome, 'bin', name + (process.platform === 'win32' ? '.exe' : ''))
await access(executable('javac'))
function run(program, args) {
  const result = spawnSync(executable(program), args, { cwd: cache, stdio: 'inherit', windowsHide: true })
  if (result.status !== 0) throw new Error(`${program} failed (${result.status})`)
}
run('javac', ['-cp', classpath, '-d', cache, resolve('scripts/java/EditorOracle.java')])
const output = join(cache, 'editor-oracle.json')
run('java', ['-Djava.awt.headless=true', '-cp', [cache, classpath].join(delimiter), 'EditorOracle', output])
const oracle = JSON.parse(await readFile(output, 'utf8'))
assert.equal(oracle.gameVersion, '26.2')
const offsets = { north: [0, 0, -1], east: [1, 0, 0], south: [0, 0, 1], west: [-1, 0, 0] }
const clockwise = { north: 'east', east: 'south', south: 'west', west: 'north' }
for (const bed of oracle.beds) {
  assert.deepEqual(bed.headOffset, offsets[bed.properties.facing])
  assert.equal(bed.clockwise90.properties.facing, clockwise[bed.properties.facing])
}
for (const entry of oracle.families) {
  if (entry.family === 'bed') assert.equal(entry.hasBlockEntity, false)
  if (entry.properties.facing) assert.equal(entry.clockwise90.properties.facing, clockwise[entry.properties.facing])
  if (entry.properties.half) assert.equal(entry.clockwise90.properties.half, entry.properties.half)
}
assert.deepEqual(oracle.pitcherDoubleByAge, [false, false, false, true, true])
console.log(`Verified ${oracle.families.length} paired-family class bindings, bed offsets/yaw, and pitcher age boundary from Java 26.2. No world placement was performed.`)
