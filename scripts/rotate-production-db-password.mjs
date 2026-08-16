import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import postgres from '../server/node_modules/postgres/src/index.js'

const root = resolve(import.meta.dirname, '..')
const railway = (args, input) => {
  const result = spawnSync('railway', args, {
    cwd: root,
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  if (result.status !== 0) {
    process.stderr.write(result.stderr)
    process.exit(result.status ?? 1)
  }
  return result.stdout
}

const config = JSON.parse(railway(['variable', 'list', '--service', 'Postgres', '--json']))
const port = process.env.DATABASE_TUNNEL_PORT
if (!port) throw new Error('DATABASE_TUNNEL_PORT is required')
const oldUrl = `postgres://${encodeURIComponent(config.PGUSER)}:${encodeURIComponent(config.PGPASSWORD)}@127.0.0.1:${port}/${encodeURIComponent(config.PGDATABASE)}`
const nextPassword = randomBytes(36).toString('base64url')

const current = postgres(oldUrl, { max: 1, prepare: false })
try {
  const safeRole = String(config.PGUSER).replaceAll('"', '""')
  const safePassword = nextPassword.replaceAll("'", "''")
  await current.unsafe(`ALTER ROLE "${safeRole}" PASSWORD '${safePassword}'`)
} finally {
  await current.end()
}

railway(
  ['variable', 'set', 'PGPASSWORD', '--stdin', '--service', 'Postgres', '--skip-deploys'],
  nextPassword,
)
railway(
  ['variable', 'set', 'POSTGRES_PASSWORD', '--stdin', '--service', 'Postgres', '--skip-deploys'],
  nextPassword,
)
const internalUrl = `postgresql://${encodeURIComponent(config.PGUSER)}:${encodeURIComponent(nextPassword)}@${config.PGHOST}:${config.PGPORT}/${encodeURIComponent(config.PGDATABASE)}`
railway(
  ['variable', 'set', 'DATABASE_URL', '--stdin', '--service', 'Postgres', '--skip-deploys'],
  internalUrl,
)

const verifyUrl = `postgres://${encodeURIComponent(config.PGUSER)}:${encodeURIComponent(nextPassword)}@127.0.0.1:${port}/${encodeURIComponent(config.PGDATABASE)}`
const verify = postgres(verifyUrl, { max: 1, prepare: false })
try {
  const [result] = await verify`SELECT current_user AS current_user, current_database() AS current_database`
  if (result.current_user !== config.PGUSER || result.current_database !== config.PGDATABASE) {
    throw new Error('Rotated database credential verification failed')
  }
} finally {
  await verify.end()
}
console.log(JSON.stringify({ status: 'rotated', user: config.PGUSER, database: config.PGDATABASE }))
