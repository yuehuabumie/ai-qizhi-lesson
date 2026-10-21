import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const environment = { ...process.env }

if (!environment.E2E_BROWSER && process.platform === 'win32') {
  const candidates = [
    join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
    join(process.env.ProgramFiles || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
  ]
  environment.E2E_BROWSER = candidates.find((candidate) => existsSync(candidate))
  if (!environment.E2E_BROWSER) throw new Error('请通过 E2E_BROWSER 指定 Chromium 浏览器路径')
}

const suites = [
  ['--test', 'scripts/prep-modules.test.mjs'],
  ['scripts/navigation-components-e2e.mjs'],
  ['scripts/prep-components-e2e.mjs'],
  ['scripts/prep-navigation-e2e.mjs'],
  ['scripts/teaching-components-e2e.mjs'],
  ['scripts/prep-preview-e2e.mjs'],
]

for (const args of suites) {
  const result = spawnSync(process.execPath, args, { cwd: root, env: environment, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}
