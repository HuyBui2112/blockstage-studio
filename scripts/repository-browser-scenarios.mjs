import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { build } from 'vite'

/** Bundle the real repository plus checks in memory; never add test code to dist. */
export async function runRepositoryScenarios({ evaluate }) {
  const result = await build({
    configFile: false, logLevel: 'silent',
    build: { write: false, copyPublicDir: false, minify: false,
      lib: { entry: resolve('scripts/repository-browser-fixture.ts'), name: 'BlockstageRepositoryCheck', formats: ['iife'] },
    },
  })
  const output = (Array.isArray(result) ? result[0] : result).output
  const entry = output.find(item => item.type === 'chunk' && item.isEntry)
  assert.ok(entry, 'Repository test bundle missing')
  const checks = await evaluate(`${entry.code}\nBlockstageRepositoryCheck.runRepositoryChecks()`)
  assert.equal(checks.length, 6)
  return checks
}
