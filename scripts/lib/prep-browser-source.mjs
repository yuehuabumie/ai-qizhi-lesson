/** One self-contained browser module for production and browser regressions. */
import { readFileSync } from 'node:fs'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'

export function prepBrowserSource({ harness = '' } = {}) {
  const entries = {
    '': "import './scripts/prep-studio.js'",
    studio: "import { createPrepStudio } from './scripts/prep/studio.js'; globalThis.__prepTest = createPrepStudio()",
    preview: "import { createPrepStudio } from './scripts/prep/studio.js'; const studio = createPrepStudio(); globalThis.__previewTest = { mount() { studio.mount('preview-session') } }",
    navigation: "import { createTeachingHub } from './scripts/prep/teaching-hub.js'; import { ensureStyle } from './scripts/prep/styles.js'; const hub = createTeachingHub(); globalThis.__teachHubTest = { ensureStyle, syncTeachingHub: hub.sync, installTeachingHub: hub.install, dispose: hub.dispose }",
  }
  if (!Object.hasOwn(entries, harness)) throw new Error(`未知备课测试入口：${harness}`)
  const vendor = new URL('../vendor/markdown-it-15.0.3/', import.meta.url)
  const license = readFileSync(new URL('LICENSE', vendor), 'utf8')
  const parser = readFileSync(new URL('markdown-it.umd.min.js', vendor), 'utf8')
    .replace(/^\/\/# sourceMappingURL=.*$/gm, '')
  const renderer = readFileSync(new URL('./prep-markdown.js', import.meta.url), 'utf8')
  const studio = buildSync({
    stdin: { contents: entries[harness], resolveDir: fileURLToPath(new URL('../../', import.meta.url)) },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    charset: 'utf8',
    loader: { '.css': 'text' },
    legalComments: 'inline',
  }).outputFiles[0].text
  return `/* markdown-it 15.0.3 — MIT\n${license}\n*/\n${parser}\n;\n${renderer}\n;\n${studio}`
}
