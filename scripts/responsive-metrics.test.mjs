import test from 'node:test'
import assert from 'node:assert/strict'
import { layoutFailures } from './lib/responsive-metrics.mjs'

const page = { width: 390, height: 844, innerWidth: 390, docWidth: 390, scale: 1, offenders: [], modal: null, supervisor: null }

test('detects overflow hidden by mobile automatic shrinking', () => {
  const errors = layoutFailures({ ...page, innerWidth: 413, docWidth: 413, scale: 390 / 413 })
  assert.ok(errors.some((s) => s.includes('横向溢出')))
  assert.ok(errors.some((s) => s.includes('自动缩小')))
})

test('accepts a fitting page and rejects a modal below the viewport', () => {
  assert.deepEqual(layoutFailures(page), [])
  assert.ok(layoutFailures({ ...page, modal: { y: 20, bottom: 860 } }).includes('弹窗超出视口'))
})

test('checks actual supervisor height against reserved content space', () => {
  const bar = { x: 12, right: 378, bottom: 834, height: 120, paddingBottom: 96, buttons: [{ width: 90, height: 44 }] }
  assert.ok(layoutFailures({ ...page, supervisor: bar }).includes('学生操作条底部留白不足'))
  assert.deepEqual(layoutFailures({ ...page, supervisor: { ...bar, paddingBottom: 136 } }), [])
})
