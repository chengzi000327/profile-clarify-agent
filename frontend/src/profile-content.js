const asArray = (value) => (Array.isArray(value) ? value : []);
const asObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

const toText = (value) => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join('；');
  if (value && typeof value === 'object') {
    for (const key of ['statement', 'text', 'description', 'definition', 'result', 'title', 'name', 'value', 'summary', 'conclusion']) {
      const text = toText(value[key]);
      if (text) return text;
    }
  }
  return '';
};

const joinText = (value) => asArray(value).map(toText).filter(Boolean).join('；');

const textList = (value) => asArray(value).map(toText).filter(Boolean);

const evidenceRefs = (value) => {
  const source = asArray(value);
  return source
    .map((item) => typeof item === 'string' ? item : item?.id ?? item?.ref ?? '')
    .filter(Boolean);
};

const boundaryLabels = {
  owns: '负责',
  does_not_own: '不负责',
  decision_rights: '决策权限',
  collaboration_and_resources: '协作资源',
};

export function normalizeRoleProfileContent(content = {}, hc = null) {
  const source = content && typeof content === 'object' ? content : {};
  const work = asArray(source.work);
  const legacyOutcomes = asArray(source.success_outcomes).length
    ? asArray(source.success_outcomes)
    : asArray(source.outcomes);
  const outcomes = (legacyOutcomes.length ? legacyOutcomes : work).map((item, index) => {
    const measures = textList(item?.measures).length
      ? textList(item?.measures)
      : textList(item?.deliverables);
    const definition = item?.definition ?? item?.description ?? item?.result ?? item?.title ?? '待补充结果';
    return {
      id: toText(item?.id) || `O-${String(index + 1).padStart(2, '0')}`,
      horizon: toText(item?.horizon) || toText(item?.id) || `阶段 ${index + 1}`,
      title: toText(item?.title ?? item?.result ?? item?.description) || '待补充结果',
      result: toText(item?.result ?? item?.description ?? item?.title) || '待补充结果',
      definition: toText(definition) || '待补充结果',
      measures,
      status: toText(item?.status) || '待确认',
      evidence: typeof item?.evidence === 'string' ? item.evidence : joinText(item?.deliverables),
      evidenceRefs: evidenceRefs(item?.evidence_refs ?? (typeof item?.evidence === 'string' ? [] : item?.evidence)),
    };
  });

  const responsibilities = asArray(source.responsibilities).length
    ? asArray(source.responsibilities).map(toText).filter(Boolean)
    : work.map((item) => toText(item?.description ?? item?.title)).filter(Boolean);
  const fallbackResponsibilities = asArray(hc?.initial_responsibilities);

  const legacyCapabilities = asArray(source.capabilities);
  const capabilities = (legacyCapabilities.length ? legacyCapabilities : asArray(source.requirements))
    .map((item, index) => ({
      id: toText(item?.id) || `C-${String(index + 1).padStart(2, '0')}`,
      name: toText(item?.name ?? item?.title) || '待补充能力',
      level: toText(item?.level ?? item?.priority) || '待确认',
      priority: toText(item?.priority) || (legacyCapabilities.length ? 'Must-have' : '待确认'),
      rationale: toText(item?.rationale ?? item?.why) || '待补充该要求与岗位成功的关系。',
      mapping: textList(item?.maps_to).length ? textList(item?.maps_to) : textList(item?.mapping),
      strongEvidence: typeof item?.evidence === 'string'
        ? item.evidence
        : joinText(item?.strong_evidence) || toText(item?.strongEvidence ?? item?.rationale) || '待补充可观察证据',
      substitute: joinText(item?.substitute_evidence) || toText(item?.substitute) || '待补充可接受的替代经历。',
      risk: joinText(item?.risk_signals) || toText(item?.risk) || '待补充风险信号。',
      assessment: toText(item?.assessment_method ?? item?.assessment) || '待评估方案生成',
      evidence: typeof item?.evidence === 'string'
        ? item.evidence
        : joinText(item?.strong_evidence) || item?.rationale || '待补充可观察证据',
      evidenceRefs: evidenceRefs(item?.evidence_refs ?? (typeof item?.evidence === 'string' ? [] : item?.evidence)),
    }));

  const scenarioSource = asArray(source.work_scenarios).length
    ? asArray(source.work_scenarios)
    : asArray(source.scenarios).length
      ? asArray(source.scenarios)
      : work.filter((item) => item?.trigger || item?.actions || item?.challenge || item?.stakeholders);
  const scenarios = scenarioSource.map((item, index) => ({
    id: toText(item?.id) || `T-${String(index + 1).padStart(2, '0')}`,
    title: toText(item?.title ?? item?.name) || `关键工作场景 ${index + 1}`,
    frequency: toText(item?.frequency) || '频率待确认',
    trigger: toText(item?.trigger ?? item?.context) || '触发情境待补充',
    actions: toText(item?.actions) || joinText(item?.actions) || toText(item?.description) || '关键动作待补充',
    output: toText(item?.output) || joinText(item?.outputs) || joinText(item?.deliverables) || '主要产出待补充',
    challenge: toText(item?.challenge) || '核心挑战待补充',
    stakeholders: toText(item?.stakeholders) || joinText(item?.stakeholders) || '协作对象待补充',
    outcomeRefs: textList(item?.outcome_refs).length ? textList(item?.outcome_refs) : textList(item?.outcomes),
    evidenceRefs: evidenceRefs(item?.evidence_refs ?? item?.evidence),
  }));

  const legacyBoundaries = asArray(source.boundaries);
  const boundarySource = asObject(source.boundaries);
  const owns = textList(boundarySource.owns);
  const notOwns = textList(boundarySource.does_not_own).length
    ? textList(boundarySource.does_not_own)
    : textList(boundarySource.not_owns ?? boundarySource.notOwns);
  const decisionRights = toText(boundarySource.decision_rights)
    || toText(boundarySource.decisionRights)
    || joinText(boundarySource.decision_rights);
  const resources = toText(boundarySource.collaboration_and_resources)
    || toText(boundarySource.resources)
    || joinText(boundarySource.collaboration_and_resources);
  const boundaries = legacyBoundaries.length
    ? legacyBoundaries.map(toText).filter(Boolean)
    : Object.entries(boundaryLabels).flatMap(([key, label]) =>
        asArray(boundarySource?.[key])
          .map(toText)
          .filter(Boolean)
          .map((statement) => `${label}：${statement}`),
      );

  const hiringReason = Object.keys(asObject(source.hiring_reason)).length
    ? asObject(source.hiring_reason)
    : asObject(source.recruitment);
  const recruitment = {
    conclusion: toText(source.hiring_reason) || toText(hiringReason.conclusion) || toText(hiringReason.reason) || hc?.approved_reason || '待补充招聘结论',
    businessChange: toText(hiringReason.business_change) || toText(hiringReason.businessChange) || hc?.business_change || '待同步业务变化',
    organizationGap: toText(hiringReason.organization_gap) || toText(hiringReason.organizationGap) || hc?.organization_gap || '待同步组织缺口',
    noHireImpact: toText(hiringReason.no_hire_impact) || toText(hiringReason.noHireImpact) || toText(source.no_hire_impact),
    evidenceRefs: evidenceRefs(hiringReason.evidence_refs ?? hiringReason.evidence ?? source.evidence_refs),
  };

  return {
    mission: toText(source.mission) || toText(hiringReason.mission) || '当前版本未形成岗位使命，请生成新版本补齐。',
    recruitment,
    outcomes,
    scenarios,
    responsibilities: responsibilities.length ? responsibilities : fallbackResponsibilities,
    capabilities,
    boundaries,
    boundaryGroups: {
      owns: owns.length ? owns : boundaries.filter((item) => item.startsWith('负责：')).map((item) => item.slice(3)),
      notOwns: notOwns.length ? notOwns : boundaries.filter((item) => item.startsWith('不负责：')).map((item) => item.slice(4)),
      decisionRights: decisionRights || boundaries.find((item) => item.startsWith('决策权限：'))?.slice(5) || '待确认关键决策权限。',
      resources: resources || boundaries.find((item) => item.startsWith('协作资源：'))?.slice(5) || '待确认必要协作与资源。',
      evidenceRefs: evidenceRefs(boundarySource.evidence_refs ?? boundarySource.evidence),
    },
  };
}
