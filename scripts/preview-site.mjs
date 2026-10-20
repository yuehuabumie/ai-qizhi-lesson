/** Local-only preview of runtime modules, with /api proxied to the local backend.
 * PREVIEW_SITE can point at an existing site/ without copying uploaded files.
 * Optional PREVIEW_TLS_KEY / PREVIEW_TLS_CERT enable HTTPS for secure cookies.
 */
import http from 'node:http'
import https from 'node:https'
import { readFile, stat } from 'node:fs/promises'
import { createReadStream, readFileSync } from 'node:fs'
import { dirname, resolve, sep, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const site = resolve(process.env.PREVIEW_SITE || resolve(root, 'site'))
const api = new URL(process.env.SMOKE_BASE || 'http://127.0.0.1:3020')
if (!['127.0.0.1', 'localhost', '[::1]'].includes(api.hostname)) throw new Error('Preview API must be local')
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2' }

async function handle(req, res) {
  if (req.url.startsWith('/api/')) {
    const upstream = http.request(new URL(req.url, api), { method: req.method, headers: { ...req.headers, host: api.host } }, (reply) => {
      res.writeHead(reply.statusCode, reply.headers)
      reply.pipe(res)
    })
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Preview API unavailable') })
    req.pipe(upstream)
    return
  }
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    const module = pathname.match(/^\/assets\/((?:class|storybook|gallery|me)-studio|responsive-shell)\.js$/)
    const path = module ? resolve(root, 'scripts', `${module[1]}.js`) : resolve(site, '.' + (pathname === '/' ? '/index.html' : pathname))
    if (!module && !path.startsWith(site + sep)) { res.writeHead(403); res.end(); return }
    if (!(await stat(path)).isFile()) throw new Error('Not a file')
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store' })
    if (pathname === '/') {
      const html = await readFile(path, 'utf8')
      res.end(html.includes('/assets/responsive-shell.js') ? html : html.replace('</head>', '<script type="module" src="/assets/responsive-shell.js"></script></head>'))
      return
    }
    createReadStream(path).pipe(res)
  } catch {
    res.writeHead(404)
    res.end('Not found')
  }
}

const tls = process.env.PREVIEW_TLS_KEY && process.env.PREVIEW_TLS_CERT
const server = tls ? https.createServer({ key: readFileSync(process.env.PREVIEW_TLS_KEY), cert: readFileSync(process.env.PREVIEW_TLS_CERT) }, handle) : http.createServer(handle)
const port = Number(process.env.PREVIEW_PORT || 3320)
server.listen(port, '127.0.0.1', () => console.log(`Preview: ${tls ? 'https' : 'http'}://127.0.0.1:${port}`))
