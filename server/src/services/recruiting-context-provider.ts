import type { ActorContext } from '@role-clarifier/contracts'
import type {
  ApplicationStore,
  RecruitingContextQuery,
  RecruitingContextRecord,
} from '../store/index.js'

/**
 * Read-only boundary for organization and recruiting evidence.
 *
 * A production HRIS/ATS/knowledge-base connector should implement this interface,
 * enforce tenant and actor scope before returning records, and keep raw credentials
 * and employee PII outside the model-facing service.
 */
export interface RecruitingContextProvider {
  readonly providerId: string
  list(
    actor: ActorContext,
    query: RecruitingContextQuery,
  ): Promise<RecruitingContextRecord[]>
}

export class StoreRecruitingContextProvider implements RecruitingContextProvider {
  readonly providerId = 'RECRUITING_CONTEXT_STORE'

  constructor(private readonly store: ApplicationStore) {}

  async list(
    actor: ActorContext,
    query: RecruitingContextQuery,
  ): Promise<RecruitingContextRecord[]> {
    return this.store.listRecruitingContextRecords(actor, query)
  }
}

/**
 * Lets a tenant add HRIS, ATS and knowledge-base providers without changing the
 * clarification Agent contract. Providers remain responsible for authorization;
 * this class only combines already-authorized records.
 */
export class CompositeRecruitingContextProvider implements RecruitingContextProvider {
  readonly providerId = 'COMPOSITE_RECRUITING_CONTEXT'

  constructor(private readonly providers: RecruitingContextProvider[]) {}

  async list(
    actor: ActorContext,
    query: RecruitingContextQuery,
  ): Promise<RecruitingContextRecord[]> {
    const results = await Promise.all(this.providers.map((provider) => provider.list(actor, query)))
    const seen = new Set<string>()
    return results.flat().filter((record) => {
      const key = `${record.tenant_id}\u0000${record.record_type}\u0000${record.external_id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).slice(0, Math.min(Math.max(query.limit ?? 1_000, 1), 1_000))
  }
}
