import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRecruitingContent } from './recruiting-content.js';
import { normalizePublicJDContent } from './public-jd-content.js';

test('normalizes structured HR recruiting content without rendering objects', () => {
  const result = normalizeRecruitingContent({
    candidate_definition: '寻找能建设跨端质量体系的高级工程师',
    sourcing: {
      target_types: [{ code: 'A', title: '客户端架构师', why: '经验匹配', check: '架构落地' }],
      titles: ['客户端架构师'],
      keywords: ['稳定性'],
      query: '客户端 AND 稳定性',
      non_target: ['只做业务页面'],
    },
    resume_screening: {
      decision: '两个核心证据方可推进',
      core_signals: [{ id: 'S-1', title: '架构能力', look_for: ['跨端案例'], not_enough: '只有概念' }],
      rules: [{ label: '推进', condition: '证据充分', tone: 'go' }],
    },
    phone_screen: [{ question: '讲一个架构案例', listen_for: '明确取舍', risk: '只有参与经历' }],
  }, { organization_gap: '缺少跨端架构负责人' }, [{
    candidate_ref: 'anonymous-1',
    channel: '人才库',
    evidence: [{ criterion: '跨端案例', signal: 'STRONG' }],
    bottlenecks: [],
  }]);

  assert.equal(result.sourcingBrief.targetTypes[0].title, '客户端架构师');
  assert.deepEqual(result.resumeScreening.coreSignals[0].lookFor, ['跨端案例']);
  assert.equal(result.candidateCalibration.samples[0].agentDecision, '建议推进');
});

test('drops malformed HR recruiting nested values instead of exposing them to React', () => {
  const result = normalizeRecruitingContent({
    candidate_definition: { unsafe: true },
    sourcing: { target_types: [{ title: { unsafe: true } }], titles: [{ unsafe: true }] },
    resume_screening: { core_signals: [{ title: '判断信号', look_for: [{ unsafe: true }] }] },
    phone_screen: [{ question: '问题', risk: { unsafe: true } }],
  }, {}, [{ candidate_ref: 'c-1', evidence: { unsafe: true }, bottlenecks: { unsafe: true } }]);

  assert.match(result.candidateDefinition, /缺少一句话目标候选人/);
  assert.deepEqual(result.sourcingBrief.titles, []);
  assert.deepEqual(result.resumeScreening.coreSignals[0].lookFor, []);
  assert.equal(result.candidateCalibration.samples[0].gap, '暂无重复卡点');
});

test('normalizes both public JD strings and structured legacy items', () => {
  const result = normalizePublicJDContent({
    title_and_basics: { title: '客户端工程师', location: ['北京', '上海'], employment_type: '全职', reporting_line: '终端研发负责人' },
    about_the_role: '建设客户端基础能力。',
    what_you_will_do: ['统一跨端架构', { title: '建设质量门禁' }],
    what_we_look_for: ['客户端架构经验', { name: '稳定性建设', evidence: '主导过质量体系' }],
  }, { department: '终端研发部', hc_context: { job_basics: { level: 'P7-P8' } } }, {
    about: '默认岗位说明',
    responsibilities: ['默认职责'],
    capabilities: [{ id: 'fallback', title: '默认能力', description: '' }],
  });

  assert.equal(result.location, '北京 / 上海');
  assert.deepEqual(result.responsibilities, ['统一跨端架构', '建设质量门禁']);
  assert.equal(result.capabilities[1].description, '主导过质量体系');
});
