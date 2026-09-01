import assert from 'node:assert/strict';
import test from 'node:test';
import {
  actorRoleLabel,
  displayInitial,
  roleBasicInfo,
  toRoleCard,
} from './presentation.js';

test('maps role session state into the existing workbench card contract', () => {
  const state = {
    id: 'role-1',
    title: '平台产品经理',
    department: '产品平台部',
    stage: 'PROFILE_CONFIRMED',
    hc_status: 'APPROVED',
    updated_at: '2026-08-18T08:00:00.000Z',
    latest_artifacts: { ROLE_PROFILE: { version: 3 } },
  };

  const card = toRoleCard(state);

  assert.equal(card.id, 'role-1');
  assert.equal(card.stage, '画像已确认');
  assert.equal(card.stageTone, 'confirmed');
  assert.equal(card.meta, 'HC 已审批');
  assert.equal(card.version, '画像 v3');
  assert.equal(card.apiState, state);
});

test('keeps unknown stages visible instead of hiding the server value', () => {
  const card = toRoleCard({
    id: 'role-2', title: '测试岗位', department: '测试部', stage: 'NEW_STAGE',
    hc_status: 'PENDING', updated_at: '2026-08-18T08:00:00.000Z', latest_artifacts: {},
  });

  assert.equal(card.stage, 'NEW_STAGE');
  assert.equal(card.stageTone, 'active');
  assert.equal(card.meta, 'HC 待审批');
  assert.equal(card.version, '未生成画像');
});

test('preserves manager salary masking and HR salary visibility', () => {
  const state = {
    department: '产品平台部',
    hc_context: {
      status: 'APPROVED',
      job_basics: {
        recruitment_type: 'NEW_HEADCOUNT', headcount: 1, level: 'P7',
        reporting_line: '产品副总裁', locations: ['上海'], employment_type: '全职',
        salary_range: '40k-60k',
      },
    },
  };

  const managerSalary = roleBasicInfo(state, 'manager').find((item) => item.label === '薪酬范围');
  const hrSalary = roleBasicInfo(state, 'hr').find((item) => item.label === '薪酬范围');

  assert.deepEqual(managerSalary, { label: '薪酬范围', value: '按权限可见', restricted: true });
  assert.deepEqual(hrSalary, { label: '薪酬范围', value: '40k-60k', restricted: false });
});

test('keeps role labels and avatar fallbacks stable', () => {
  assert.equal(actorRoleLabel.ADMIN, '企业管理员 · 最高权限');
  assert.equal(displayInitial(' 林夏 ', 'HR'), '林');
  assert.equal(displayInitial('', 'HR'), 'HR');
  assert.equal(displayInitial(null, 'MANAGER'), '用');
});
