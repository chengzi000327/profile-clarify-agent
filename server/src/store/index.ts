import type { AppConfig } from '../config.js'
import { MemoryStore } from './memory-store.js'
import { PostgresStore } from './postgres-store.js'
import type { ApplicationStore } from './types.js'

export * from './types.js'

export const createStore = (config: AppConfig): ApplicationStore =>
  config.DATABASE_URL ? new PostgresStore(config.DATABASE_URL) : new MemoryStore()
