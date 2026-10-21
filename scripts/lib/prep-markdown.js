/**
 * Safe synchronous chat Markdown renderer.
 * Load scripts/vendor/markdown-it-15.0.3/markdown-it.umd.min.js first.
 * Vendored parser provenance and MIT license are retained beside that asset.
 *
 * API: window.__AIQ_PREP_MARKDOWN__(text, { attachments }) -> escaped/rendered HTML.
 * Raw HTML is always text. Images never initiate a browser network request.
 * Sandbox file links resolve only to an artifact already returned by the API.
 */
;(() => {
  'use strict'
  const scope = globalThis
  if (typeof scope.__AIQ_PREP_MARKDOWN__ === 'function') return
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
  const unsafeUrlCharacters = /[\u0000-\u0020\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u
  const localArtifactPrefix = /^(?:sandbox:)?\/(?:mnt\/data|work\/output)\//i

  function artifactIndex(attachments) {
    const files = Array.isArray(attachments) ? attachments : []
    const names = new Map()
    const paths = new Set()
    for (const file of files) {
      if (file?.kind !== 'artifact' || typeof file.id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(file.id) || typeof file.name !== 'string') continue
      const href = `/api/prep/attachments/${encodeURIComponent(file.id)}`
      const name = file.name.normalize('NFC')
      const matching = names.get(name) || new Set()
      matching.add(href)
      names.set(name, matching)
      paths.add(href)
    }
    return { names, paths }
  }

  function artifactHref(value, artifacts) {
    if (artifacts.paths.has(value)) return value
    if (!localArtifactPrefix.test(value)) return ''
    try {
      const path = new URL(value.replace(/^sandbox:/i, ''), 'https://prep-artifacts.invalid').pathname
      // URL canonicalization removes dot segments before the allowed-root check.
      if (!/^\/(?:mnt\/data|work\/output)\//.test(path)) return ''
      const name = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1)).normalize('NFC')
      if (!name || /[/\\\u0000-\u001f\u007f]/.test(name)) return ''
      const matching = artifacts.names.get(name)
      // An ambiguous duplicate filename must not silently download another file.
      return matching?.size === 1 ? matching.values().next().value : ''
    } catch { return '' }
  }

  function safeHref(value, artifacts) {
    const raw = String(value ?? '').trim()
    if (!raw || unsafeUrlCharacters.test(raw) || raw.includes('\\')) return ''
    const artifact = artifactHref(raw, artifacts)
    if (artifact) return artifact
    // Restrict navigation to explicit public web URLs. No relative navigation,
    // javascript/data/blob/file protocols or protocol-relative URLs are accepted.
    if (!/^https?:\/\//i.test(raw)) return ''
    try {
      const url = new URL(raw)
      return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname && !url.username && !url.password ? url.href : ''
    } catch { return '' }
  }

  const Factory = scope.markdownit
  if (typeof Factory !== 'function') {
    scope.__AIQ_PREP_MARKDOWN__ = (text) => `<p>${escape(text).replace(/\r\n?|\n/g, '<br>')}</p>`
    return
  }
  const markdown = new Factory({ html: false, breaks: true, linkify: true, typographer: false, maxNesting: 40 })
  // This permits the parser to recognize artifact syntax; the renderer below
  // independently checks the current API-owned artifact list before emitting href.
  markdown.validateLink = (value) => {
    const raw = String(value ?? '').trim()
    return !unsafeUrlCharacters.test(raw) && !raw.includes('\\') && (/^https?:\/\//i.test(raw) || localArtifactPrefix.test(raw) || /^\/api\/prep\/attachments\//.test(raw))
  }
  markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
    const token = tokens[index]
    const href = safeHref(token.attrGet('href'), env.prepArtifacts)
    // Pair the closing token so rejected links remain readable inert text.
    for (let next = index + 1; next < tokens.length; next++) {
      if (tokens[next].type === 'link_close' && tokens[next].level === token.level) {
        tokens[next].tag = href ? 'a' : 'span'
        break
      }
    }
    if (!href) return '<span class="prep-link-unavailable">'
    token.attrSet('href', href)
    if (/^https?:/i.test(href)) {
      token.attrSet('target', '_blank')
      token.attrSet('rel', 'noopener noreferrer')
      token.attrSet('referrerpolicy', 'no-referrer')
    } else {
      token.attrSet('download', '')
      token.attrSet('class', 'prep-artifact-link')
    }
    return renderer.renderToken(tokens, index, options)
  }
  markdown.renderer.rules.image = (tokens, index, options, env) => {
    const token = tokens[index]
    const label = escape(token.content || '查看图片')
    const href = safeHref(token.attrGet('src'), env.prepArtifacts)
    // A Markdown image may be nested in a link; do not produce invalid nested
    // anchors when replacing that image with its accessible text/link fallback.
    if (!href || token.level > 0) return `<span class="prep-markdown-image">${label}</span>`
    const attributes = /^https?:/i.test(href)
      ? ' target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer"'
      : ' download'
    return `<a class="prep-markdown-image" href="${escape(href)}"${attributes}>${label}</a>`
  }
  // Tables scroll within a message on phones instead of widening the page.
  markdown.renderer.rules.table_open = () => '<div class="prep-markdown-table" role="region" aria-label="表格，可左右滚动" tabindex="0"><table>\n'
  markdown.renderer.rules.table_close = () => '</table></div>\n'

  const render = (text, options = {}) => markdown.render(String(text ?? ''), { prepArtifacts: artifactIndex(options?.attachments) })
  Object.defineProperty(render, 'library', { value: 'markdown-it@15.0.3' })
  scope.__AIQ_PREP_MARKDOWN__ = render
})()
