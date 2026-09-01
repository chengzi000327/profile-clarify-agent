import assert from 'node:assert/strict';
import test from 'node:test';
import { startAgentRunStream } from './useAgentRun.js';

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

function createHarness() {
  const events = [];
  const statuses = [];
  const refreshedRoles = [];
  const refreshedConversations = [];
  const errors = [];
  let handlers;
  let stopped = false;
  const stop = startAgentRunStream({
    streamAgentRun: (streamUrl, onEvent, onDisconnect) => {
      handlers = { streamUrl, onEvent, onDisconnect };
      return () => { stopped = true; };
    },
    streamUrl: '/runs/run-1/events',
    roleId: 'role-1',
    appendEvent: (event) => events.push(event),
    setStatus: (status) => statuses.push(status),
    refreshRole: async (roleId) => refreshedRoles.push(roleId),
    refreshConversation: async (roleId) => refreshedConversations.push(roleId),
    reportError: (message) => errors.push(message),
  });
  return {
    events,
    statuses,
    refreshedRoles,
    refreshedConversations,
    errors,
    handlers,
    stop,
    isStopped: () => stopped,
  };
}

test('连接完成后刷新当前岗位与对话，并可关闭底层流', async () => {
  const harness = createHarness();
  assert.equal(harness.handlers.streamUrl, '/runs/run-1/events');
  harness.handlers.onEvent({ type: 'run.completed', payload: {} });
  await flushPromises();
  assert.deepEqual(harness.statuses, ['completed']);
  assert.deepEqual(harness.refreshedRoles, ['role-1']);
  assert.deepEqual(harness.refreshedConversations, ['role-1']);
  assert.equal(harness.events.length, 1);
  harness.stop();
  assert.equal(harness.isStopped(), true);
});

test('产物、对话与失败事件只触发对应刷新和错误状态', async () => {
  const harness = createHarness();
  harness.handlers.onEvent({ type: 'artifact.updated', payload: { artifact_type: 'ROLE_PROFILE' } });
  harness.handlers.onEvent({ type: 'assistant.completed', payload: {} });
  harness.handlers.onEvent({ type: 'run.failed', payload: { message: '模型超时' } });
  await flushPromises();
  assert.deepEqual(harness.refreshedRoles, ['role-1']);
  assert.deepEqual(harness.refreshedConversations, ['role-1', 'role-1']);
  assert.deepEqual(harness.statuses, ['failed']);
  assert.deepEqual(harness.errors, ['模型超时']);
});

test('仅运行中的连接断开时进入重连状态', () => {
  const harness = createHarness();
  harness.handlers.onDisconnect();
  assert.equal(typeof harness.statuses[0], 'function');
  assert.equal(harness.statuses[0]('running'), 'reconnecting');
  assert.equal(harness.statuses[0]('completed'), 'completed');
});
