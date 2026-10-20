import type { FastifyRequest } from 'fastify'
import { redis, rk } from './redis.js'
import { ApiError } from './errors.js'

/**
 * 限流：Redis `INCR` + `PEXPIRE`，Redis 不可用时降级到进程内 Map。
 *
 * 降级不是「更好」而是「别整个挂掉」——单实例部署下进程内计数其实是准的，
 * 只是 worker 重启会清零。真正的风险是重启后被人抓住窗口刷验证码，
 * 所以降级期间把窗口**拉长**（DEGRADE_FACTOR > 1，冷却比正常时更久），
 * 而不是缩短——窗口变短等于放松限制，和意图正好相反。
 */

const DEGRADE_FACTOR = 1.2

const LUA = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {n, redis.call('PTTL', KEYS[1])}
`

interface Bump {
  count: number
  ttlMs: number
}

const mem = new Map<string, { n: number; exp: number }>()

// 降级期间 Map 会一直涨，定期清掉过期的
const sweeper = setInterval(() => {
  const now = Date.now()
  for (const [k, v] of mem) if (v.exp <= now) mem.delete(k)
}, 60_000)
sweeper.unref()

function bumpMemory(key: string, windowMs: number): Bump {
  const now = Date.now()
  const cur = mem.get(key)
  if (!cur || cur.exp <= now) {
    mem.set(key, { n: 1, exp: now + windowMs })
    return { count: 1, ttlMs: windowMs }
  }
  cur.n += 1
  return { count: cur.n, ttlMs: cur.exp - now }
}

async function bump(key: string, windowMs: number): Promise<Bump> {
  if (redis.status === 'ready') {
    try {
      const r = (await redis.eval(LUA, 1, rk(key), String(Math.round(windowMs)))) as [
        number,
        number,
      ]
      const ttl = Number(r[1])
      // PTTL 返回 -1 表示键没有过期时间（理论上不会发生），兜底成整窗
      return { count: Number(r[0]), ttlMs: ttl > 0 ? ttl : windowMs }
    } catch {
      /* 掉线/超时，落到内存计数 */
    }
  }
  return bumpMemory(key, windowMs * DEGRADE_FACTOR)
}

/** 只读，不计数。用于「连续失败 N 次就锁」这种需要先看后判的场景。 */
export async function peek(key: string): Promise<number> {
  if (redis.status === 'ready') {
    try {
      return Number(await redis.get(rk(key))) || 0
    } catch {
      /* 落到内存 */
    }
  }
  const cur = mem.get(key)
  return cur && cur.exp > Date.now() ? cur.n : 0
}

/** 只读剩余窗口（秒），键不存在返回 0。给「锁定」类 429 拼 retryAfter 用。 */
export async function peekTtlSec(key: string): Promise<number> {
  if (redis.status === 'ready') {
    try {
      const ms = await redis.pttl(rk(key))
      return ms > 0 ? Math.ceil(ms / 1000) : 0
    } catch {
      /* 落到内存 */
    }
  }
  const cur = mem.get(key)
  return cur && cur.exp > Date.now() ? Math.ceil((cur.exp - Date.now()) / 1000) : 0
}

/** 计一次数。失败次数统计用这个（成功时要 clear 掉）。 */
export async function record(key: string, windowMs: number): Promise<void> {
  await bump(key, windowMs)
}

export async function clear(key: string): Promise<void> {
  if (redis.status === 'ready') {
    try {
      await redis.del(rk(key))
    } catch {
      /* ignore */
    }
  }
  mem.delete(key)
}

export interface LimitRule {
  key: string
  limit: number
  windowMs: number
}

/**
 * 逐条判定，**顺序有意义**：越容易误伤的规则排越前。
 * 因为计数是在判定过程中就 +1 的（先检查再自增会有竞态），
 * 前面规则一旦拒绝，后面的就不会被消耗——所以把「单邮箱 60 秒冷却」
 * 放在「IP 每天 20 次」前面，用户狂点重发不会把当天额度烧光。
 */
export async function enforce(rules: LimitRule[], message: string): Promise<void> {
  for (const rule of rules) {
    const { count, ttlMs } = await bump(rule.key, rule.windowMs)
    if (count > rule.limit) {
      const sec = Math.max(1, Math.ceil(ttlMs / 1000))
      throw new ApiError('RATE_LIMITED', `${message}（请 ${humanWait(sec)}后再试）`, {
        retryAfter: sec,
      })
    }
  }
}

function humanWait(sec: number): string {
  if (sec < 60) return `${sec} 秒`
  const min = Math.ceil(sec / 60)
  if (min < 60) return `${min} 分钟`
  return `${Math.ceil(min / 60)} 小时`
}

/**
 * 取客户端真实 IP。
 *
 * 优先 `x-real-ip` —— nginx 用 `$remote_addr` 覆盖式写入，客户端伪造不了。
 * （**不能**用 X-Forwarded-For：nginx 的 $proxy_add_x_forwarded_for 是追加，
 * 客户端自带的值会排在最左边，而 Fastify 权威取最左，等于把限流键交给了攻击者。
 * 服务器上的 nginx 配置已改成覆盖式重写。）
 */
export function clientIp(req: FastifyRequest): string {
  const real = req.headers['x-real-ip']
  if (typeof real === 'string' && real.trim()) return real.trim()
  return req.ip
}
