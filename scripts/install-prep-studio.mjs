#!/usr/bin/env node
/** Publish the standalone lesson preparation module before the compiled entry. */
import { readFileSync, writeFileSync, copyFileSync, existsSync, chownSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const entry = join(root, 'site/index.html')
const source = join(root, 'scripts/prep-studio.js')
const target = join(root, 'site/assets/prep-studio.js')
if (!existsSync(entry) || !existsSync(source)) throw new Error('缺少前端入口或智能备课模块，请检查项目目录')
const data = readFileSync(source, 'utf8')
const version = createHash('sha256').update(data).digest('base64url').slice(0, 8)
let html = readFileSync(entry, 'utf8')
const entryPattern = /(\s*<script type="module" crossorigin src="\.\/assets\/index-[\w-]+\.js(?:\?v=[\w-]+)?"><\/script>)/
if (!entryPattern.test(html)) throw new Error('找不到编译入口，请检查前端构建结构')
html = html.replace(/\s*<script type="module" src="\.\/assets\/prep-studio\.js(?:\?v=[\w-]+)?"><\/script>/g, '')
html = html.replace(entryPattern, `\n    <script type="module" src="./assets/prep-studio.js?v=${version}"></script>$1`)
copyFileSync(source, target)
writeFileSync(entry, html)
try { chownSync(target, 33, 33); chownSync(entry, 33, 33) } catch { /* Local development need not have www-data. */ }
console.log(`智能备课模块已安装：${version}`)
