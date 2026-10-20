/**
 * 作品插画的落盘与清理。
 *
 * 为什么不能直接存上游 URL：百炼返回的图片是带签名的临时链接，过期后
 * 展厅就会变成一片裂图。提交作品时把图片下载到本站 /uploads/works/，
 * 数据库只存站内路径。
 *
 * 用户能提交任意 https 地址，所以下载前必须做 SSRF 防护：只允许 https、
 * 标准端口，DNS 解析结果里只要有一个内网地址就拒绝，且不跟随重定向。
 * 上游返回的内容还要通过魔数校验，避免把 HTML/SVG 落成 .png。
 */
import { lookup } from 'node:dns/promises'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { request } from 'node:https'
import { isIP } from 'node:net'
import { join } from 'node:path'

export const MAX_WORK_IMAGES = 20

const MAX_BYTES = 5 * 1024 * 1024
const FETCH_TIMEOUT_MS = 20_000
const DOWNLOAD_CONCURRENCY = 4
const UPLOAD_DIR = join(process.cwd(), 'site', 'uploads', 'works')
const PUBLIC_PREFIX = '/uploads/works/'
const STORED_RE = /^\/uploads\/works\/[A-Za-z0-9_-]{1,80}\.(png|jpg|webp)$/
const FILE_RE = /^[A-Za-z0-9_-]{1,80}\.(png|jpg|webp)$/

export function parseStoredImages(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value.filter((p): p is string => typeof p === 'string' && STORED_RE.test(p))
  } catch {
    return []
  }
}

export function isStoredWorkImage(value: unknown): value is string {
  return typeof value === 'string' && STORED_RE.test(value)
}

function isPublicIp(ip: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (a === 0 || a === 10 || a === 127) return false
    if (a === 169 && b === 254) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    if (a === 100 && b >= 64 && b <= 127) return false
    if (a >= 224) return false
    return true
  }

  const lower = ip.toLowerCase()
  if (lower === '::' || lower === '::1') return false
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return false // fc00::/7
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return false // fe80::/10
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(lower)
  if (mapped) return isPublicIp(mapped[1])
  return true
}

/**
 * 连接**固定在校验过的 IP**上，而不是再让 fetch 解析一次域名。
 * 否则 DNS rebinding 可以：第一次解析返回公网地址通过校验，第二次连接时
 * 换成 127.0.0.1 / 内网地址。SNI 与 Host 仍用原域名，证书照常校验。
 * https.request 不跟随重定向，3xx 一律拒绝。
 */
function requestPinned(url: URL, address: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    let settled = false
    let deadline: NodeJS.Timeout | undefined
    const done = (value: Buffer | null) => {
      if (settled) return
      settled = true
      if (deadline) clearTimeout(deadline)
      resolve(value)
    }
    const host = url.hostname.replace(/^\[|\]$/g, '')
    const req = request(
      {
        protocol: 'https:',
        hostname: address,
        family: isIP(address),
        port: 443,
        path: url.pathname + url.search,
        method: 'GET',
        servername: isIP(host) ? undefined : host,
        headers: {
          host: url.host,
          accept: 'image/png, image/jpeg, image/webp',
          'user-agent': 'aiq-api',
        },
        rejectUnauthorized: true,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume()
          return done(null)
        }
        const declared = Number(res.headers['content-length'] || 0)
        if (declared > MAX_BYTES) {
          res.destroy()
          return done(null)
        }
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > MAX_BYTES) {
            res.destroy()
            done(null)
            return
          }
          chunks.push(chunk)
        })
        res.on('end', () => done(size > 0 ? Buffer.concat(chunks) : null))
        res.on('error', () => done(null))
      },
    )
    req.on('timeout', () => {
      req.destroy()
      done(null)
    })
    req.on('error', () => done(null))
    req.setTimeout(FETCH_TIMEOUT_MS)
    // setTimeout 是空闲超时；慢速滴流也要有总时限
    deadline = setTimeout(() => {
      req.destroy()
      done(null)
    }, FETCH_TIMEOUT_MS)
    req.end()
  })
}

async function fetchRemote(src: string): Promise<Buffer | null> {
  let url: URL
  try {
    url = new URL(src)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null
  if (url.port && url.port !== '443') return null

  let addrs: { address: string }[]
  try {
    const host = url.hostname.replace(/^\[|\]$/g, '')
    addrs = await lookup(host, { all: true, verbatim: true })
    if (!addrs.length || addrs.some((a) => !isPublicIp(a.address))) return null
  } catch {
    return null
  }

  // 多 A/AAAA 记录时逐个尝试；每个都用已校验的地址直连
  for (const addr of addrs.slice(0, 4)) {
    const buf = await requestPinned(url, addr.address)
    if (buf) return buf
  }
  return null
}

function decodeDataUrl(src: string): Buffer | null {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(src)
  if (!m) return null
  const buf = Buffer.from(m[2], 'base64')
  return buf.length > 0 && buf.length <= MAX_BYTES ? buf : null
}

export function sniffImage(buf: Buffer): 'png' | 'jpg' | 'webp' | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp'
  }
  return null
}

async function loadOne(src: string): Promise<Buffer | null> {
  const buf = src.startsWith('data:') ? decodeDataUrl(src) : await fetchRemote(src)
  if (!buf || !sniffImage(buf)) return null
  return buf
}

/**
 * 下载/解码 sources 并写成 workId-<序号>.<ext>。
 * 返回成功保存的站内路径，顺序与 sources 一致；失败项直接跳过。
 * 单张失败不影响其他张——绘本有一页保存失败，其他页仍应展出。
 */
export async function persistWorkImages(workId: string, sources: string[]): Promise<string[]> {
  const list = sources.slice(0, MAX_WORK_IMAGES)
  if (!list.length) return []
  await mkdir(UPLOAD_DIR, { recursive: true })

  const saved: (string | null)[] = list.map(() => null)
  let next = 0
  async function worker() {
    while (true) {
      const index = next++
      if (index >= list.length) return
      try {
        const buf = await loadOne(list[index])
        if (!buf) continue
        const ext = sniffImage(buf)
        if (!ext) continue
        const name = `${workId}-${index}.${ext}`
        await writeFile(join(UPLOAD_DIR, name), buf)
        saved[index] = PUBLIC_PREFIX + name
      } catch {
        /* 单张失败留给调用方按数量告警 */
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, list.length) }, () => worker()),
  )
  return saved.filter((p): p is string => p !== null)
}

/**
 * 把已经落盘的作业插画复制成作品插画。
 *
 * 作业提交和展厅发布是两次独立的写盘：直接共享文件名的话，老师撤下/重置作业
 * 会把仍在展厅里的作品图一起删掉。复制后各归各的。
 */
export async function copyWorkImages(workId: string, storedPaths: string[]): Promise<string[]> {
  if (!/^[A-Za-z0-9_-]{1,60}$/.test(workId)) return []
  const list = storedPaths.filter(isStoredWorkImage).slice(0, MAX_WORK_IMAGES)
  if (!list.length) return []
  await mkdir(UPLOAD_DIR, { recursive: true })

  const saved: string[] = []
  for (let index = 0; index < list.length; index++) {
    const name = list[index]!.slice(PUBLIC_PREFIX.length)
    try {
      const buf = await readFile(join(UPLOAD_DIR, name))
      const ext = sniffImage(buf)
      if (!ext) continue
      const target = `${workId}-${index}.${ext}`
      await writeFile(join(UPLOAD_DIR, target), buf)
      saved.push(PUBLIC_PREFIX + target)
    } catch {
      /* 单张缺失不阻断其他页；调用方按数量决定是否继续发布 */
    }
  }
  return saved
}

export function serializeImages(paths: string[]): string | null {
  const safe = paths.filter((p) => STORED_RE.test(p)).slice(0, MAX_WORK_IMAGES)
  return safe.length ? JSON.stringify(safe) : null
}

export async function removeWorkImages(paths: string[]): Promise<void> {
  await Promise.all(
    paths.map(async (p) => {
      const name = p.startsWith(PUBLIC_PREFIX) ? p.slice(PUBLIC_PREFIX.length) : ''
      if (!FILE_RE.test(name)) return
      try {
        await unlink(join(UPLOAD_DIR, name))
      } catch {
        /* 已经不在磁盘上（重复删除/清理过）就当成功 */
      }
    }),
  )
}
