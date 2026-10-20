import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import { ZodError } from 'zod'
import { env, isProd } from './env.js'
import { ApiError } from './lib/errors.js'
import { prisma } from './lib/db.js'
import { closeRedis } from './lib/redis.js'
import { healthRoutes } from './routes/health.js'
import { authRoutes } from './routes/auth.js'
import { progressRoutes } from './routes/progress.js'
import { worksRoutes } from './routes/works.js'
import { aiRoutes } from './routes/ai.js'
import { classesRoutes } from './routes/classes.js'

const app = Fastify({
  // nginx 在前面，不信任代理的话 req.ip 永远是 127.0.0.1，限流会误伤所有人
  trustProxy: true,
  logger: isProd
    ? { level: 'info' }
    : { level: 'info', transport: { target: 'pino-pretty' } },
  // 限流键取自 x-real-ip，不要让它被伪造的 X-Forwarded-For 影响
  bodyLimit: 256 * 1024, // 作品描述等都很小，256KB 足够，顺带挡掉大体积攻击
})

await app.register(cookie)
// 刻意**不**给 @fastify/cookie 传 secret：JWT 本身已经签名了，
// 再套一层 cookie 签名只会让 req.cookies 里拿到 `s:` 前缀的值，
// 每个读取点都得记得 unsign，是个纯粹的坑。

// ── 统一错误出口 ────────────────────────────────────────────
app.setErrorHandler((err, req, reply) => {
  if (err instanceof ApiError) {
    // 业务错误是可预期的，用 info 而不是 error，免得日志被 429 淹没
    req.log.info({ code: err.code, path: req.url }, err.message)
    return reply.code(err.status).send(err.toBody())
  }

  // Fastify 自己的请求错误（400 JSON 不合法 / 413 body 过大 / 415 Content-Type 不对等）：
  // 统一按客户端错误回，不落进 500 兜底——否则既污染「未处理的服务端异常」这条
  // 运维 grep 线索，又把可修复的客户端问题报成服务端故障。
  const sc = (err as { statusCode?: number }).statusCode
  if (typeof sc === 'number' && sc >= 400 && sc < 500) {
    const message = sc === 413 ? '请求体过大' : '请求格式不正确'
    req.log.info({ code: 'VALIDATION_ERROR', path: req.url, statusCode: sc }, message)
    return reply.code(sc).send({ error: { code: 'VALIDATION_ERROR', message } })
  }

  // 兜底：漏用 parseBody、直接 schema.parse() 的地方抛的是 ZodError 而非 ApiError。
  // 那属于「客户端参数不对」，不该报成 500，也不该把堆栈刷进错误日志。
  if (err instanceof ZodError) {
    const msg = err.issues[0]?.message || '请求参数不正确'
    req.log.info({ code: 'VALIDATION_ERROR', path: req.url }, msg)
    return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: msg } })
  }

  req.log.error({ err, path: req.url }, '未处理的服务端异常')
  return reply
    .code(500)
    .send({ error: { code: 'INTERNAL_ERROR', message: '服务器开小差了，请稍后再试' } })
})

app.setNotFoundHandler((req, reply) => {
  reply
    .code(404)
    .send({ error: { code: 'NOT_FOUND', message: `接口不存在：${req.method} ${req.url}` } })
})

// ── 路由 ────────────────────────────────────────────────────
await app.register(healthRoutes, { prefix: '/api' })
await app.register(authRoutes, { prefix: '/api' })
await app.register(progressRoutes, { prefix: '/api' })
await app.register(worksRoutes, { prefix: '/api' })
await app.register(aiRoutes, { prefix: '/api' })
await app.register(classesRoutes, { prefix: '/api' })

// ── 优雅退出：systemctl restart 时不掐断在途请求 / 不漏连接 ──
let closing = false
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    if (closing) return
    closing = true
    app.log.info(`${sig} 收到，正在关闭…`)

    // 兜底：10 秒还没关干净就强退，别卡住 systemd 的 stop
    const force = setTimeout(() => process.exit(1), 10_000)
    force.unref()

    void (async () => {
      try {
        await app.close()
        await prisma.$disconnect()
        await closeRedis()
        process.exit(0)
      } catch (e) {
        app.log.error({ err: e }, '关闭过程出错')
        process.exit(1)
      }
    })()
  })
}

try {
  await app.listen({ host: env.HOST, port: env.PORT })
  app.log.info(`AI 启智课 API 已启动 → http://${env.HOST}:${env.PORT}`)
} catch (err) {
  app.log.error({ err }, '启动失败')
  process.exit(1)
}
