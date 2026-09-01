const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const toDisplayText = (value, fallback = '') => {
  if (typeof value === 'string') return value.trim() || fallback;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const items = value.map((item) => toDisplayText(item)).filter(Boolean);
    return items.length ? items.join('；') : fallback;
  }
  if (isRecord(value)) {
    for (const key of ['statement', 'text', 'description', 'summary', 'conclusion', 'value']) {
      const text = toDisplayText(value[key]);
      if (text) return text;
    }
    const items = Object.entries(value)
      .map(([key, item]) => {
        const text = toDisplayText(item);
        return text ? `${key}：${text}` : '';
      })
      .filter(Boolean);
    return items.length ? items.join('；') : fallback;
  }
  return fallback;
};

const normalizeAnchors = (value) => {
  if (Array.isArray(value)) return value.map((item) => toDisplayText(item)).filter(Boolean);
  if (!isRecord(value)) return [];
  return Object.entries(value)
    .map(([score, text]) => {
      const description = toDisplayText(text);
      return description ? `${score} 分：${description}` : '';
    })
    .filter(Boolean);
};

export function normalizeAssessmentContent(value) {
  const content = isRecord(value) ? value : {};
  const dimensions = (Array.isArray(content.dimensions) ? content.dimensions : [])
    .filter(isRecord)
    .map((dimension, index) => ({
      id: toDisplayText(dimension.id, `A-${String(index + 1).padStart(2, '0')}`),
      name: toDisplayText(dimension.name, `评估维度 ${index + 1}`),
      weight: toDisplayText(dimension.weight, '—'),
      method: toDisplayText(dimension.method, '待确认'),
      owner: toDisplayText(dimension.owner),
      question: toDisplayText(dimension.question),
      evidence: toDisplayText(dimension.evidence),
      anchors: normalizeAnchors(dimension.anchors),
    }));

  const rawRule = content.decision_rule;
  if (typeof rawRule === 'string') {
    return {
      dimensions,
      decisionRule: {
        status: '',
        summary: rawRule.trim() || '当前版本尚未生成录用决策规则。',
        items: [],
      },
    };
  }

  const rule = isRecord(rawRule) ? rawRule : {};
  const items = [
    ['评分方法', rule.scoring],
    ['通过门槛', rule.pass_thresholds],
    ['校准说明', rule.calibration],
  ]
    .map(([label, itemValue]) => ({ label, value: toDisplayText(itemValue) }))
    .filter((item) => item.value);

  return {
    dimensions,
    decisionRule: {
      status: toDisplayText(rule.status),
      summary: toDisplayText(
        rule.summary ?? rule.conclusion,
        items.length === 0 ? '当前版本尚未生成录用决策规则。' : '',
      ),
      items,
    },
  };
}
