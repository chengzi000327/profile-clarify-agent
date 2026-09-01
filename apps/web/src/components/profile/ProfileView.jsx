import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  FileSearch,
  FileText,
  History,
  ShieldCheck,
} from 'lucide-react';
import { roleProfile } from '../../data.js';
import {
  roleProfileAction,
  roleProfileViewStatus,
} from '../../profile-content.js';
import { normalizePublicJDContent } from '../../public-jd-content.js';
import ClarifierMark from '../ClarifierMark.jsx';
import { roleBasicInfo } from '../../workbench/presentation.js';
import {
  GeneratedProfileBasis,
  RecruitingPortrait,
} from './RoleProfileDocument.jsx';
import GeneratedAssessment from './AssessmentDocument.jsx';

const artifactPresentation = {
  ROLE_PROFILE: { name: '画像依据', draftAction: '确认画像依据', generateAction: '生成画像依据' },
  ASSESSMENT_SCORECARD: { name: '评估方案', draftAction: '确认评估方案', generateAction: '生成评估方案' },
  PUBLIC_JD: { name: '对外 JD', draftAction: '确认并交给 HR 发布', generateAction: '生成对外 JD' },
  HR_RECRUITING_BRIEF: { name: '招聘画像', draftAction: '确认招聘画像', generateAction: '生成招聘画像' },
};

class ArtifactRenderBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error('Artifact rendering failed', error);
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="artifact-render-error" role="alert">
          <span><AlertTriangle size={22} /></span>
          <strong>当前产物暂时无法展示</strong>
          <p>这份历史产物的数据格式与当前页面不兼容。其他页签仍可继续使用，请为当前产物生成新版本。</p>
        </div>
      );
    }
    return this.props.children;
  }
}

const artifactStatusLabel = {
  DRAFT: '草稿待确认',
  CONFIRMED: '已确认',
  INVALIDATED: '上游变化，需更新',
};

function ArtifactEmptyState({ artifactType, invalidated, canManage, onGenerate, busy, roleProfileView = null }) {
  const presentation = artifactPresentation[artifactType];
  const isTalentProfile = artifactType === 'ROLE_PROFILE' && roleProfileView === 'talentProfile';
  const displayName = artifactType === 'ROLE_PROFILE'
    ? isTalentProfile ? '目标人才画像' : '岗位说明'
    : presentation.name;
  const actionLabel = artifactType === 'ROLE_PROFILE'
    ? roleProfileAction(null).label
    : presentation.generateAction;
  const prerequisite = {
    ROLE_PROFILE: isTalentProfile
      ? '先生成并确认岗位说明，再基于锁定版本推导目标人才画像。'
      : 'HC 已审批后即可生成；Agent 会基于招聘原因、成功标准和已确认事实形成岗位说明草稿。',
    ASSESSMENT_SCORECARD: '先形成岗位画像，再把成功标准转成可执行的面试维度和判断锚点。',
    PUBLIC_JD: '由已确认的岗位画像和评估方案生成，避免 JD 与真实招聘标准脱节。',
    HR_RECRUITING_BRIEF: '由岗位画像和评估方案生成 HR 内部寻源、简历初筛与电话初筛策略。',
  }[artifactType];
  return (
    <div className="artifact-empty-state">
      <span><FileSearch size={22} /></span>
      <strong>{invalidated ? `${displayName}需要更新` : `${displayName}尚未生成`}</strong>
      <p>{invalidated ? '上游产物已发生变化，请生成新版本以保持内容一致。' : prerequisite}</p>
      {canManage && !isTalentProfile ? (
        <button className="primary-action" type="button" onClick={onGenerate} disabled={busy}>
          {busy ? 'Agent 生成中…' : actionLabel}<ChevronRight size={15} />
        </button>
      ) : !isTalentProfile ? (
        <small>当前身份可查看该产物，但需要由{artifactType === 'HR_RECRUITING_BRIEF' ? ' HR' : '用人经理'}生成和确认。</small>
      ) : null}
    </div>
  );
}

export default function ProfileView({
  viewerRole,
  actualActorRole,
  onOpenEvidence,
  roleDetail,
  loading,
  error,
  onRetry,
  onArtifactAction,
  agentStatus,
}) {
  const [section, setSection] = useState(viewerRole === 'hr' ? 'portrait' : 'jobDescription');
  const state = roleDetail?.state;
  if (loading) {
    return (
      <section className="profile-surface redesigned-profile profile-loading-state" aria-live="polite">
        <ClarifierMark size={38} plate />
        <strong>正在加载岗位画像</strong>
        <p>正在同步岗位详情、画像产物与审批状态，请稍候。</p>
      </section>
    );
  }
  if (error) {
    return (
      <section className="profile-surface redesigned-profile profile-loading-state" role="alert">
        <AlertTriangle size={38} />
        <strong>岗位画像加载失败</strong>
        <p>{error}</p>
        <button className="primary-action" type="button" onClick={onRetry}>重新加载</button>
      </section>
    );
  }
  if (!state) {
    return (
      <section className="profile-surface redesigned-profile profile-loading-state" aria-live="polite">
        <ClarifierMark size={38} plate />
        <strong>暂无岗位画像</strong>
        <span>当前岗位还没有可展示的画像详情，请先在岗位澄清对话中补充信息。</span>
      </section>
    );
  }
  const latestArtifacts = state?.latest_artifacts ?? {};
  const meta = {
    ...roleProfile.meta,
    title: state?.title ?? roleProfile.meta.title,
    version: latestArtifacts.ROLE_PROFILE ? `v${latestArtifacts.ROLE_PROFILE.version}` : '未生成',
  };

  const allProfileTabs = [
    { id: 'portrait', type: 'HR_RECRUITING_BRIEF', label: '招聘画像' },
    { id: 'jobDescription', type: 'ROLE_PROFILE', label: '岗位说明' },
    { id: 'talentProfile', type: 'ROLE_PROFILE', label: '目标人才画像' },
    { id: 'assessment', type: 'ASSESSMENT_SCORECARD', label: '评估方案' },
    { id: 'jd', type: 'PUBLIC_JD', label: '对外 JD' },
  ];
  const profileTabs = (viewerRole === 'hr' ? allProfileTabs : allProfileTabs.filter((item) => item.id !== 'portrait'))
    .map((item) => ({
      ...item,
      meta: item.type === 'ROLE_PROFILE'
        ? roleProfileViewStatus(latestArtifacts.ROLE_PROFILE, item.id)
        : artifactStatusLabel[latestArtifacts[item.type]?.status] ?? '尚未生成',
    }));
  const artifactType = section === 'jd'
    ? 'PUBLIC_JD'
    : section === 'assessment'
      ? 'ASSESSMENT_SCORECARD'
      : section === 'portrait'
        ? 'HR_RECRUITING_BRIEF'
        : 'ROLE_PROFILE';
  const latestArtifact = roleDetail?.state?.latest_artifacts?.[artifactType];
  const presentation = artifactPresentation[artifactType];
  const canManageArtifact = section === 'portrait' ? viewerRole === 'hr' : viewerRole === 'manager';
  const connectedActionLabel = artifactType === 'ROLE_PROFILE'
    ? roleProfileAction(latestArtifact).label
    : latestArtifact?.status === 'DRAFT'
      ? presentation.draftAction
      : latestArtifact?.status === 'CONFIRMED'
        ? '生成新版本'
        : presentation.generateAction;
  return (
    <section className="profile-surface redesigned-profile">
      <div className="profile-page profile-page-wide">
        <div className="profile-heading profile-heading-rich">
          <div>
            <div className="document-kicker"><FileSearch size={15} />岗位画像工作台 · {meta.version}</div>
            <h1>{meta.title}</h1>
            <div className="profile-meta-line">
              <span className="approved-inline"><CheckCircle2 size={12} />HC 已审批</span><i>·</i><span>{state?.department ?? '团队待同步'}</span><i>·</i><span>审批单 {state?.hc_context?.request_id ?? '待同步'}</span>
            </div>
          </div>
          <div className="profile-heading-actions">
            <button className="quiet-button"><History size={15} />查看版本</button>
            <button
              className="primary-action"
              disabled={agentStatus === 'running' || !canManageArtifact}
              onClick={() => onArtifactAction?.(artifactType)}
            >
              {agentStatus === 'running' ? 'Agent 生成中…' : canManageArtifact ? connectedActionLabel : '只读查看'}<ChevronRight size={16} />
            </button>
          </div>
        </div>

        <div className="portrait-basic-strip" aria-label="招聘基本信息">
          {roleBasicInfo(state, viewerRole).map((item) => (
            <div key={item.label} className={item.confirmed ? 'confirmed' : item.restricted ? 'restricted' : ''}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>

        <div className={`profile-permission-note ${viewerRole}`}>
          <ShieldCheck size={13} />
          <span>{actualActorRole === 'ADMIN' ? `企业管理员正在以“${viewerRole === 'hr' ? 'HR' : '用人经理'}”身份测试；真实身份仍写入审计记录。` : viewerRole === 'hr' ? 'HR 权限：在同一岗位会话中查看招聘画像、岗位说明、目标人才画像、评估方案和对外 JD。' : '用人经理权限：确认岗位说明、完整岗位画像、评估方案和对外 JD；HR 内部招聘画像不可见。'}</span>
        </div>

        <nav className={`profile-subnav tabs-${profileTabs.length}`} aria-label="岗位画像目录" style={{ gridTemplateColumns: `repeat(${profileTabs.length}, minmax(0, 1fr))` }}>
          {profileTabs.map((item) => (
            <button className={section === item.id ? 'active' : ''} key={item.id} onClick={() => setSection(item.id)}>
              <span>{item.label}</span><small>{item.meta}</small>
            </button>
          ))}
        </nav>

        <div className="profile-content-frame">
          {section === 'portrait' ? (
            (!latestArtifact || latestArtifact.status === 'INVALIDATED') ? (
              <ArtifactEmptyState
                artifactType={artifactType}
                invalidated={latestArtifact?.status === 'INVALIDATED'}
                canManage={canManageArtifact}
                onGenerate={() => onArtifactAction?.(artifactType)}
                busy={agentStatus === 'running'}
              />
            ) : (
              <RecruitingPortrait onOpenEvidence={onOpenEvidence} artifact={latestArtifact} roleDetail={roleDetail} />
            )
          ) : (
            <ArtifactRenderBoundary key={`${section}-${artifactType}-${latestArtifact?.id ?? 'empty'}-${latestArtifact?.version ?? 0}`}>
              {(!latestArtifact || latestArtifact.status === 'INVALIDATED') ? (
                <ArtifactEmptyState
                  artifactType={artifactType}
                  invalidated={latestArtifact?.status === 'INVALIDATED'}
                  canManage={canManageArtifact}
                  onGenerate={() => onArtifactAction?.(artifactType)}
                  busy={agentStatus === 'running'}
                  roleProfileView={artifactType === 'ROLE_PROFILE' ? section : null}
                />
              ) : section === 'jobDescription' || section === 'talentProfile' ? (
                <GeneratedProfileBasis artifact={latestArtifact} state={state} onOpenEvidence={onOpenEvidence} view={section} />
              ) : section === 'assessment' ? (
                <GeneratedAssessment artifact={latestArtifact} />
              ) : (
                <JDPreview jd={latestArtifact} state={state} />
              )}
            </ArtifactRenderBoundary>
          )}
        </div>
      </div>
    </section>
  );
}


function JDPreview({ jd, state }) {
  const fallbackResponsibilities = [
    '当前历史版本没有可展示的岗位职责，请生成新版本补齐。',
  ];

  const fallbackCapabilities = [
    {
      id: 'missing-capability',
      title: '当前历史版本没有可展示的人才要求',
      description: '请生成新版本补齐。',
    },
  ];
  const normalized = normalizePublicJDContent(jd?.content, state, {
    about: '当前历史版本没有可展示的岗位说明，请生成新版本补齐。',
    responsibilities: fallbackResponsibilities,
    capabilities: fallbackCapabilities,
  });

  return (
    <div className="jd-preview-shell">
      <div className="jd-toolbar">
        <div><span className="jd-output-badge"><FileText size={12} />候选人版</span><strong>对外 JD · {jd?.status === 'CONFIRMED' ? '已确认' : '待用人经理确认'}</strong><span>严格保持候选人四段结构</span></div>
        <div className="jd-toolbar-actions"><button className="quiet-button"><FileText size={14} />复制 JD</button></div>
      </div>
      <article className="jd-document">
        <header>
          <span>{normalized.department} · {normalized.location}</span>
          <h1>{normalized.title}</h1>
          <p>一起把复杂问题转化为真正可验证的业务结果。</p>
          <div className="jd-facts"><span>{normalized.employmentType}</span><span>{normalized.level}</span><span>汇报给{normalized.reportingLine}</span></div>
        </header>
        <section className="jd-about-role">
          <h2>关于岗位</h2>
          <p>{normalized.about}</p>
        </section>
        <section><h2>你会做什么</h2><ol className="jd-responsibility-list">
          {normalized.responsibilities.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
        </ol></section>
        <section><h2>我们希望你具备</h2><div className="jd-capability-list">
          {normalized.capabilities.map((capability) => <div key={capability.id}><strong>{capability.title}</strong>{capability.description && <p>{capability.description}</p>}</div>)}
        </div></section>
        <footer className="jd-document-footer"><span>候选人版预览 · 仅包含可公开字段</span><strong>版本 v{jd?.version ?? '0.5'} · {jd?.status === 'CONFIRMED' ? '已确认' : '待发布'}</strong></footer>
      </article>
    </div>
  );
}
