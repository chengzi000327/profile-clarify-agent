import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAssessmentContent } from './assessment-content.js';

test('兼容结构化录用规则和对象评分锚点', () => {
  const result = normalizeAssessmentContent({
    decision_rule: {
      status: '待确认',
      scoring: '各维度按 1-5 分评分',
      pass_thresholds: '加权总分不低于 3.5',
      calibration: '由 HR 和用人经理校准',
    },
    dimensions: [{
      name: '业务判断',
      weight: 30,
      method: '案例面试',
      anchors: { 1: '没有相关案例', 3: '能完成基本判断', 5: '能验证复杂取舍' },
    }],
  });

  assert.equal(result.decisionRule.status, '待确认');
  assert.deepEqual(result.decisionRule.items, [
    { label: '评分方法', value: '各维度按 1-5 分评分' },
    { label: '通过门槛', value: '加权总分不低于 3.5' },
    { label: '校准说明', value: '由 HR 和用人经理校准' },
  ]);
  assert.deepEqual(result.dimensions[0].anchors, [
    '1 分：没有相关案例',
    '3 分：能完成基本判断',
    '5 分：能验证复杂取舍',
  ]);
});

test('兼容历史字符串规则，并忽略无法渲染的嵌套对象', () => {
  const legacy = normalizeAssessmentContent({
    decision_rule: '任一核心维度低于 3 分不建议录用',
    dimensions: [{ name: { invalid: true }, anchors: [{ invalid: true }, '有效锚点'] }],
  });

  assert.equal(legacy.decisionRule.summary, '任一核心维度低于 3 分不建议录用');
  assert.equal(legacy.dimensions[0].name, '评估维度 1');
  assert.deepEqual(legacy.dimensions[0].anchors, ['有效锚点']);
});
