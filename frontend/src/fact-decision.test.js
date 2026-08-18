import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canDecideFact,
  factForMessage,
  factStatusLabel,
  pendingFacts,
} from './fact-decision.js';

const fact = (id, status, overrides = {}) => ({
  id,
  status,
  category: 'SUCCESS_CRITERION',
  statement: `${id} statement`,
  source_run_id: 'run-source',
  source_message_id: 'message-source',
  updated_at: '2026-08-18T01:00:00.000Z',
  supersedes_fact_id: null,
  ...overrides,
});

test('HR 只读，经理和管理员的有效经理角色可以处理待确认事实', () => {
  assert.equal(canDecideFact('HR', fact('draft', 'DRAFT')), false);
  assert.equal(canDecideFact('MANAGER', fact('draft', 'DRAFT')), true);
  assert.equal(canDecideFact('MANAGER', fact('conflicted', 'CONFLICTED')), true);
  assert.equal(canDecideFact('MANAGER', fact('stale', 'STALE')), false);
  assert.equal(canDecideFact('ADMIN', fact('draft', 'DRAFT')), false);
});

test('只有 DRAFT 和 CONFLICTED 计入待处理数量', () => {
  const facts = [
    fact('draft', 'DRAFT'),
    fact('conflicted', 'CONFLICTED'),
    fact('confirmed', 'CONFIRMED'),
    fact('stale', 'STALE'),
  ];
  assert.deepEqual(pendingFacts(facts).map((item) => item.id), ['draft', 'conflicted']);
  assert.equal(factStatusLabel.CONFIRMED, '已生效');
});

test('消息始终解析到同一来源链上最新可操作的事实版本', () => {
  const facts = [
    fact('fact-original', 'CONFIRMED', { updated_at: '2026-08-18T01:00:00.000Z' }),
    fact('fact-stale-draft', 'STALE', {
      supersedes_fact_id: 'fact-original',
      updated_at: '2026-08-18T02:00:00.000Z',
    }),
    fact('fact-newest', 'DRAFT', {
      supersedes_fact_id: 'fact-stale-draft',
      updated_at: '2026-08-18T03:00:00.000Z',
    }),
  ];
  assert.equal(factForMessage(facts, 'fact-original')?.id, 'fact-newest');
});

test('没有来源链的历史事实仍回到消息直接引用的事实', () => {
  const historical = fact('historical', 'CONFIRMED', {
    source_run_id: null,
    source_message_id: null,
  });
  assert.equal(factForMessage([historical], historical.id)?.id, historical.id);
  assert.equal(factForMessage([historical], 'missing'), null);
});
