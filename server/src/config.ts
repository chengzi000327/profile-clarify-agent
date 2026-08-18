import { loadEnvFile } from 'node:process'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

let projectEnvLoaded = false

const loadProjectEnv = (): void => {
  if (projectEnvLoaded) return
  projectEnvLoaded = true
  try {
    loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4100),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url().optional(),
  SESSION_SECRET: z.string().min(32).default('development-only-session-secret-change-me'),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  HARNESS_BASE_URL: z.string().url().default('http://localhost:4110'),
  HARNESS_SIDECAR_TOKEN: z.string().min(24).default('development-sidecar-token'),
  ROLE_AGENT_TOOL_TOKEN: z.string().min(24).default('development-harness-tool-token'),
  DEEPSEEK_FLASH_MODEL: z.string().default('deepseek-v4-flash'),
  DEEPSEEK_PRO_MODEL: z.string().default('deepseek-v4-pro'),
  AGENT_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  TOOL_TIMEOUT_MS: z.coerce.number().int().min(100).default(5_000),
  HC_EVENT_SECRET: z.string().min(32).optional(),
  HC_EVENT_MAX_SKEW_SECONDS: z.coerce.number().int().min(30).max(900).default(300),
  FEISHU_ENABLED: z.preprocess(
    (value) => value === true || value === 'true' || value === '1',
    z.boolean().default(false),
  ),
  FEISHU_APP_ID: z.string().min(1).optional(),
  FEISHU_APP_SECRET: z.string().min(1).optional(),
  FEISHU_VERIFICATION_TOKEN: z.string().min(1).optional(),
  FEISHU_WORKSPACE_ID: z.string().min(3).max(64).default('feishu-company'),
  FEISHU_USER_MAPPINGS_JSON: z.string().default('{}'),
  FEISHU_API_BASE_URL: z.string().url().default('https://open.feishu.cn/open-apis'),
})

export type AppConfig = z.infer<typeof ConfigSchema>

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
  if (env === process.env) loadProjectEnv()
  return ConfigSchema.parse(env)
}
