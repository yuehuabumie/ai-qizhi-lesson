import { existsSync, readFileSync, readdirSync, mkdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
let count = 0
for (const name of readdirSync(join(root, 'vendor'))) {
  const directory = join(root, 'vendor', name)
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  const targets = new Set()
  const sourceHints = new Map()
  function collect(value) {
    if (typeof value === 'string' && /^(?:\.\/)?lib\/.+\.(?:js|mjs|cjs)$/.test(value)) targets.add(value.replace(/^\.\//, ''))
    else if (value && typeof value === 'object') {
      if (typeof value.default === 'string' && typeof value.types === 'string') sourceHints.set(value.default.replace(/^\.\//, ''), value.types.replace(/^\.\/lib\/types\//, '').replace(/\.d\.ts$/, ''))
      for (const [key, child] of Object.entries(value)) if (key !== 'types') collect(child)
    }
  }
  collect(manifest.main)
  collect(manifest.exports)
  for (const target of targets) {
    if (/^lib\/typert\./.test(target)) continue
    const stem = target.replace(/^lib\//, '').replace(/\.(?:js|mjs|cjs)$/, '')
    const source = [stem, stem.replace(/^types\//, ''), sourceHints.get(target)].filter(Boolean).flatMap(candidate => ['.ts', '.tsx', '.js'].map(extension => join(directory, 'src', candidate + extension))).find(path => existsSync(path))
    if (!source) throw new Error('Missing source entry: ' + manifest.name + ' ' + target)
    await build({ entryPoints: [source], outfile: join(directory, target), bundle: true, packages: 'external', platform: 'node', format: target.endsWith('.cjs') ? 'cjs' : 'esm', target: 'node24', charset: 'utf8', legalComments: 'inline', logLevel: 'warning' })
    count++
  }
}
console.log('AIQ_SOURCE_ENTRIES_BUILT', count)
