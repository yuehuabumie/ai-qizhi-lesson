import assert from 'node:assert/strict'
import { Script } from 'node:vm'
import { test } from 'node:test'
import { prepBrowserSource } from './lib/prep-browser-source.mjs'
import { api } from './prep/api.js'
import { statusMessage } from './prep/presentation.js'

test('agent loading status hides legacy runtime branding without rewriting other messages', () => {
  for (const message of ['正在运行 DeepSeek Harness', '正在启动deepseekharness', ' 正在运行 DeepSeek Harness ']) {
    assert.equal(statusMessage(message), '正在加载智能体')
  }
  for (const message of ['正在加载智能体', '正在准备隔离环境', 'DeepSeek Harness 出错', undefined, '']) {
    assert.equal(statusMessage(message), message)
  }
})

test('production bundle is a standalone script without test entry points', () => {
  const source = prepBrowserSource()
  assert.doesNotThrow(() => new Script(source))
  assert.doesNotMatch(source, /__prepTest|__teachHubTest|__previewTest/)
  assert.match(source, /__AIQ_PREP_STUDIO__/)
  assert.match(source, /markdown-it 15\.0\.3 — MIT/)
  assert.equal(source, prepBrowserSource())
})

test('explicit browser harnesses build without production bootstrap', () => {
  for (const [harness, entry] of [['studio', '__prepTest'], ['navigation', '__teachHubTest'], ['preview', '__previewTest']]) {
    const source = prepBrowserSource({ harness })
    assert.doesNotThrow(() => new Script(source))
    assert.ok(source.includes(entry))
    assert.doesNotMatch(source, /__AIQ_PREP_STUDIO__/)
  }
  assert.throws(() => prepBrowserSource({ harness: 'unknown' }), /未知备课测试入口/)
})

test('API preserves raw uploads and authenticated request semantics', async (context) => {
  const body = new Blob(['教材'])
  let request
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    request = { url, options }
    return new Response(JSON.stringify({ ok: true }))
  })
  await api('/sessions/example/attachments', { method: 'POST', body })
  assert.equal(request.url, '/api/prep/sessions/example/attachments')
  assert.equal(request.options.body, body)
  assert.equal(request.options.credentials, 'same-origin')
  await api('/sessions', { method: 'POST', body: { title: '教案' } })
  assert.equal(request.options.headers.get('content-type'), 'application/json')
  assert.deepEqual(JSON.parse(request.options.body), { title: '教案' })
})

test('API retains server error status and supplies a readable non-JSON fallback', async (context) => {
  const fetch = context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: { message: '请重新核对' } }), { status: 409 }))
  await assert.rejects(api('/sessions'), (error) => error.status === 409 && error.message === '请重新核对')
  fetch.mock.mockImplementation(async () => new Response('<html>Unavailable</html>', { status: 503 }))
  await assert.rejects(api('/sessions'), (error) => error.status === 503 && error.message.includes('503'))
})
