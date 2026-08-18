import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePublicJDContent } from './public-jd-content.js';

const state = {
  title: '客户端工程师', department: '终端研发部',
  hc_context: { job_basics: { locations: ['北京', '上海'], employment_type: '全职', level: 'P7-P8', reporting_line: '终端研发负责人' } },
};
const fallbacks = {
  about: '待补充岗位说明', responsibilities: ['待补充职责'],
  capabilities: [{ id: 'fallback', title: '待补充要求', description: '' }],
};

test('maps the canonical public JD contract into the four frontend sections', () => {
  const result = normalizePublicJDContent({
    title_and_basics: { title: '客户端工程师', location: '北京 / 上海', employment_type: '全职', reporting_line: '终端研发负责人' },
    about_the_role: '负责客户端架构与稳定性。',
    what_you_will_do: ['建设核心架构'],
    what_we_look_for: ['具备复杂客户端工程经验'],
  }, state, fallbacks);

  assert.equal(result.about, '负责客户端架构与稳定性。');
  assert.deepEqual(result.responsibilities, ['建设核心架构']);
  assert.equal(result.capabilities[0].title, '具备复杂客户端工程经验');
});

test('renders historical object items safely instead of crashing the JD tab', () => {
  const result = normalizePublicJDContent({
    what_you_will_do: [{ description: '建设核心架构' }],
    what_we_look_for: [{ id: 'C-01', name: '稳定性治理', evidence: { statement: '建立监控体系' } }],
  }, state, fallbacks);

  assert.deepEqual(result.responsibilities, ['建设核心架构']);
  assert.equal(result.capabilities[0].title, '稳定性治理');
  assert.equal(result.capabilities[0].description, '建立监控体系');
});
