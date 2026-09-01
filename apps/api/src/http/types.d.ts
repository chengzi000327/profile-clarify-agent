import type { ActorContext } from '@role-clarifier/contracts'

declare module 'fastify' {
  interface FastifyRequest {
    actor: ActorContext
  }
}
