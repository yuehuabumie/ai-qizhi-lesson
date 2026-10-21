/** One self-contained browser module for production and browser regressions. */
import { readFileSync } from 'node:fs'

export function prepBrowserSource() {
  const vendor = new URL('../vendor/markdown-it-15.0.3/', import.meta.url)
  const license = readFileSync(new URL('LICENSE', vendor), 'utf8')
  const parser = readFileSync(new URL('markdown-it.umd.min.js', vendor), 'utf8')
    .replace(/^\/\/# sourceMappingURL=.*$/gm, '')
  const renderer = readFileSync(new URL('./prep-markdown.js', import.meta.url), 'utf8')
  const studio = readFileSync(new URL('../prep-studio.js', import.meta.url), 'utf8')
  return `/* markdown-it 15.0.3 — MIT\n${license}\n*/\n${parser}\n;\n${renderer}\n;\n${studio}`
}
