import Fastify, { type FastifyInstance } from 'fastify'
import { ZodError } from 'zod'
import type { SidecarConfig } from './config.js'
import { HarnessExecutor, type SidecarExecution } from './executor.js'
import { HarnessRequestSchema, type HarnessRequest } from './schemas.js'

export interface ExecutorLike {
  readiness(): { runtime: boolean; credential: boolean }
  execute(request: HarnessRequest, signal: AbortSignal): Promise<SidecarExecution>
}

export const buildSidecarApp = (
  config: SidecarConfig,
  executor: ExecutorLike = new HarnessExecutor(config),
): FastifyInstance => {
  const app = Fastify({ logger: config.NODE_ENV !== 'test', bodyLimit: 4 * 1024 * 1024 })
  let active = 0

  app.get('/healthz', async () => ({
    status: 'ok',
    harness: {
      source_version: '0.1.0-rc.5',
      commit: '47f943859bef60e4160492346772ded9b24f765a',
      ...executor.readiness(),
    },
  }))

  app.post('/v1/role-clarifier/runs', async (request, reply) => {
    if (request.headers.authorization !== `Bearer ${config.HARNESS_SIDECAR_TOKEN}`) {
      return reply.status(401).send({ error: { code: 'SIDECAR_UNAUTHORIZED' } })
    }
    if (active >= config.SIDECAR_CONCURRENCY) {
      return reply.status(429).send({ error: { code: 'SIDECAR_BUSY' } })
    }
    const parsed = HarnessRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Harness request is invalid',
          fields: parsed.error.issues.map((issue) => issue.path.join('.')).filter(Boolean),
        },
      })
    }
    const input = parsed.data
    const controller = new AbortController()
    const abort = (): void => controller.abort()
    request.raw.once('aborted', abort)
    active += 1
    try {
      return await executor.execute(input, controller.signal)
    } finally {
      request.raw.off('aborted', abort)
      active -= 1
    }
  })

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      const fields = error.issues.map((issue) =>
        `${issue.path.join('.') || '<root>'}:${issue.code}`)
      return reply.status(502).send({
        error: {
          code: 'MODEL_OUTPUT_INVALID',
          message: `Model structured output is invalid (${fields.join(', ')})`,
        },
      })
    }
    request.log.error(error)
    const message = error instanceof Error ? error.message : 'Harness execution failed'
    const unavailable = message.includes('not prepared') || message.includes('DEEPSEEK_API_KEY')
    return reply.status(unavailable ? 503 : 502).send({
      error: { code: unavailable ? 'HARNESS_NOT_READY' : 'HARNESS_EXECUTION_FAILED', message },
    })
  })

  return app
}
