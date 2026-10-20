import { readFileSync, writeFileSync, copyFileSync, chownSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'scripts', 'responsive-shell.js')
const target = join(root, 'site', 'assets', 'responsive-shell.js')
const index = join(root, 'site', 'index.html')
const hash = createHash('sha256').update(readFileSync(source)).digest('base64url').slice(0, 8)
let html = readFileSync(index, 'utf8').replace(/\s*<script type="module" src="\.\/assets\/responsive-shell\.js(?:\?v=[\w-]+)?"><\/script>/g, '')
if (!html.includes('</head>')) throw new Error('site/index.html 缺少 head，未安装')
copyFileSync(source, target)
html = html.replace('</head>', `  <script type="module" src="./assets/responsive-shell.js?v=${hash}"></script>\n  </head>`)
writeFileSync(index, html)
if (process.platform !== 'win32') {
  for (const file of [target, index]) {
    try { chownSync(file, 33, 33) } catch { console.warn('请确认 www-data 可以读取安装文件') }
  }
}
console.log(`全站移动适配模块已安装：${hash}`)
