#!/usr/bin/env node
/**
 * 给构建产物打「图片懒加载 + 首屏 hero 预加载」补丁。
 *
 * 为什么需要：实测首页 9 张内容图（约 550KB）全部在首屏以下，却都在首屏
 * 加载期间立即下载，和入口 chunk 抢带宽；首屏真正的视觉元素是 CSS 背景
 * hero 图（164KB），它反而要等 Vue 挂载后才被发现。结果是慢网下首屏空等。
 *
 * 做法：
 *   · 给 HomeView / CurriculumView / LabListView / VideosView 里的静态 <img>
 *     VNode 加 `loading:"lazy"`（浏览器对首屏内的懒加载图仍会尽快加载，
 *     只推迟视口外的）。
 *   · 在 index.html 里给 hero 背景图加 <link rel="preload" as="image">，
 *     让它和入口 chunk 并行下载，改善 LCP。
 *
 * 与 patch-prompt-builder.mjs 一样，改的是构建产物；前端重新构建后需重跑本脚本
 * （顺序：先 patch-prompt-builder.mjs，再本脚本）。文件内容变化后用
 * `?v=<全量内容哈希>` 统一更新所有 chunk 引用与 index.html 入口，绕开
 * /assets/ 的 immutable 缓存。
 *
 * 用法：
 *   sudo node scripts/patch-lazy-images.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, chownSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const site = join(root, 'site')
const assets = join(site, 'assets')

const fail = (msg) => {
  console.error(`\n❌ ${msg}\n`)
  process.exit(1)
}
const hash8 = (s) => createHash('sha256').update(s).digest('base64url').slice(0, 8)

// 文件前缀 → 该 chunk 里静态 img VNode 的预期数量（防止构建变化后打歪）
const TARGETS = [
  ['HomeView-', 3],
  ['CurriculumView-', 1],
  ['LabListView-', 1],
  ['VideosView-', 2],
]
const MARK = '("img",{loading:"lazy",'

const htmlPath = join(site, 'index.html')
let html = readFileSync(htmlPath, 'utf8')
const entryName = html.match(/assets\/(index-[\w-]+\.js)(?:\?v=[\w-]+)?/)?.[1]
if (!entryName) fail('index.html 里找不到入口 chunk')

const jsFiles = readdirSync(assets).filter((f) => f.endsWith('.js')).sort()
const resolved = TARGETS.map(([prefix, expected]) => {
  const matches = jsFiles.filter((f) => f.startsWith(prefix))
  if (matches.length !== 1) fail(`${prefix}* 匹配到 ${matches.length} 个 .js（应为 1）`)
  const f = matches[0]
  const p = join(assets, f)
  const src = readFileSync(p, 'utf8')
  const hits = src.split('("img",{').length - 1
  if (hits !== expected) fail(`${f} 里 img 锚点命中 ${hits} 次（应为 ${expected}）。构建可能已变，需同步移植。`)
  return { f, p, src }
})

const heroNames = readdirSync(assets).filter((f) => /^hero-.*\.jpg$/.test(f))
if (heroNames.length !== 1) fail(`英雄图匹配到 ${heroNames.length} 个（应为 1）`)
const preloadTag = `<link rel="preload" as="image" href="./assets/${heroNames[0]}" />`

const patchedCount = resolved.filter((x) => x.src.includes(MARK)).length
const preloadPresent = html.includes(preloadTag)
if (patchedCount === resolved.length && preloadPresent) {
  console.log('已经打过补丁（懒加载与 hero 预加载都在），无需重复执行。')
  process.exit(0)
}
if (patchedCount !== 0 && patchedCount !== resolved.length) {
  fail('懒加载补丁状态不一致：可能上次执行中断。请从备份恢复后重跑。')
}
if ((patchedCount === resolved.length) !== preloadPresent) {
  fail('index.html 与 chunk 的补丁状态不一致：请从备份恢复后重跑。')
}

// ── 备份将要修改的文件 ──────────────────────────────────────
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backupDir = join(root, `site-lazy-backup-${stamp}`)
mkdirSync(backupDir, { recursive: true })
for (const { f, p } of resolved) copyFileSync(p, join(backupDir, f))
copyFileSync(htmlPath, join(backupDir, 'index.html'))

// ── 打补丁（内存中）────────────────────────────────────────
const patched = new Map()
for (const { f, src } of resolved) {
  patched.set(f, src.split('("img",{').join(MARK))
}

// ── 版本串：所有 chunk 内容的哈希，任何 chunk 变化都会更新 ──
let seed = ''
for (const f of jsFiles) {
  const content = patched.get(f) ?? readFileSync(join(assets, f), 'utf8')
  seed += `${f}:${hash8(content)}\n`
}
const ver = hash8(seed)

// ── 写回所有 chunk（补丁 + 统一版本串）─────────────────────
let rewrittenRefs = 0
let written = 0
for (const f of jsFiles) {
  const p = join(assets, f)
  const src = patched.get(f) ?? readFileSync(p, 'utf8')
  const out = src.replace(/"(\.\/[^"]+?\.js)(?:\?v=[^"]*)?"/g, (_, spec) => {
    rewrittenRefs++
    return `"${spec}?v=${ver}"`
  })
  if (out !== src || patched.has(f)) {
    writeFileSync(p, out)
    written++
  }
}

// ── index.html：hero 预加载 + 入口版本串 ───────────────────
let newHtml = html
if (!preloadPresent) {
  const anchor = '<script type="module"'
  const at = newHtml.indexOf(anchor)
  if (at < 0) fail('index.html 里找不到 module script 锚点')
  newHtml = newHtml.slice(0, at) + preloadTag + '\n    ' + newHtml.slice(at)
}
newHtml = newHtml.replace(
  new RegExp(`assets/${entryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\?v=[\\w-]+)?`),
  `assets/${entryName}?v=${ver}`,
)
if (newHtml === html) fail('index.html 入口引用替换失败')
writeFileSync(htmlPath, newHtml)

try {
  for (const f of readdirSync(assets)) {
    if (f.endsWith('.js')) chownSync(join(assets, f), 33, 33)
  }
  chownSync(htmlPath, 33, 33)
} catch {
  console.warn('⚠️  chown www-data 失败（不是 root？），文件权限可能不对')
}

console.log(`✅ 性能补丁完成
   懒加载: ${resolved.map((x) => x.f).join(', ')}
   预加载: ${heroNames[0]}
   版本:   ?v=${ver}
   写入:   ${written} 个 chunk，${rewrittenRefs} 处引用
   备份:   ${backupDir}`)
