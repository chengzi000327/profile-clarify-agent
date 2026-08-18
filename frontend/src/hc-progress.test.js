import test from 'node:test';
import assert from 'node:assert/strict';
import { hcProgress } from './hc-progress.js';

const hc = ({ task = null, delivery = null, roleStage = null, clarification = 'IN_PROGRESS' }) => ({
  clarification_status: clarification,
  role_stage: roleStage,
  role_session_id: task ? 'role-demo' : null,
  clarification_task: task ? { status: task } : null,
  notification_delivery: delivery ? { status: delivery } : null,
});

test('HC 小状态只显示待澄清、已提醒、进行中，完成后复用画像状态', () => {
  assert.equal(hcProgress(hc({ task: 'OPEN', delivery: 'PENDING' })).status, '待澄清');
  assert.equal(hcProgress(hc({ task: 'OPEN', delivery: 'SENT' })).status, '已提醒');
  assert.equal(hcProgress(hc({ task: 'IN_PROGRESS', delivery: 'SENT' })).status, '进行中');
  assert.equal(hcProgress(hc({ task: 'COMPLETED', roleStage: 'PROFILE_CONFIRMED', clarification: 'PROFILE_READY' })).status, '画像已确认');
});

test('没有新闭环字段的历史 HC 仍使用兼容映射', () => {
  assert.equal(hcProgress(hc({ clarification: 'PROFILE_READY', roleStage: 'PROFILE_DRAFT' })).status, '画像待确认');
  assert.equal(hcProgress({ clarification_status: 'IN_PROGRESS', role_session_id: 'legacy-role' }).status, '进行中');
  assert.equal(hcProgress({ clarification_status: 'NOT_STARTED', role_session_id: null }).status, '待澄清');
});
