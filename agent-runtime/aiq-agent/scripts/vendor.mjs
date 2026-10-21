import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const upstream = resolve(process.argv[2] || fileURLToPath(new URL('../../../../references/deepseek-harness/', import.meta.url)))
const installed = fileURLToPath(new URL('../../node_modules/', import.meta.url))
const revision = '687f282e8625c6b8d11ff58211a90524be2e4317'
if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: upstream, encoding: 'utf8' }).trim() !== revision) throw new Error('Unexpected upstream revision')
const index = new Map()
for (const directory of ['packages', 'vendor']) {
  const manifests = execFileSync('rg', ['--files', '--hidden', '-g', 'package.json', join(upstream, directory)], { encoding: 'utf8' }).trim().split(/\r?\n/)
  for (const path of manifests.filter(path => !/[\\/](tests|fixtures|node_modules)[\\/]/.test(path))) {
    const manifest = JSON.parse(readFileSync(path, 'utf8'))
    if (manifest.name) index.set(manifest.name, { path: dirname(path), manifest })
  }
}
function rows(relative) {
  const source = readFileSync(join(upstream, relative), 'utf8').replace(/\r\n/g, '\n')
  return [...source.matchAll(/^    - id: ([^\n]+)\n[\s\S]*?(?=^    - id: |$(?![\s\S]))/gm)].map(match => ({ id: match[1].trim(), source: match[0] }))
}
const excluded = new Set(['plugin-manager', 'hmr', 'typert', 'typert-loader', 'typert-gateway', 'remote-access', 'session-title-llm', 'user-questions', 'config-editor', 'settings', 'authorization', 'deepseek-account', 'credentials', 'llm-pi-ai', 'session-query-sqlite', 'otel', 'session-telemetry-otel', 'ptc-runtime', 'workflow-ptc', 'tool-workflow', 'web-deepseek-api', 'llm-deepseek-account', 'plan-mode'])
const selected = rows('packages/bundle/base/cordis.patch.yml').filter(row => !excluded.has(row.id))
selected.push(...rows('packages/bundle/sdk-minimal/cordis.patch.yml').filter(row => ['sdk-app-startup', 'sdk-jsonrpc-server'].includes(row.id)))
selected.push({ id: 'session-query-sqlite', source: "    - id: session-query-sqlite\n      disabled: true\n" }, { id: 'web-deepseek-api', source: "    - id: web-deepseek-api\n      disabled: true\n" })
const profile = '- insert:\n' + selected.map(row => row.source).join('\n')
writeFileSync(join(root, 'profile.yml'), profile)
const seeds = ['@deepseek-ai/dsh-sdk-client', '@deepseek-ai/dsh-app-boot', '@deepseek-ai/dsh-cmdline', '@deepseek-ai/dsh-mcp-client', ...selected.filter(row => !/disabled: true/.test(row.source)).flatMap(row => [...row.source.matchAll(/name: ['"](@deepseek-ai\/[^'"]+)['"]/g)].map(match => match[1].split('/').slice(0, 2).join('/')))]
const chosen = new Set()
const external = new Set()
function visit(name) {
  if (name === '@deepseek-ai/dsh' || chosen.has(name)) return
  const item = index.get(name)
  if (!item) { external.add(name); return }
  if (item.manifest.license !== 'MIT') throw new Error('Review upstream license before vendoring: ' + name)
  chosen.add(name)
  for (const dependency of Object.keys({ ...item.manifest.dependencies, ...item.manifest.optionalDependencies, ...item.manifest.peerDependencies })) {
    if (dependency.startsWith('@deepseek-ai/')) visit(dependency)
  }
}
seeds.forEach(visit)
const provenance = { revision, profileRows: selected.map(row => row.id), external: [...external].sort(), packages: [] }
for (const name of [...chosen].sort()) {
  const item = index.get(name)
  const destination = join(root, 'vendor', name.split('/')[1])
  if (existsSync(destination)) throw new Error('Vendor destination already exists: ' + name)
  const published = JSON.parse(readFileSync(join(installed, name, 'package.json'), 'utf8'))
  mkdirSync(destination, { recursive: true })
  for (const entry of readdirSync(item.path, { withFileTypes: true })) {
    if (['tests', 'node_modules', 'lib', 'package.json'].includes(entry.name) || entry.name.startsWith('tsconfig') || entry.name.startsWith('README')) continue
    cpSync(join(item.path, entry.name), join(destination, entry.name), { recursive: true })
  }
  const manifest = { ...published, private: true }
  delete manifest.publishConfig
  delete manifest.devDependencies
  delete manifest.scripts
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    if (manifest[field]) delete manifest[field]['@deepseek-ai/dsh']
  }
  writeFileSync(join(destination, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  const license = existsSync(join(item.path, 'LICENSE')) ? join(item.path, 'LICENSE') : join(upstream, 'LICENSE')
  cpSync(license, join(destination, 'LICENSE'))
  provenance.packages.push({ name, version: published.version, source: item.path.slice(upstream.length + 1).replaceAll('\\', '/'), sourceManifestHash: createHash('sha256').update(readFileSync(join(item.path, 'package.json'))).digest('hex') })
}
cpSync(join(upstream, 'LICENSE'), join(root, 'UPSTREAM-LICENSE'))
cpSync(join(upstream, 'THIRD_PARTY_NOTICES.md'), join(root, 'UPSTREAM-THIRD-PARTY.md'))
writeFileSync(join(root, 'UPSTREAM.json'), JSON.stringify(provenance, null, 2) + '\n')
console.log(JSON.stringify({ vendoredPackages: chosen.size, profileRows: selected.length, external: [...external].sort() }))
