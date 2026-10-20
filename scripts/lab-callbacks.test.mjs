import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const catalog = readFileSync(new URL('../src/lib/assign-catalog.ts', import.meta.url), 'utf8')
const ids = [...catalog.matchAll(/\{ id: '([^']+)'/g)].map((m) => m[1])
const assets = new URL('../site/assets/', import.meta.url)
const chunks = readdirSync(assets).filter((n) => /^LabPlayView-.*\.js$/.test(n))
const code = chunks.map((n) => readFileSync(new URL(n, assets), 'utf8')).join('\n')
const callbacks = [...code.matchAll(/\.markLab\(["']([^"']+)["']/g)].map((m) => m[1])

test('all 12 assignment labs have their matching completion callback in the shipped build', () => {
  assert.equal(ids.length, 12)
  for (const id of ids) assert.ok(callbacks.includes(id), `Missing markLab callback: ${id}`)
  for (const id of callbacks) assert.ok(id === 'storybook' || ids.includes(id), `Unrecognized markLab id: ${id}`)
})
