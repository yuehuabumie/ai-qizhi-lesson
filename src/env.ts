import 'dotenv/config'
import { z } from 'zod'

/**
 * 布尔值解析。
 *
 * 不能直接用 `z.coerce.boolean()` —— 它走的是 JS 的 `Boolean()`，
 * 而 `Boolean("false") === true`。systemd 的 EnvironmentFile 把
 * `COOKIE_SECURE=false` 传进来时会变成 true，静默把 http 环境锁死。
 */
const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return def
      return ['true', '1', 'yes', 'on'].includes(v.trim().toLowerCase())
    })

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(3020),

  DATABASE_URL: z.string().min(1, '不能为空（形如 mysql://user:pw@127.0.0.1:3306/aiq_course）'),
  REDIS_URL: z.string().min(1, '不能为空（形如 redis://127.0.0.1:6379/1）'),
  REDIS_PREFIX: z.string().default('aiq:'),

  AUTH_SECRET: z.string().min(32, '至少 32 字符，用 openssl rand -base64 48 生成'),
  COOKIE_NAME: z.string().default('aiq_session'),
  COOKIE_SECURE: bool(true),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(7),

  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_SECURE: bool(true),
  SMTP_USER: z.string().min(1),
  SMTP_PASSWORD: z.string().min(1),
  SMTP_FROM: z.string().min(1),

  // 提示词魔法工坊的真实出图后端（阿里云 MaaS，OpenAI compatible-mode）。
  // 密钥只存在服务端；前端永远只调本服务的 /api/ai/image。
  AI_IMAGE_BASE_URL: z.string().url(),
  AI_IMAGE_API_KEY: z.string().min(1),
  AI_IMAGE_MODEL: z.string().min(1).default('z-image-turbo'),

  // 头像 AI 审核，可选：没配就跳过审核（放行）。模型要支持图片输入，
  // 走 OpenAI 兼容的 /chat/completions。见 lib/avatar-moderation.ts。
  AVATAR_MODERATION_BASE_URL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().url().optional(),
  ),
  AVATAR_MODERATION_API_KEY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).optional(),
  ),
  AVATAR_MODERATION_MODEL: z.string().min(1).default('deepseek-flash'),

  APP_ORIGIN: z.string().url(),

  // 智能备课默认关闭；先完成迁移及独立运行器配置，再显式启用。
  PREP_ENABLED: bool(false),
  PREP_WORKER_URL: z.string().url().default('http://127.0.0.1:3331'),
  PREP_WORKER_SECRET: z.string().min(32).optional(),
  PREP_STORAGE_DIR: z.string().default('.data/prep'),
  // 与隔离运行器的25MiB硬上限一致，管理员可以按需调低。
  PREP_MAX_FILE_MB: z.coerce.number().int().min(1).max(25).default(25),
  PREP_USER_STORAGE_MB: z.coerce.number().int().min(25).default(250),
  PREP_GLOBAL_STORAGE_MB: z.coerce.number().int().min(250).default(2048),
  PREP_USER_HISTORY_MB: z.coerce.number().int().min(10).default(100),
  PREP_GLOBAL_HISTORY_MB: z.coerce.number().int().min(100).default(1024),
  PREP_MAX_QUEUED_RUNS: z.coerce.number().int().min(1).max(200).default(20),
  PREP_DAILY_RUNS: z.coerce.number().int().min(1).default(10),
  PREP_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  PREP_RUN_TIMEOUT_MINUTES: z.coerce.number().int().min(1).max(60).default(20),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  // 故意不进 logger：这里崩掉时 Fastify 还没起来，而且缺变量这种事
  // 越早越吵越好，不要带着半个配置跑起来。
  console.error('\n❌ 环境变量校验失败，服务拒绝启动：\n')
  for (const issue of parsed.error.issues) {
    console.error(`   · ${issue.path.join('.') || '(root)'} — ${issue.message}`)
  }
  console.error('\n检查 /home/ubuntu/aiq-api/.env，可对照 .env.example。\n')
  process.exit(1)
}

export const env = parsed.data
export const isProd = env.NODE_ENV === 'production'
