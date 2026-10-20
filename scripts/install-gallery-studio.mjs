#!/usr/bin/env node
/**
 * 把 gallery-studio.js 安装到构建产物，并在 index.html 里挂上独立模块脚本。
 *
 * 与 install-storybook-studio.mjs 同一套机制：前端源码不在服务器上，
 * 重新构建会把入口 chunk 换名；独立文件只需重新执行本脚本更新 index.html。
 *
 * 重新构建前端后需重跑：
 *   sudo node scripts/patch-prompt-builder.mjs
 *   sudo node scripts/patch-storybook.mjs
 *   sudo node scripts/patch-lazy-images.mjs
 *   sudo node scripts/install-storybook-studio.mjs
 *   sudo node scripts/install-gallery-studio.mjs
 */
import { readFileSync, writeFileSync, copyFileSync, chownSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const site = join(root, 'site')
const assets = join(site, 'assets')
const indexPath = join(site, 'index.html')
const srcPath = join(root, 'scripts', 'gallery-studio.js')
const destPath = join(assets, 'gallery-studio.js')

const fail = (msg) => {
  console.error(`\n❌ ${msg}\n`)
  process.exit(1)
}

if (!existsSync(indexPath)) fail('site/index.html 不存在（前端还没构建？）')
if (!existsSync(srcPath)) fail('scripts/gallery-studio.js 不存在')

const source = readFileSync(srcPath, 'utf8')
const hash = createHash('sha256').update(source).digest('base64url').slice(0, 8)
copyFileSync(srcPath, destPath)

let html = readFileSync(indexPath, 'utf8')
const tagRe = /\s*<script type="module" src="\.\/assets\/gallery-studio\.js(?:\?v=[\w-]+)?"><\/script>/
const tag = `<script type="module" src="./assets/gallery-studio.js?v=${hash}"></script>`

if (tagRe.test(html)) {
  html = html.replace(tagRe, `\n    ${tag}`)
} else {
  const entryRe = /(<script type="module" crossorigin src="\.\/assets\/index-[\w-]+\.js(?:\?v=[\w-]+)?"><\/script>)/
  if (!entryRe.test(html)) fail('index.html 里找不到入口 script，前端构建结构可能变了')
  html = html.replace(entryRe, `$1\n    ${tag}`)
}

writeFileSync(indexPath, html)

try {
  chownSync(destPath, 33, 33) // www-data
  chownSync(indexPath, 33, 33)
} catch {
  console.warn('⚠️  chown www-data 失败（不是 root？），文件权限可能不对')
}

console.log(`✅ 成果展厅已安装
   模块: assets/gallery-studio.js
   版本: ?v=${hash}
   入口: index.html 已挂载独立模块脚本`)
