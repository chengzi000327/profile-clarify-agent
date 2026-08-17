import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeRoleProfileContent,
  roleProfileAction,
  roleProfileRequirementInstanceKey,
} from './profile-content.js';

const validJobDescription = {
  hiring_background: {
    business_change: '业务从项目交付转向平台化。',
    organization_gap: '缺少统一定义产品边界的岗位。',
    hiring_conclusion: '招聘一名平台产品经理。',
    no_hire_impact: '重复建设继续增加。',
    evidence_refs: ['HC-001'],
  },
  job_purpose: {
    statement: '把共性需求沉淀为标准产品能力。',
    evidence_refs: ['F-001'],
  },
  key_accountabilities: [{
    id: 'KRA-01',
    name: '平台产品规划',
    responsibility: '持续识别共性需求并定义产品边界。',
    core_outputs: ['产品路线图'],
    success_outcome_refs: ['O-01'],
    evidence_refs: ['F-002'],
  }],
  success_criteria: [
    {
      id: 'O-01', horizon: '3个月', title: '形成产品路线图',
      definition: '完成现状诊断并明确优先级。', measures: ['路线图通过评审'],
      status: '待确认', evidence_refs: ['F-003'],
    },
    {
      id: 'O-02', horizon: '6个月', title: '验证平台能力',
      definition: '完成重点场景验证并形成复盘。', measures: ['重点场景完成验收'],
      status: '待确认', evidence_refs: ['F-003'],
    },
    {
      id: 'O-03', horizon: '12个月', title: '形成规模化复用',
      definition: '平台能力在多个业务场景稳定复用。', measures: ['复用范围达到年度目标'],
      status: '待确认', evidence_refs: ['F-003'],
    },
  ],
  work_scenarios: [{
    id: 'S-01',
    title: '共性需求抽象',
    frequency: '每周',
    trigger: '多个客户提出相似需求',
    actions: '识别共性并定义边界',
    output: '机会清单',
    challenge: '短期交付与长期复用冲突',
    stakeholders: ['研发', '交付'],
    success_outcome_refs: ['O-01'],
    evidence_refs: ['F-004'],
  }],
  boundaries: {
    owns: ['产品边界与路线图'],
    does_not_own: ['单客户项目交付'],
    decision_rights: ['提出产品优先级取舍'],
    key_collaborations: ['研发', '交付'],
    available_resources: ['客户反馈与项目复盘'],
    evidence_refs: ['F-005'],
  },
};

const traceableTalentRequirement = {
  id: 'Q-01',
  name: '复杂项目抽象能力',
  definition: '能从多个交付项目中识别共性并形成平台方案。',
  maps_to: ['KRA-01'],
  observable_evidence: ['主导过跨项目复盘并产出复用方案'],
  evidence_refs: ['F-006'],
  status: '推断',
};

const validTalentDraftContent = {
  schema_version: '2',
  stage: 'TALENT_PROFILE_DRAFT',
  job_description: validJobDescription,
  talent_profile: {
    target_talent_profile: {
      core_definition: '能把复杂项目经验迁移为平台能力的人。',
      transferable_backgrounds: ['平台产品', '复杂项目交付'],
      fit_signals: ['能解释取舍和复用结果'],
      non_target_and_misjudgments: ['只做单点需求收集的人'],
      attraction_factors: ['可推动平台能力规模化'],
      evidence_refs: ['F-001', 'F-006'],
    },
    qualifications: {
      hard_qualifications: [],
      necessary_experience: [],
      role_conditions: [],
      must_have: [traceableTalentRequirement],
      preferred: [],
      alternatives: [],
    },
    competency_model: {
      knowledge: [],
      skills: [{ ...traceableTalentRequirement, id: 'C-01', name: '平台规划技能' }],
      behavioral_competencies: [],
      values_and_work_style: [],
      career_motivation: [],
    },
  },
};

test('normalizes staged talent profile in target, qualifications, and competency order', () => {
  const result = normalizeRoleProfileContent(validTalentDraftContent);

  assert.equal(result.internalStage, 'TALENT_PROFILE_DRAFT');
  assert.deepEqual(Object.keys(result.talentProfile), ['target', 'qualifications', 'competencyModel']);
  assert.equal(result.talentProfile.target.coreDefinition, '能把复杂项目经验迁移为平台能力的人。');
  assert.deepEqual(result.talentProfile.qualifications.mustHave[0].mapsTo, ['KRA-01']);
  assert.deepEqual(result.talentProfile.qualifications.mustHave[0].observableEvidence, ['主导过跨项目复盘并产出复用方案']);
  assert.deepEqual(result.talentProfile.qualifications.mustHave[0].evidenceRefs, ['F-006']);
  assert.equal(result.talentProfile.competencyModel.skills[0].status, '推断');
  assert.equal(Object.hasOwn(result.talentProfile.qualifications.mustHave[0], 'assessment'), false);
});

test('offers talent-profile derivation from a confirmed job description', () => {
  assert.deepEqual(roleProfileAction({
    status: 'CONFIRMED',
    content: { schema_version: '2', stage: 'JOB_DESCRIPTION_CONFIRMED' },
  }), { kind: 'generate', label: '推导人才画像' });
  assert.deepEqual(roleProfileAction({
    status: 'DRAFT',
    content: { schema_version: '2', stage: 'TALENT_PROFILE_DRAFT' },
  }), { kind: 'confirm', label: '确认完整岗位画像' });
  assert.deepEqual(roleProfileAction({
    status: 'CONFIRMED',
    content: { schema_version: '2', stage: 'TALENT_PROFILE_DRAFT' },
  }), { kind: 'generate', label: '生成新版本' });
});

test('creates stable distinct requirement instance keys for duplicate ids in one group', () => {
  const duplicateRequirement = { id: 'Q-01' };
  const first = roleProfileRequirementInstanceKey('must-have', duplicateRequirement, 0);
  const second = roleProfileRequirementInstanceKey('must-have', duplicateRequirement, 1);

  assert.notEqual(first, second);
  assert.equal(first, roleProfileRequirementInstanceKey('must-have', duplicateRequirement, 0));
});

test('normalizes stable distinct instance keys for historical duplicate job-description ids', () => {
  const result = normalizeRoleProfileContent({
    schema_version: '2',
    stage: 'JOB_DESCRIPTION_DRAFT',
    job_description: {
      ...validJobDescription,
      key_accountabilities: [
        validJobDescription.key_accountabilities[0],
        validJobDescription.key_accountabilities[0],
      ],
      success_criteria: [
        validJobDescription.success_criteria[0],
        validJobDescription.success_criteria[0],
      ],
      work_scenarios: [
        validJobDescription.work_scenarios[0],
        validJobDescription.work_scenarios[0],
      ],
    },
  });

  assert.notEqual(result.jobDescription.accountabilities[0].instanceKey, result.jobDescription.accountabilities[1].instanceKey);
  assert.notEqual(result.jobDescription.successCriteria[0].instanceKey, result.jobDescription.successCriteria[1].instanceKey);
  assert.notEqual(result.jobDescription.workScenarios[0].instanceKey, result.jobDescription.workScenarios[1].instanceKey);
});

test('normalizes staged V2 job description without fabricating talent content', () => {
  const result = normalizeRoleProfileContent({
    schema_version: '2',
    stage: 'JOB_DESCRIPTION_DRAFT',
    job_description: validJobDescription,
  });

  assert.equal(result.internalStage, 'JOB_DESCRIPTION_DRAFT');
  assert.equal(result.jobDescription.jobPurpose.statement, validJobDescription.job_purpose.statement);
  assert.equal(result.jobDescription.accountabilities[0].name, '平台产品规划');
  assert.equal(result.jobDescription.successCriteria[0].horizon, '3个月');
  assert.deepEqual(result.talentProfile, null);
  assert.equal(Object.hasOwn(result.jobDescription, 'jobTitle'), false);
});

test('converts staged V2 display values to text before rendering', () => {
  const result = normalizeRoleProfileContent({
    schema_version: '2',
    stage: 'JOB_DESCRIPTION_DRAFT',
    job_description: {
      ...validJobDescription,
      job_purpose: { statement: { text: '建设稳定的平台能力。' }, evidence_refs: ['F-001'] },
      key_accountabilities: [{
        ...validJobDescription.key_accountabilities[0],
        name: { title: '平台产品规划' },
        responsibility: { description: '持续沉淀产品能力。' },
      }],
    },
  });

  assert.equal(result.jobDescription.jobPurpose.statement, '建设稳定的平台能力。');
  assert.equal(result.jobDescription.accountabilities[0].name, '平台产品规划');
  assert.equal(result.jobDescription.accountabilities[0].responsibility, '持续沉淀产品能力。');
});

test('normalizes the current generated role-profile contract', () => {
  const result = normalizeRoleProfileContent({
    mission: { statement: '把定制需求沉淀为标准产品。' },
    work: [{ id: 'W-01', title: '客户验证', description: '完成三个客户场景验证。', deliverables: ['验证报告'] }],
    requirements: [{ name: '产品抽象', level: 'EXPERT', strong_evidence: ['形成可复用模块'] }],
    boundaries: {
      owns: [{ statement: '负责产品边界定义。' }],
      does_not_own: [{ statement: '不负责单客户项目交付。' }],
    },
  });

  assert.equal(result.mission, '把定制需求沉淀为标准产品。');
  assert.equal(result.outcomes[0].horizon, 'W-01');
  assert.equal(result.outcomes[0].result, '完成三个客户场景验证。');
  assert.equal(result.outcomes[0].evidence, '验证报告');
  assert.equal(result.capabilities[0].name, '产品抽象');
  assert.equal(result.capabilities[0].level, 'EXPERT');
  assert.equal(result.capabilities[0].strongEvidence, '形成可复用模块');
  assert.deepEqual(result.boundaries, ['负责：负责产品边界定义。', '不负责：不负责单客户项目交付。']);
  assert.deepEqual(result.boundaryGroups.owns, ['负责产品边界定义。']);
});

test('keeps the legacy seeded role-profile contract compatible', () => {
  const result = normalizeRoleProfileContent({
    mission: '连接商业目标与产品交付。',
    outcomes: [{ horizon: '90 天', result: '完成路线图' }],
    responsibilities: ['规划路线图'],
    capabilities: [{ name: '业务判断', level: '高级', evidence: '解释关键取舍' }],
    boundaries: ['负责路线图'],
  });

  assert.equal(result.mission, '连接商业目标与产品交付。');
  assert.equal(result.outcomes[0].result, '完成路线图');
  assert.deepEqual(result.responsibilities, ['规划路线图']);
  assert.deepEqual(result.boundaries, ['负责路线图']);
});

test('keeps the deep profile decision and evidence chain', () => {
  const result = normalizeRoleProfileContent({
    hiring_reason: {
      conclusion: '新增平台产品经理。',
      no_hire_impact: '重复建设继续增加。',
      evidence_refs: ['E-01'],
    },
    mission: '把多客户需求沉淀为标准能力。',
    success_outcomes: [{
      id: 'O-01', horizon: '90 天', title: '形成产品路线',
      definition: '完成项目复盘并识别三项共性机会。',
      measures: ['覆盖 20 个项目'], status: '数字待确认', evidence_refs: ['E-04'],
    }],
    work_scenarios: [{
      id: 'T-01', title: '共性需求抽象', trigger: '多客户提出相似需求',
      actions: '识别共性并定义边界', output: '机会清单', outcome_refs: ['O-01'],
    }],
    requirements: [{
      id: 'C-01', priority: 'Must-have', name: '复杂问题抽象',
      rationale: '支撑 O-01', maps_to: ['T-01'], strong_evidence: ['形成标准模块'],
      substitute_evidence: ['平台产品经历'], risk_signals: ['只汇总需求'],
    }],
    boundaries: {
      owns: ['产品边界'], does_not_own: ['单客户交付'],
      decision_rights: '提出优先级取舍', collaboration_and_resources: '研发与交付支持',
    },
  });

  assert.equal(result.recruitment.noHireImpact, '重复建设继续增加。');
  assert.equal(result.outcomes[0].definition, '完成项目复盘并识别三项共性机会。');
  assert.deepEqual(result.scenarios[0].outcomeRefs, ['O-01']);
  assert.equal(result.capabilities[0].substitute, '平台产品经历');
  assert.equal(result.capabilities[0].risk, '只汇总需求');
  assert.equal(result.boundaryGroups.decisionRights, '提出优先级取舍');
});

test('never returns nested objects as React text children for historical profiles', () => {
  const result = normalizeRoleProfileContent({
    mission: { statement: '建设稳定的客户端平台。' },
    success_outcomes: [{ horizon: { value: '90 天' }, definition: { statement: '完成架构诊断。' }, measures: [{ statement: '输出诊断报告' }] }],
    requirements: [{ name: { text: '稳定性治理' }, rationale: { description: '支撑线上质量' }, strong_evidence: [{ statement: '建立监控体系' }] }],
  });

  assert.equal(typeof result.mission, 'string');
  assert.equal(typeof result.outcomes[0].definition, 'string');
  assert.equal(typeof result.outcomes[0].measures[0], 'string');
  assert.equal(typeof result.capabilities[0].name, 'string');
  assert.equal(typeof result.capabilities[0].rationale, 'string');
});
