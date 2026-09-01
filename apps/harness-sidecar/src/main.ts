import { buildSidecarApp } from './app.js'
import { loadSidecarConfig } from './config.js'

const config = loadSidecarConfig()
const app = buildSidecarApp(config)

const shutdown = async (): Promise<void> => {
  await app.close()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())

await app.listen({ host: config.HOST, port: config.SIDECAR_PORT })
