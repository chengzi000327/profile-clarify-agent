import type { ServerResponse } from 'node:http'
import type { AgentEvent } from '@role-clarifier/contracts'

export const writeSseEvent = (response: ServerResponse, event: AgentEvent): void => {
  response.write(`id: ${event.sequence}\n`)
  response.write(`event: ${event.type}\n`)
  response.write(`data: ${JSON.stringify(event)}\n\n`)
}
