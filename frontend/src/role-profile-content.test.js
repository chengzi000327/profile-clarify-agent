import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRoleProfileContent } from './role-profile-content.js';

test('normalizes the structured role profile returned by production', () => {
  const result = normalizeRoleProfileContent({
    mission: '建立企业客户端统一体验。',
    hiring_reason: {
      business_change: '客户端进入规模化阶段',
      organization_gap: '缺少统一体验负责人',
      conclusion: '新增客户端产品经理',
      no_hire_impact: '版本继续碎片化',
    },
    success_outcomes: [{ id: 'O-01', horizon: '90 天', title: '完成诊断', definition: '形成基线', measures: ['覆盖三端'] }],
    work_scenarios: [{ id: 'W-01', title: '跨端诊断', description: '梳理核心链路', outputs: ['诊断报告'] }],
    requirements: [{ id: 'R-01', name: '跨端产品能力', priority: 'MUST_HAVE', strong_evidence: ['主导过多端统一项目'] }],
    boundaries: {
      owns: ['体验标准'],
      does_not_own: ['客户端研发排期'],
      decision_rights: '可决策体验规范',
      collaboration_and_resources: '与三端研发协作',
    },
  });

  assert.equal(result.hiringReason.conclusion, '新增客户端产品经理');
  assert.equal(result.outcomes[0].detail, '形成基线');
  assert.deepEqual(result.work[0].outputs, ['诊断报告']);
  assert.deepEqual(result.requirements[0].evidence, ['主导过多端统一项目']);
  assert.deepEqual(result.boundaryGroups.map((group) => group.label), ['负责', '不负责', '决策权限', '协作与资源']);
});

test('keeps legacy arrays and never exposes nested objects to React', () => {
  const result = normalizeRoleProfileContent({
    hiring_reason: '补齐产品负责人',
    outcomes: ['完成首轮验证'],
    responsibilities: ['负责产品规划', { title: '推动交付', description: { unsafe: true } }],
    capabilities: [{ name: '产品判断', evidence: '有完整案例' }],
    boundaries: ['负责产品方向', { unsafe: true }],
  }, { business_change: '业务增长' });

  assert.equal(result.hiringReason.businessChange, '业务增长');
  assert.equal(result.work[1].detail, '');
  assert.deepEqual(result.boundaryGroups[0].items, ['负责产品方向']);
  assert.equal(result.requirements[0].evidence[0], '有完整案例');
});
