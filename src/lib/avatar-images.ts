/**
 * 用户头像落盘。
 *
 * 与作品插画同一套原则：只收 png/jpeg/webp，按魔数校验，拒绝把
 * HTML/SVG 改名成 .png 存进静态目录。头像不走远程 URL，只接受前端
 * FileReader 生成的 data URL，因此没有 SSRF 面。
 *
 * 上限 2MB，不压缩、不转 WebP——平台其他图片同样保持原样。
 * 文件名为 `<userId>-<时间戳>-<随机串>.<ext>`，每次上传换新 URL，
 * 浏览器缓存不会继续显示旧头像。
 */
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { sniffImage } from './work-images.js'

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024
/** base64 膨胀 4/3，再加 data URL 前缀与 JSON 外壳 */
export const AVATAR_BODY_LIMIT = 4 * 1024 * 1024

const UPLOAD_DIR = join(process.cwd(), 'site', 'uploads', 'avatars')
const PUBLIC_PREFIX = '/uploads/avatars/'
const URL_RE = /^\/uploads\/avatars\/[A-Za-z0-9_-]{1,80}\.(png|jpg|webp)$/
const FILE_RE = /^[A-Za-z0-9_-]{1,80}\.(png|jpg|webp)$/

export function isStoredAvatarUrl(value: unknown): value is string {
  return typeof value === 'string' && URL_RE.test(value)
}

/** 只接受 data URL，且解码后必须通过魔数校验（伪装成图片的文本在这里就拒绝）。 */
export function decodeAvatarDataUrl(src: string): Buffer | null {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(src)
  if (!m) return null
  try {
    const buf = Buffer.from(m[2], 'base64')
    if (!buf.length || buf.length > MAX_AVATAR_BYTES || !sniffImage(buf)) return null
    return buf
  } catch {
    return null
  }
}

export async function persistAvatar(userId: string, buf: Buffer): Promise<string> {
  const ext = sniffImage(buf)
  if (!ext) throw new Error('头像不是有效的 PNG/JPEG/WebP')
  if (!/^[A-Za-z0-9_-]{1,30}$/.test(userId)) throw new Error('用户编号异常')
  await mkdir(UPLOAD_DIR, { recursive: true })
  const name = `${userId}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}.${ext}`
  await writeFile(join(UPLOAD_DIR, name), buf)
  return PUBLIC_PREFIX + name
}

export async function removeAvatar(url: string | null | undefined): Promise<void> {
  if (!isStoredAvatarUrl(url)) return
  const name = url.slice(PUBLIC_PREFIX.length)
  if (!FILE_RE.test(name)) return
  try {
    await unlink(join(UPLOAD_DIR, name))
  } catch {
    /* 已经被替换或手动清理过，删除是幂等的 */
  }
}
