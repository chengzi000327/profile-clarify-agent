import { buildApp } from './app.js'
import { loadConfig } from './config.js'

const config = loadConfig()
const app = await buildApp(config)

const stop = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'shutting down')
  await app.close()
  process.exit(0)
}

process.on('SIGINT', () => void stop('SIGINT'))
process.on('SIGTERM', () => void stop('SIGTERM'))

try {
  await app.listen({ host: config.HOST, port: config.PORT })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
