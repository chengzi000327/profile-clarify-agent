function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toDisplayText(value, fallback = '') {
  if (typeof value === 'string') return value.trim() || fallback;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function toTextList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => toDisplayText(item)).filter(Boolean);
}

function normalizeHiringReason(value, hc = {}) {
  if (typeof value === 'string') {
    return {
      businessChange: toDisplayText(hc.business_change, '待同步'),
      organizationGap: toDisplayText(hc.organization_gap, '待同步'),
      conclusion: value.trim() || toDisplayText(hc.approved_reason, '待同步'),
      noHireImpact: '',
    };
  }

  const reason = isRecord(value) ? value : {};
  return {
    businessChange: toDisplayText(reason.business_change ?? hc.business_change, '待同步'),
    organizationGap: toDisplayText(reason.organization_gap ?? hc.organization_gap, '待同步'),
    conclusion: toDisplayText(reason.conclusion ?? reason.hiring_conclusion ?? hc.approved_reason, '待同步'),
    noHireImpact: toDisplayText(reason.no_hire_impact),
  };
}

function normalizeOutcomes(content) {
  const source = Array.isArray(content.success_outcomes)
    ? content.success_outcomes
    : Array.isArray(content.outcomes)
      ? content.outcomes
      : [];

  return source.map((item, index) => {
    if (typeof item === 'string') {
      return { id: `outcome-${index}`, horizon: `阶段 ${index + 1}`, title: item, detail: '', measures: [] };
    }
    const outcome = isRecord(item) ? item : {};
    return {
      id: toDisplayText(outcome.id, `outcome-${index}`),
      horizon: toDisplayText(outcome.horizon, `阶段 ${index + 1}`),
      title: toDisplayText(outcome.result ?? outcome.title ?? outcome.definition, `成功结果 ${index + 1}`),
      detail: toDisplayText(outcome.definition ?? outcome.evidence),
      measures: toTextList(outcome.measures),
    };
  });
}

function normalizeWork(content, hc = {}) {
  const scenarios = Array.isArray(content.work_scenarios) ? content.work_scenarios : [];
  if (scenarios.length > 0) {
    return scenarios.map((item, index) => {
      if (typeof item === 'string') return { id: `work-${index}`, title: item, detail: '', outputs: [] };
      const scenario = isRecord(item) ? item : {};
      return {
        id: toDisplayText(scenario.id, `work-${index}`),
        title: toDisplayText(scenario.title ?? scenario.name, `关键工作 ${index + 1}`),
        detail: toDisplayText(scenario.description ?? scenario.task ?? scenario.context),
        outputs: toTextList(scenario.outputs ?? scenario.deliverables),
      };
    });
  }

  const responsibilities = Array.isArray(content.responsibilities)
    ? content.responsibilities
    : Array.isArray(hc.initial_responsibilities)
      ? hc.initial_responsibilities
      : [];
  return responsibilities.map((item, index) => {
    if (typeof item === 'string') return { id: `work-${index}`, title: item, detail: '', outputs: [] };
    const responsibility = isRecord(item) ? item : {};
    return {
      id: toDisplayText(responsibility.id, `work-${index}`),
      title: toDisplayText(responsibility.title ?? responsibility.name, `核心职责 ${index + 1}`),
      detail: toDisplayText(responsibility.description),
      outputs: toTextList(responsibility.outputs),
    };
  });
}

function normalizeRequirements(content) {
  const source = Array.isArray(content.requirements)
    ? content.requirements
    : Array.isArray(content.capabilities)
      ? content.capabilities
      : [];

  return source.map((item, index) => {
    if (typeof item === 'string') {
      return { id: `requirement-${index}`, name: item, level: '', evidence: [], priority: '' };
    }
    const requirement = isRecord(item) ? item : {};
    const evidence = [
      ...toTextList(requirement.strong_evidence),
      ...toTextList(requirement.evidence),
    ];
    const singleEvidence = toDisplayText(requirement.evidence);
    if (singleEvidence) evidence.push(singleEvidence);
    return {
      id: toDisplayText(requirement.id, `requirement-${index}`),
      name: toDisplayText(requirement.name ?? requirement.title, `人才要求 ${index + 1}`),
      level: toDisplayText(requirement.level),
      evidence: [...new Set(evidence)],
      priority: toDisplayText(requirement.priority ?? requirement.type),
    };
  });
}

function normalizeBoundaries(value) {
  if (Array.isArray(value)) {
    return [{ label: '岗位边界', items: toTextList(value) }].filter((group) => group.items.length > 0);
  }
  if (!isRecord(value)) return [];

  const groups = [
    { label: '负责', items: toTextList(value.owns) },
    { label: '不负责', items: toTextList(value.does_not_own) },
    { label: '决策权限', items: [toDisplayText(value.decision_rights)].filter(Boolean) },
    { label: '协作与资源', items: [toDisplayText(value.collaboration_and_resources)].filter(Boolean) },
  ];
  return groups.filter((group) => group.items.length > 0);
}

export function normalizeRoleProfileContent(value, hcValue) {
  const content = isRecord(value) ? value : {};
  const hc = isRecord(hcValue) ? hcValue : {};
  return {
    mission: toDisplayText(content.mission, '当前版本未形成岗位使命，请生成新版本补齐。'),
    hiringReason: normalizeHiringReason(content.hiring_reason, hc),
    outcomes: normalizeOutcomes(content),
    work: normalizeWork(content, hc),
    requirements: normalizeRequirements(content),
    boundaryGroups: normalizeBoundaries(content.boundaries),
  };
}
