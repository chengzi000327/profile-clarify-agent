function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toText(value, fallback = '') {
  if (typeof value === 'string') return value.trim() || fallback;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function toTextList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => toText(item)).filter(Boolean);
}

function normalizeTargetTypes(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    if (typeof item === 'string') {
      return { code: String.fromCharCode(65 + index), title: item, why: '', check: '' };
    }
    const target = isRecord(item) ? item : {};
    return {
      code: toText(target.code, String.fromCharCode(65 + index)),
      title: toText(target.title ?? target.name, `优先人才类型 ${index + 1}`),
      why: toText(target.why ?? target.reason),
      check: toText(target.check ?? target.resume_check),
    };
  });
}

function normalizeSignals(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    if (typeof item === 'string') {
      return { id: `S-${index + 1}`, title: item, required: true, lookFor: [], notEnough: '' };
    }
    const signal = isRecord(item) ? item : {};
    return {
      id: toText(signal.id, `S-${index + 1}`),
      title: toText(signal.title ?? signal.name, `判断信号 ${index + 1}`),
      required: signal.required !== false,
      lookFor: toTextList(signal.look_for ?? signal.lookFor),
      notEnough: toText(signal.not_enough ?? signal.notEnough, '待补充反例'),
    };
  });
}

function normalizeRules(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    if (typeof item === 'string') return { label: `规则 ${index + 1}`, condition: item, tone: 'neutral' };
    const rule = isRecord(item) ? item : {};
    const tone = ['go', 'stop', 'verify', 'neutral'].includes(rule.tone) ? rule.tone : 'neutral';
    return {
      label: toText(rule.label ?? rule.title, `规则 ${index + 1}`),
      condition: toText(rule.condition ?? rule.description),
      tone,
    };
  });
}

function normalizePhoneScreen(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    if (typeof item === 'string') return { id: `P-${index + 1}`, question: item, listenFor: '', risk: '' };
    const question = isRecord(item) ? item : {};
    return {
      id: toText(question.id, `P-${index + 1}`),
      question: toText(question.question, `电话初筛问题 ${index + 1}`),
      listenFor: toText(question.listen_for ?? question.listenFor),
      risk: toText(question.risk),
    };
  });
}

function normalizeCandidates(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((candidate, index) => {
    const evidenceItems = Array.isArray(candidate.evidence) ? candidate.evidence.filter(isRecord) : [];
    const strongCount = evidenceItems.filter((item) => item.signal === 'STRONG').length;
    const missingCount = evidenceItems.filter((item) => item.signal === 'MISSING').length;
    const decision = strongCount > 0 && missingCount === 0 ? '建议推进' : missingCount > 0 ? '电话验证' : '待校准';
    return {
      id: toText(candidate.candidate_ref, `candidate-${index + 1}`),
      name: `匿名候选人 ${index + 1}`,
      currentRole: toText(candidate.channel, '渠道待同步'),
      agentDecision: decision,
      tone: decision === '建议推进' ? 'go' : 'verify',
      evidence: evidenceItems.map((item) => toText(item.criterion)).filter(Boolean),
      gap: toTextList(candidate.bottlenecks).join('；') || '暂无重复卡点',
    };
  });
}

export function normalizeRecruitingContent(contentValue, hcValue, candidatesValue) {
  const content = isRecord(contentValue) ? contentValue : {};
  const hc = isRecord(hcValue) ? hcValue : {};
  const sourcing = isRecord(content.sourcing) ? content.sourcing : {};
  const screening = isRecord(content.resume_screening) ? content.resume_screening : {};
  const candidates = normalizeCandidates(candidatesValue);

  return {
    approvedContext: {
      coreProblem: toText(hc.organization_gap, 'HC 审批数据中尚未同步组织缺口。'),
    },
    candidateDefinition: toText(
      content.candidate_definition,
      '当前招聘画像缺少一句话目标候选人，请生成新版本补齐。',
    ),
    sourcingBrief: {
      targetTypes: normalizeTargetTypes(sourcing.target_types),
      titles: toTextList(sourcing.titles),
      keywords: toTextList(sourcing.keywords),
      query: toText(sourcing.query, '当前版本未生成检索式'),
      nonTarget: toTextList(sourcing.non_target),
    },
    resumeScreening: {
      decision: toText(screening.decision, '当前版本未生成推进规则'),
      coreSignals: normalizeSignals(screening.core_signals),
      rules: normalizeRules(screening.rules),
    },
    phoneScreen: normalizePhoneScreen(content.phone_screen),
    candidateCalibration: {
      source: candidates.length > 0 ? `已导入 ${candidates.length} 份脱敏简历` : '尚未导入首批简历',
      samples: candidates,
    },
  };
}
