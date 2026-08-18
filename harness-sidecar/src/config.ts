import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { loadEnvFile } from 'node:process'
import { z } from 'zod'

const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
let projectEnvLoaded = false

const loadProjectEnv = (): void => {
  if (projectEnvLoaded) return
  projectEnvLoaded = true
  try {
    loadEnvFile(resolve(projectRoot, '.env'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SIDECAR_PORT: z.coerce.number().int().positive().default(4110),
  HOST: z.string().default('0.0.0.0'),
  HARNESS_SIDECAR_TOKEN: z.string().min(24).default('development-sidecar-token'),
  ROLE_AGENT_INTERNAL_URL: z.string().url().default('http://127.0.0.1:4100'),
  ROLE_AGENT_TOOL_TOKEN: z.string().min(24).default('development-harness-tool-token'),
  DEEPSEEK_API_KEY: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.string().min(1).optional(),
  ),
  DEEPSEEK_BASE_URL: z.string().url().optional(),
  DEEPSEEK_FLASH_MODEL: z.string().min(1).default('deepseek-v4-flash'),
  DEEPSEEK_PRO_MODEL: z.string().min(1).default('deepseek-v4-pro'),
  DSH_RUNTIME_BIN: z.string().default(
    resolve(projectRoot, '.harness/deepseek-harness/packages/examples/jsonrpc-demo/lib/bin.js'),
  ),
  DSH_CORDIS_CONFIG: z.string().default(
    resolve(projectRoot, '.harness/deepseek-harness/packages/external/role-clarifier/cordis.yml'),
  ),
  DSH_MAX_TOKENS: z.coerce.number().int().positive().max(65_536).default(16_384),
  DSH_RUN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(90_000),
  SIDECAR_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(4),
})

export type SidecarConfig = z.infer<typeof ConfigSchema>

export const loadSidecarConfig = (env: NodeJS.ProcessEnv = process.env): SidecarConfig => {
  if (env === process.env) loadProjectEnv()
  return ConfigSchema.parse(env)
}
