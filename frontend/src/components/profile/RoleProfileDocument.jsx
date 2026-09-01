import { useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  FileSearch,
  Link2,
  Plus,
  Sparkles,
  Target,
  X,
} from 'lucide-react';
import { evidenceById } from '../../data.js';
import {
  normalizeRoleProfileContent,
  roleProfileRequirementInstanceKey,
  roleProfileViewSections,
} from '../../profile-content.js';

export function RecruitingPortrait({ onOpenEvidence, artifact, roleDetail }) {
  const content = artifact?.content ?? {};
  const hc = roleDetail?.state?.hc_context;
  const sourcing = content.sourcing ?? {};
  const screening = content.resume_screening ?? {};
  const candidates = roleDetail?.candidates ?? [];
  const portrait = {
    approvedContext: {
      coreProblem: hc?.organization_gap ?? 'HC 审批数据中尚未同步组织缺口。',
      evidence: [],
    },
    candidateDefinition: content.candidate_definition ?? '当前招聘画像缺少一句话目标候选人，请生成新版本补齐。',
    sourcingBrief: {
      targetTypes: sourcing.target_types ?? [],
      titles: sourcing.titles ?? [],
      keywords: sourcing.keywords ?? [],
      query: sourcing.query ?? '当前版本未生成检索式',
      nonTarget: sourcing.non_target ?? [],
    },
    resumeScreening: {
      decision: screening.decision ?? '当前版本未生成推进规则',
      coreSignals: (screening.core_signals ?? []).map((signal) => ({
        ...signal,
        lookFor: signal.look_for ?? [],
        notEnough: signal.not_enough ?? '待补充反例',
      })),
      rules: screening.rules ?? [],
    },
    phoneScreen: (content.phone_screen ?? []).map((item) => ({
      ...item,
      listenFor: item.listen_for ?? '',
    })),
    candidateCalibration: {
      source: candidates.length > 0 ? `已导入 ${candidates.length} 份脱敏简历` : '尚未导入首批简历',
      samples: candidates.map((candidate, index) => {
        const strongCount = candidate.evidence.filter((item) => item.signal === 'STRONG').length;
        const missingCount = candidate.evidence.filter((item) => item.signal === 'MISSING').length;
        const decision = strongCount > 0 && missingCount === 0 ? '建议推进' : missingCount > 0 ? '电话验证' : '待校准';
        return {
          id: candidate.candidate_ref,
          name: `匿名候选人 ${index + 1}`,
          currentRole: candidate.channel,
          agentDecision: decision,
          tone: decision === '建议推进' ? 'go' : 'verify',
          evidence: candidate.evidence.map((item) => item.criterion),
          gap: candidate.bottlenecks.join('；') || '暂无重复卡点',
        };
      }),
    },
  };
  const [managerDecisions, setManagerDecisions] = useState({});
  const confirmedCount = Object.keys(managerDecisions).length;

  function setCandidateDecision(candidateId, decision) {
    setManagerDecisions((current) => ({ ...current, [candidateId]: decision }));
  }

  return (
    <article className="profile-document-new recruiting-portrait-card action-portrait">
      <section className="action-portrait-hero">
        <div className="action-hero-heading">
          <div><Target size={15} /><span>今天就按这句话找人</span></div>
          <button type="button"><CheckCircle2 size={12} />已获批业务目标 {hc?.request_id ?? ''}</button>
        </div>
        <h2>{portrait.candidateDefinition}</h2>
        <p><strong>业务要解决：</strong>{portrait.approvedContext.coreProblem}</p>
      </section>

      <section className="action-section sourcing-action-section">
        <ActionSectionHeading number="01" title="先去这些人里找" description="三个优先来源，每一类都给出简历检查点。" />
        <div className="sourcing-action-layout">
          <div className="target-type-grid">
            {portrait.sourcingBrief.targetTypes.map((item) => (
              <div className="target-type-card" key={item.code}>
                <div><span>{item.code}</span><strong>{item.title}</strong></div>
                <p>{item.why}</p>
                <div className="type-check"><FileSearch size={12} /><span><b>简历先看：</b>{item.check}</span></div>
              </div>
            ))}
          </div>
          <aside className="sourcing-console">
            <div className="sourcing-console-heading"><Search size={13} /><strong>人才库检索建议</strong><button>复制检索式</button></div>
            <code>{portrait.sourcingBrief.query}</code>
            <div><span className="console-label">常见职称</span><div className="compact-chips">{portrait.sourcingBrief.titles.map((item) => <span key={item}>{item}</span>)}</div></div>
            <div><span className="console-label">强信号词</span><div className="compact-chips positive">{portrait.sourcingBrief.keywords.map((item) => <span key={item}>{item}</span>)}</div></div>
            <div className="non-target-list"><span className="console-label">看到这些不要被误导</span>{portrait.sourcingBrief.nonTarget.map((item) => <p key={item}><X size={11} />{item}</p>)}</div>
          </aside>
        </div>
      </section>

      <section className="action-section resume-action-section">
        <ActionSectionHeading number="02" title="简历 30 秒判断卡" description="先找可观察证据，不凭岗位名称和同行业标签判断。" />
        <div className="screening-decision-banner"><CircleDot size={13} /><strong>推进规则</strong><span>{portrait.resumeScreening.decision}</span></div>
        <div className="screen-signal-grid">
          {portrait.resumeScreening.coreSignals.map((signal) => (
            <div className={`screen-signal-card ${signal.required ? 'required' : 'differentiator'}`} key={signal.id}>
              <div className="signal-card-title"><span>{signal.id}</span><strong>{signal.title}</strong><em>{signal.required ? '核心证据' : '区分证据'}</em></div>
              <ul>{signal.lookFor.map((item) => <li key={item}><Check size={11} />{item}</li>)}</ul>
              <p><AlertTriangle size={11} />{signal.notEnough}</p>
            </div>
          ))}
        </div>
        <div className="decision-rule-row">
          {portrait.resumeScreening.rules.map((rule) => (
            <div className={rule.tone} key={rule.label}><span>{rule.label}</span><p>{rule.condition}</p></div>
          ))}
        </div>
      </section>

      <section className="action-section phone-action-section">
        <ActionSectionHeading number="03" title="电话初筛就问这 4 个问题" description="每个问题都配有应听到的证据和风险信号。" />
        <div className="phone-screen-table">
          <div className="phone-screen-head"><span>直接问</span><span>重点听</span><span>风险信号</span></div>
          {portrait.phoneScreen.map((item, index) => (
            <div className="phone-screen-row" key={item.question}>
              <div><span>{index + 1}</span><strong>{item.question}</strong></div>
              <p>{item.listenFor}</p>
              <p className="risk"><AlertTriangle size={11} />{item.risk}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="action-section calibration-action-section">
        <div className="calibration-action-heading">
          <ActionSectionHeading number="04" title="用首批候选人校准画像" description="用人经理只做推进判断，Agent 负责总结隐藏要求并形成下一版。" />
          <div><span className="demo-data-label">{portrait.candidateCalibration.source}</span><button className="quiet-button"><Plus size={13} />导入简历</button></div>
        </div>
        <div className="candidate-calibration-table">
          <div className="candidate-table-head"><span>候选人</span><span>Agent 初判</span><span>已识别证据</span><span>尚需确认</span><span>用人经理判断</span></div>
          {portrait.candidateCalibration.samples.map((candidate) => {
            const managerDecision = managerDecisions[candidate.id];
            return (
              <div className="candidate-table-row" key={candidate.id}>
                <div><strong>{candidate.name}</strong><small>{candidate.id} · {candidate.currentRole}</small></div>
                <span className={`candidate-decision ${candidate.tone}`}>{candidate.agentDecision}</span>
                <div className="evidence-tags">{candidate.evidence.map((item) => <span key={item}>{item}</span>)}</div>
                <p>{candidate.gap}</p>
                <div className="manager-decision-buttons">
                  <button className={managerDecision === '推进' ? 'selected go' : ''} onClick={() => setCandidateDecision(candidate.id, '推进')}><Check size={11} />推进</button>
                  <button className={managerDecision === '不推进' ? 'selected stop' : ''} onClick={() => setCandidateDecision(candidate.id, '不推进')}><X size={11} />不推进</button>
                </div>
              </div>
            );
          })}
          {portrait.candidateCalibration.samples.length === 0 && (
            <div className="candidate-calibration-empty"><FileSearch size={17} /><span>导入首批脱敏简历后，这里会显示证据、缺口和校准判断。</span></div>
          )}
        </div>
        <div className="calibration-action-footer">
          <div><Sparkles size={14} /><span>已完成 {confirmedCount} / {portrait.candidateCalibration.samples.length} 个判断</span></div>
          <p>{confirmedCount === 0 ? '完成首批判断后，Agent 将识别隐藏偏好、画像宽窄和需要调整的筛选规则。' : `已记录 ${confirmedCount} 个真实判断；继续完成样本后生成画像校准建议。`}</p>
          <button disabled={confirmedCount < portrait.candidateCalibration.samples.length}>生成校准建议<ChevronRight size={13} /></button>
        </div>
      </section>
    </article>
  );
}

function ActionSectionHeading({ number, title, description }) {
  return (
    <div className="action-section-heading">
      <span>{number}</span>
      <div><h2>{title}</h2><p>{description}</p></div>
    </div>
  );
}

function ArtifactEvidenceRefs({ refs = [], onOpenEvidence }) {
  if (!refs.length) return null;
  return (
    <div className="generated-evidence-refs" aria-label="证据来源">
      <span>依据</span>
      {refs.map((ref) => evidenceById[ref] && onOpenEvidence
        ? <button type="button" key={ref} onClick={() => onOpenEvidence(ref)}>{ref}<Link2 size={10} /></button>
        : <em key={ref}>{ref}</em>)}
    </div>
  );
}

function TalentRequirementGroup({ title, items, detailKeyPrefix, onOpenEvidence, isDetailOpen, onDetailToggle }) {
  if (!items.length) return null;
  return (
    <div className="generated-requirement-group">
      <h4>{title}</h4>
      <div className="generated-requirement-list">
        {items.map((item, index) => {
          const instanceKey = roleProfileRequirementInstanceKey(detailKeyPrefix, item, index);
          return (
            <details
              key={instanceKey}
              open={isDetailOpen(instanceKey, index === 0)}
              onToggle={onDetailToggle(instanceKey)}
            >
              <summary>
                <span className="must">{item.status}</span>
                <strong>{item.id} · {item.name}</strong>
                {item.mapsTo.length > 0 && <em>{item.mapsTo.join(' · ')}</em>}
                <ChevronDown size={15} />
              </summary>
              <div className="generated-requirement-detail">
                <DefinitionItem label="要求定义" value={item.definition} />
                <DefinitionItem label="关联岗位依据" value={item.mapsTo.join('；')} />
                <DefinitionItem label="可观察证据" value={item.observableEvidence.join('；')} tone="positive" />
                <DefinitionItem label="状态" value={item.status} />
                <ArtifactEvidenceRefs refs={item.evidenceRefs} onOpenEvidence={onOpenEvidence} />
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

export function GeneratedProfileBasis({ artifact, state, onOpenEvidence, view = 'jobDescription' }) {
  const content = artifact?.content ?? {};
  const hc = state?.hc_context;
  const profile = normalizeRoleProfileContent(content, hc);
  const boundary = profile.boundaryGroups;
  const [stagedDetailOpen, setStagedDetailOpen] = useState({});
  const isStagedDetailOpen = (key, initiallyOpen) => stagedDetailOpen[key] ?? initiallyOpen;
  const rememberStagedDetailToggle = (key) => (event) => {
    const isOpen = event.currentTarget.open;
    setStagedDetailOpen((current) => ({ ...current, [key]: isOpen }));
  };
  const approvedFact = `${({
    NEW_HEADCOUNT: '新增正式编制',
    REPLACEMENT: '人员替换',
    ATTRITION_REPLACEMENT: '离职补充',
    PERFORMANCE_REPLACEMENT: '汰换补充',
    ORGANIZATION_ADJUSTMENT: '组织调整',
    OTHER: '其他补充',
  })[hc?.job_basics?.recruitment_type] ?? '已审批编制'} ${hc?.job_basics?.headcount ?? 1} 人`;
  if (profile.schemaVersion === '2' && profile.jobDescription) {
    const jobDescription = profile.jobDescription;
    const jobSections = roleProfileViewSections.jobDescription;
    const talentSections = roleProfileViewSections.talentProfile;
    const hasTalentProfile = profile.talentProfile
      && (profile.internalStage === 'TALENT_PROFILE_DRAFT' || artifact?.status === 'CONFIRMED');
    if (view === 'talentProfile') {
      if (!hasTalentProfile) {
        const jobDescriptionConfirmed = profile.internalStage === 'JOB_DESCRIPTION_CONFIRMED';
        return (
          <div className="artifact-empty-state">
            <span><FileSearch size={22} /></span>
            <strong>目标人才画像尚未生成</strong>
            <p>{jobDescriptionConfirmed
              ? '岗位说明已锁定，可以点击页面右上角“推导人才画像”。'
              : '确认岗位说明后，才能推导目标人才画像。'}</p>
          </div>
        );
      }
      return (
        <article className="generated-artifact-document role-profile-artifact">
          <section className="generated-section">
            <header><span>{talentSections[0].number}</span><div><h3>{talentSections[0].title}</h3><p>先明确目标人群、可迁移背景、匹配信号与不适配情形。</p></div></header>
            <DefinitionItem label="一句话定义" value={profile.talentProfile.target.coreDefinition} />
            <DefinitionItem label="可迁移背景" value={profile.talentProfile.target.transferableBackgrounds.join('；')} />
            <DefinitionItem label="匹配信号" value={profile.talentProfile.target.fitSignals.join('；')} tone="positive" />
            <DefinitionItem label="非目标与常见误判" value={profile.talentProfile.target.nonTargets.join('；')} />
            <DefinitionItem label="吸引因素" value={profile.talentProfile.target.attractionFactors.join('；')} />
            <ArtifactEvidenceRefs refs={profile.talentProfile.target.evidenceRefs} onOpenEvidence={onOpenEvidence} />
          </section>
          <section className="generated-section">
            <header><span>{talentSections[1].number}</span><div><h3>{talentSections[1].title}</h3><p>按资格、经验、岗位条件和可替代路径呈现可追溯要求。</p></div></header>
            <TalentRequirementGroup title="硬性资格" items={profile.talentProfile.qualifications.hardQualifications} detailKeyPrefix="hard-qualification" onOpenEvidence={onOpenEvidence} isDetailOpen={isStagedDetailOpen} onDetailToggle={rememberStagedDetailToggle} />
            <TalentRequirementGroup title="必要经验" items={profile.talentProfile.qualifications.necessaryExperience} detailKeyPrefix="necessary-experience" onOpenEvidence={onOpenEvidence} isDetailOpen={isStagedDetailOpen} onDetailToggle={rememberStagedDetailToggle} />
            <TalentRequirementGroup title="岗位条件" items={profile.talentProfile.qualifications.roleConditions} detailKeyPrefix="role-condition" onOpenEvidence={onOpenEvidence} isDetailOpen={isStagedDetailOpen} onDetailToggle={rememberStagedDetailToggle} />
            <TalentRequirementGroup title="必须具备" items={profile.talentProfile.qualifications.mustHave} detailKeyPrefix="must-have" onOpenEvidence={onOpenEvidence} isDetailOpen={isStagedDetailOpen} onDetailToggle={rememberStagedDetailToggle} />
            <TalentRequirementGroup title="优先考虑" items={profile.talentProfile.qualifications.preferred} detailKeyPrefix="preferred" onOpenEvidence={onOpenEvidence} isDetailOpen={isStagedDetailOpen} onDetailToggle={rememberStagedDetailToggle} />
            <TalentRequirementGroup title="可接受替代" items={profile.talentProfile.qualifications.alternatives} detailKeyPrefix="alternatives" onOpenEvidence={onOpenEvidence} isDetailOpen={isStagedDetailOpen} onDetailToggle={rememberStagedDetailToggle} />
          </section>
          <section className="generated-section">
            <header><span>{talentSections[2].number}</span><div><h3>{talentSections[2].title}</h3><p>将岗位要求组织为知识、技能、行为与动机的可观察模型。</p></div></header>
            <TalentRequirementGroup title="知识" items={profile.talentProfile.competencyModel.knowledge} detailKeyPrefix="knowledge" onOpenEvidence={onOpenEvidence} isDetailOpen={isStagedDetailOpen} onDetailToggle={rememberStagedDetailToggle} />
            <TalentRequirementGroup title="技能" items={profile.talentProfile.competencyModel.skills} detailKeyPrefix="skills" onOpenEvidence={onOpenEvidence} isDetailOpen={isStagedDetailOpen} onDetailToggle={rememberStagedDetailToggle} />
            <TalentRequirementGroup title="行为胜任力" items={profile.talentProfile.competencyModel.behavioralCompetencies} detailKeyPrefix="behavioral-competencies" onOpenEvidence={onOpenEvidence} isDetailOpen={isStagedDetailOpen} onDetailToggle={rememberStagedDetailToggle} />
            <TalentRequirementGroup title="价值观与工作风格" items={profile.talentProfile.competencyModel.valuesAndWorkStyle} detailKeyPrefix="values-work-style" onOpenEvidence={onOpenEvidence} isDetailOpen={isStagedDetailOpen} onDetailToggle={rememberStagedDetailToggle} />
            <TalentRequirementGroup title="职业动机" items={profile.talentProfile.competencyModel.careerMotivation} detailKeyPrefix="career-motivation" onOpenEvidence={onOpenEvidence} isDetailOpen={isStagedDetailOpen} onDetailToggle={rememberStagedDetailToggle} />
          </section>
        </article>
      );
    }
    return (
      <article className="generated-artifact-document role-profile-artifact">
        <section className="generated-section hiring-reason-section">
          <header><span>{jobSections[0].number}</span><div><h3>{jobSections[0].title}</h3><p>说明本次招聘对应的业务变化、组织缺口与不招聘影响。</p></div></header>
          <div className="generated-decision-chain">
            <div><small>业务变化</small><strong>{jobDescription.hiringBackground.businessChange}</strong></div>
            <ChevronRight size={14} />
            <div><small>组织缺口</small><strong>{jobDescription.hiringBackground.organizationGap}</strong></div>
            <ChevronRight size={14} />
            <div className="conclusion"><small>招聘结论</small><strong>{jobDescription.hiringBackground.hiringConclusion}</strong></div>
          </div>
          {jobDescription.hiringBackground.noHireImpact && <p><strong>不招聘的影响：</strong>{jobDescription.hiringBackground.noHireImpact}</p>}
          <ArtifactEvidenceRefs refs={jobDescription.hiringBackground.evidenceRefs} onOpenEvidence={onOpenEvidence} />
        </section>
        <section className="generated-section">
          <header><span>{jobSections[1].number}</span><div><h3>{jobSections[1].title}</h3><p>岗位为何存在，以及持续为组织创造的价值。</p></div></header>
          <p>{jobDescription.jobPurpose.statement}</p>
          <ArtifactEvidenceRefs refs={jobDescription.jobPurpose.evidenceRefs} onOpenEvidence={onOpenEvidence} />
        </section>
        <section className="generated-section">
          <header><span>{jobSections[2].number}</span><div><h3>{jobSections[2].title}</h3><p>持续承担的主要责任、核心产出及其关联成功结果。</p></div></header>
          <div className="generated-requirement-list">
            {jobDescription.accountabilities.map((item, index) => {
              const detailKey = item.instanceKey;
              return (
                <details
                  key={item.instanceKey}
                  open={isStagedDetailOpen(detailKey, index === 0)}
                  onToggle={rememberStagedDetailToggle(detailKey)}
                >
                  <summary><span className="must">{item.id}</span><strong>{item.name}</strong><ChevronDown size={15} /></summary>
                  <div className="generated-requirement-detail">
                    <DefinitionItem label="持续承担的责任" value={item.responsibility} />
                    <DefinitionItem label="核心产出" value={item.coreOutputs.join('；')} />
                    <DefinitionItem label="关联成功结果" value={item.successOutcomeRefs.join('；')} />
                    <ArtifactEvidenceRefs refs={item.evidenceRefs} onOpenEvidence={onOpenEvidence} />
                  </div>
                </details>
              );
            })}
          </div>
        </section>
        <section className="generated-section">
          <header><span>{jobSections[3].number}</span><div><h3>{jobSections[3].title}</h3><p>按 3 / 6 / 12 个月明确结果定义、衡量方式与确认状态。</p></div></header>
          <div className="generated-outcome-list">
            {jobDescription.successCriteria.map((outcome) => (
              <div className="generated-outcome-row" key={outcome.instanceKey}>
                <div className="generated-outcome-time"><small>{outcome.id}</small><strong>{outcome.horizon}</strong></div>
                <div className="generated-outcome-main">
                  <div><h4>{outcome.title}</h4><span>{outcome.status}</span></div>
                  <p>{outcome.definition}</p>
                  {outcome.measures.length > 0 && <div>{outcome.measures.map((measure) => <em key={measure}>{measure}</em>)}</div>}
                </div>
                <ArtifactEvidenceRefs refs={outcome.evidenceRefs} onOpenEvidence={onOpenEvidence} />
              </div>
            ))}
          </div>
        </section>
        <section className="generated-section">
          <header><span>{jobSections[4].number}</span><div><h3>{jobSections[4].title}</h3><p>描述岗位成功所面对的真实工作情境、挑战与协作关系。</p></div></header>
          <div className="generated-scenario-list">
            {jobDescription.workScenarios.map((scenario, index) => {
              const detailKey = scenario.instanceKey;
              return (
                <details
                  key={scenario.instanceKey}
                  open={isStagedDetailOpen(detailKey, index === 0)}
                  onToggle={rememberStagedDetailToggle(detailKey)}
                >
                  <summary>
                    <span>{scenario.id}</span><strong>{scenario.title}</strong><small>{scenario.frequency}</small>
                    {scenario.successOutcomeRefs.length > 0 && <em>{scenario.successOutcomeRefs.join(' · ')}</em>}
                    <ChevronDown size={15} />
                  </summary>
                  <div className="generated-scenario-detail">
                    <DefinitionItem label="触发情境" value={scenario.trigger} />
                    <DefinitionItem label="关键动作" value={scenario.actions} />
                    <DefinitionItem label="主要产出" value={scenario.output} />
                    <DefinitionItem label="核心挑战" value={scenario.challenge} />
                    <DefinitionItem label="协作对象" value={scenario.stakeholders.join('；')} />
                    <ArtifactEvidenceRefs refs={scenario.evidenceRefs} onOpenEvidence={onOpenEvidence} />
                  </div>
                </details>
              );
            })}
          </div>
        </section>
        <section className="generated-section boundary-generated-section">
          <header><span>{jobSections[5].number}</span><div><h3>{jobSections[5].title}</h3><p>明确负责、不负责、决策权限、关键协作关系和可调用资源。</p></div></header>
          <div className="generated-boundary-grid">
            <div><h4><Check size={13} />需要负责</h4>{jobDescription.boundaries.owns.map((item) => <p key={item}>{item}</p>)}</div>
            <div><h4><X size={13} />不直接负责</h4>{jobDescription.boundaries.doesNotOwn.map((item) => <p key={item}>{item}</p>)}</div>
            <div><h4>决策权限</h4><p>{jobDescription.boundaries.decisionRights.join('；')}</p></div>
            <div><h4>关键协作与资源</h4><p>{[...jobDescription.boundaries.keyCollaborations, ...jobDescription.boundaries.availableResources].join('；')}</p></div>
          </div>
          <ArtifactEvidenceRefs refs={jobDescription.boundaries.evidenceRefs} onOpenEvidence={onOpenEvidence} />
        </section>
      </article>
    );
  }
  if (view === 'talentProfile') {
    return (
      <article className="generated-artifact-document role-profile-artifact">
        <section className="generated-section">
          <header><span>{roleProfileViewSections.talentProfile[0].number}</span><div><h3>人才规格与可观察证据</h3><p>历史画像按人才要求展示；生成新版本后将升级为目标人才画像、任职资格与胜任力模型。</p></div></header>
          <div className="generated-requirement-list">
            {profile.capabilities.map((item, index) => (
              <details key={`${item.id ?? item.name}-${index}`} defaultOpen={index === 0}>
                <summary>
                  <span className={item.priority === 'Must-have' ? 'must' : 'preferred'}>{item.priority}</span>
                  <strong>{item.id} · {item.name}</strong><small>{item.level}</small>
                  {item.mapping.length > 0 && <em>{item.mapping.join(' · ')}</em>}
                  <ChevronDown size={15} />
                </summary>
                <div className="generated-requirement-detail">
                  <DefinitionItem label="为什么需要" value={item.rationale} />
                  <DefinitionItem label="强证据" value={item.strongEvidence} tone="positive" />
                  <DefinitionItem label="可接受替代" value={item.substitute} />
                  <DefinitionItem label="风险信号" value={item.risk} tone="negative" />
                  <DefinitionItem label="建议评估" value={item.assessment} />
                  <ArtifactEvidenceRefs refs={item.evidenceRefs} onOpenEvidence={onOpenEvidence} />
                </div>
              </details>
            ))}
            {profile.capabilities.length === 0 && <p className="generated-empty-copy">当前历史版本没有人才规格。</p>}
          </div>
        </section>
      </article>
    );
  }
  return (
    <article className="generated-artifact-document role-profile-artifact">
      <section className="generated-artifact-hero">
        <span><Target size={14} />岗位使命</span>
        <h2>{profile.mission}</h2>
        {profile.recruitment.noHireImpact && <p><strong>不招聘的影响：</strong>{profile.recruitment.noHireImpact}</p>}
      </section>
      <section className="generated-section hiring-reason-section">
        <header><span>01</span><div><h3>岗位为什么存在</h3><p>从已审批事实推导岗位结论，不重新审批 HC。</p></div></header>
        <div className="generated-decision-chain">
          <div><small>已审批事实</small><strong>{approvedFact}</strong></div>
          <ChevronRight size={14} />
          <div><small>业务变化</small><strong>{profile.recruitment.businessChange}</strong></div>
          <ChevronRight size={14} />
          <div><small>组织缺口</small><strong>{profile.recruitment.organizationGap}</strong></div>
          <ChevronRight size={14} />
          <div className="conclusion"><small>招聘结论</small><strong>{profile.recruitment.conclusion}</strong></div>
        </div>
        <ArtifactEvidenceRefs refs={profile.recruitment.evidenceRefs} onOpenEvidence={onOpenEvidence} />
      </section>
      <section className="generated-section">
        <header><span>02</span><div><h3>阶段性成功结果</h3><p>明确到什么时间、产生什么结果，以及如何观察和验收。</p></div></header>
        <div className="generated-outcome-list">
          {profile.outcomes.map((outcome, index) => (
            <div className="generated-outcome-row" key={`${outcome.id}-${index}`}>
              <div className="generated-outcome-time"><small>{outcome.id}</small><strong>{outcome.horizon}</strong></div>
              <div className="generated-outcome-main">
                <div><h4>{outcome.title}</h4><span>{outcome.status}</span></div>
                <p>{outcome.definition}</p>
                {outcome.measures.length > 0 && <div>{outcome.measures.map((measure) => <em key={measure}>{measure}</em>)}</div>}
                {outcome.evidence && <small>{outcome.evidence}</small>}
              </div>
              <ArtifactEvidenceRefs refs={outcome.evidenceRefs} onOpenEvidence={onOpenEvidence} />
            </div>
          ))}
          {profile.outcomes.length === 0 && <p className="generated-empty-copy">当前版本没有成功标准。</p>}
        </div>
      </section>
      <section className="generated-section">
        <header><span>03</span><div><h3>关键工作场景</h3><p>描述最影响岗位成功、最能区分候选人的真实工作，而不是复制旧 JD。</p></div></header>
        {profile.scenarios.length > 0 ? (
          <div className="generated-scenario-list">
            {profile.scenarios.map((scenario, index) => (
              <details key={scenario.id} defaultOpen={index === 0}>
                <summary>
                  <span>{scenario.id}</span><strong>{scenario.title}</strong><small>{scenario.frequency}</small>
                  {scenario.outcomeRefs.length > 0 && <em>{scenario.outcomeRefs.join(' · ')}</em>}
                  <ChevronDown size={15} />
                </summary>
                <div className="generated-scenario-detail">
                  <DefinitionItem label="触发情境" value={scenario.trigger} />
                  <DefinitionItem label="关键动作" value={scenario.actions} />
                  <DefinitionItem label="主要产出" value={scenario.output} />
                  <DefinitionItem label="核心挑战" value={scenario.challenge} />
                  <DefinitionItem label="协作对象" value={scenario.stakeholders} />
                  <ArtifactEvidenceRefs refs={scenario.evidenceRefs} onOpenEvidence={onOpenEvidence} />
                </div>
              </details>
            ))}
          </div>
        ) : (
          <ol className="generated-responsibility-fallback">{profile.responsibilities.map((item) => <li key={item}>{item}</li>)}</ol>
        )}
      </section>
      <section className="generated-section boundary-generated-section">
        <header><span>04</span><div><h3>权责边界与资源</h3><p>明确负责、不负责、关键决策权和岗位真正可调用的资源。</p></div></header>
        <div className="generated-boundary-grid">
          <div><h4><Check size={13} />需要负责</h4>{boundary.owns.map((item) => <p key={item}>{item}</p>)}</div>
          <div><h4><X size={13} />不直接负责</h4>{boundary.notOwns.map((item) => <p key={item}>{item}</p>)}</div>
          <div><h4>决策权限</h4><p>{boundary.decisionRights}</p></div>
          <div><h4>协作与资源</h4><p>{boundary.resources}</p></div>
        </div>
        <ArtifactEvidenceRefs refs={boundary.evidenceRefs} onOpenEvidence={onOpenEvidence} />
      </section>
    </article>
  );
}

function DefinitionItem({ label, value, tone = '' }) {
  return <div className={`definition-item ${tone}`}><span>{label}</span><p>{value}</p></div>;
}
