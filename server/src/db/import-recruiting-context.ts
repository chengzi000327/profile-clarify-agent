import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { loadConfig } from '../config.js'
import { PostgresStore } from '../store/postgres-store.js'
import { RECRUITING_CONTEXT_RECORD_TYPES } from '../store/types.js'

const ContextRecordTypeSchema = z.enum(RECRUITING_CONTEXT_RECORD_TYPES)
const ContextFixtureSchema = z.object({
  batch: z.object({
    id: z.string().min(1),
    tenant_id: z.string().min(1),
    source_revision: z.string().min(1),
    source_file: z.string().min(1),
    excluded_sheets: z.array(z.string()),
    record_counts: z.record(z.string(), z.number().int().nonnegative()),
    imported_at: z.string().datetime(),
  }).strict(),
  records: z.array(z.object({
    tenant_id: z.string().min(1),
    record_type: ContextRecordTypeSchema,
    external_id: z.string().min(1),
    team_id: z.string().nullable(),
    role_title: z.string().nullable(),
    conversation_id: z.string().nullable(),
    source_system: z.string().min(1),
    data_classification: z.string().min(1),
    effective_at: z.string().datetime().nullable(),
    content: z.record(z.string(), z.unknown()),
    import_id: z.string().min(1),
  }).strict()),
}).strict()

const config = loadConfig()
if (!config.DATABASE_URL) throw new Error('DATABASE_URL is required for context import')

const fixturePath = fileURLToPath(new URL('../../data/enterprise-context-v4.json', import.meta.url))
const fixture = ContextFixtureSchema.parse(JSON.parse(await readFile(fixturePath, 'utf8')))
if (fixture.records.some((record) => record.import_id !== fixture.batch.id)) {
  throw new Error('Every context record must reference the fixture import batch')
}

const store = new PostgresStore(config.DATABASE_URL)
try {
  await store.initialize()
  await store.upsertRecruitingContextImport(fixture.batch, fixture.records)
  const actualCounts: Record<string, number> = {}
  for (const recordType of RECRUITING_CONTEXT_RECORD_TYPES) {
    const rows = await store.listRecruitingContextRecords({
      tenant_id: fixture.batch.tenant_id,
      user_id: 'context-import-verifier',
      role: 'ADMIN',
      display_name: 'Context Import Verifier',
    }, { record_types: [recordType], limit: 1_000 })
    actualCounts[recordType] = rows.length
  }
  for (const [recordType, expected] of Object.entries(fixture.batch.record_counts)) {
    if (actualCounts[recordType] !== expected) {
      throw new Error(
        `Context import verification failed for ${recordType}: expected ${expected}, got ${actualCounts[recordType] ?? 0}`,
      )
    }
  }
  console.info(JSON.stringify({
    imported: true,
    import_id: fixture.batch.id,
    tenant_id: fixture.batch.tenant_id,
    excluded_sheets: fixture.batch.excluded_sheets,
    record_counts: actualCounts,
  }))
} finally {
  await store.close()
}
