import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAssessmentContent } from './assessment-content.js';

test('maps the model assessment contract into render-safe frontend fields', () => {
  const result = normalizeAssessmentContent({
    dimensions: [{
      id: 'A-01', name: '复杂问题抽象', weight: 40, method: '案例面试', owner: '用人经理',
      question: '如何识别共性需求？', evidence: '能说明取舍与结果',
      anchors: { 1: '只复述需求', 3: '能形成方案', 5: '能形成复用结果' },
    }],
    decision_rule: {
      status: '草稿', summary: '核心维度不得低于 3 分', scoring: '加权平均',
      pass_thresholds: '总分不低于 3.5', calibration: '面试后统一校准',
    },
  });

  assert.equal(result.dimensions[0].weight, '40');
  assert.deepEqual(result.dimensions[0].anchors, [
    '1 分：只复述需求', '3 分：能形成方案', '5 分：能形成复用结果',
  ]);
  assert.equal(result.decisionRule.summary, '核心维度不得低于 3 分');
  assert.equal(result.decisionRule.items[1].value, '总分不低于 3.5');
});

test('keeps legacy and malformed assessment data from reaching React as objects', () => {
  const legacy = normalizeAssessmentContent({
    dimensions: [{ name: '业务判断', weight: { value: 30 }, anchors: [{ statement: '低分' }] }],
    decision_rule: { pass_thresholds: { must_have: '不得低于 3 分' } },
  });
  assert.equal(typeof legacy.dimensions[0].weight, 'string');
  assert.equal(typeof legacy.dimensions[0].anchors[0], 'string');
  assert.equal(typeof legacy.decisionRule.items[0].value, 'string');
});
