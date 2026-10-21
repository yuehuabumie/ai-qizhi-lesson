import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { AiqAgent } from '../index.mjs'

test('source-built AIQ runtime initializes and restores a persisted session without a model request', { timeout: 90000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aiq-agent-test-'))
  const options = { dshHome: join(directory, 'state'), processCwd: directory, cwd: directory, model: 'deepseek-flash', initializeTimeoutMs: 60000 }
  let agent = new AiqAgent(options)
  try {
    await agent.session('aiq-offline-smoke').setWorkingDirectory(directory)
    await agent.close()
    agent = new AiqAgent(options)
    const restored = await agent.resumeSession('aiq-offline-smoke')
    assert.ok(restored)
  } finally {
    await agent.close()
    await rm(directory, { recursive: true, force: true })
  }
})
