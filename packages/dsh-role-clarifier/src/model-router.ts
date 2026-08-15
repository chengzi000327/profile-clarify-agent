export type ModelTier = 'FLASH' | 'PRO'

const flashTasks = new Set([
  'CLARIFY_MESSAGE',
  'EXTRACT_FACTS',
  'PLAN_QUESTION',
  'EXTRACT_CANDIDATE_EVIDENCE',
  'STRUCTURE_FEEDBACK',
])

export const routeModelTier = (task: string): ModelTier =>
  flashTasks.has(task) ? 'FLASH' : 'PRO'
