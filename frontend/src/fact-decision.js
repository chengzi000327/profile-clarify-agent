export const factStatusLabel = {
  DRAFT: '待确认',
  CONFIRMED: '已生效',
  CONFLICTED: '有冲突',
  STALE: '已失效',
};

export const factCategoryLabel = {
  BACKGROUND: '业务背景',
  HIRING_REASON: '招聘原因',
  SUCCESS_CRITERION: '成功标准',
  CONSTRAINT: '招聘约束',
};

export const canDecideFact = (effectiveRole, fact) => (
  effectiveRole === 'MANAGER'
  && (fact?.status === 'DRAFT' || fact?.status === 'CONFLICTED')
);

export const pendingFacts = (facts = []) => facts.filter(
  (fact) => fact.status === 'DRAFT' || fact.status === 'CONFLICTED',
);

export const factForMessage = (facts = [], factId) => {
  if (!factId) return null;
  const referenced = facts.find((fact) => fact.id === factId);
  if (!referenced) return null;
  if (!referenced.source_run_id || !referenced.source_message_id) return referenced;

  const chain = facts
    .filter((fact) => (
      fact.source_run_id === referenced.source_run_id
      && fact.source_message_id === referenced.source_message_id
    ))
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  return chain.find((fact) => fact.status === 'DRAFT' || fact.status === 'CONFLICTED')
    ?? chain.find((fact) => fact.status === 'CONFIRMED')
    ?? chain[0]
    ?? referenced;
};
