import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ArrowUp,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Database,
  FileSearch,
  FileText,
  History,
  Link2,
  ListChecks,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  Users,
  X,
} from 'lucide-react';
import {
  contextSources,
  evidenceById,
  recruitingPortrait,
  roleProfile,
  roleSessionsSeed,
  traceRows,
  versions,
} from './data.js';

const sourceIcons = {
  org: Users,
  doc: FileText,
  people: Users,
  database: Database,
};

function ClarifierMark({ size = 32, plate = false }) {
  return (
    <span className={`clarifier-mark ${plate ? 'with-plate' : ''}`} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 40 40" role="img">
        <path className="mark-blue" d="M18.1 7.5h-6.3A5.8 5.8 0 0 0 6 13.3v6.3a5.8 5.8 0 0 0 4.4 5.6L7.6 29l6.3-3.6h4.2" />
        <path className="mark-cyan" d="M21.9 7.5h6.3a5.8 5.8 0 0 1 5.8 5.8v6.3a5.8 5.8 0 0 1-4.4 5.6l2.8 3.8-6.3-3.6h-4.2" />
        <path className="mark-focus" d="M15.8 14.2h-2.1v2.2M24.2 14.2h2.1v2.2M15.8 22.6h-2.1v-2.2M24.2 22.6h2.1v-2.2" />
        <circle className="mark-dot" cx="20" cy="18.4" r="2.2" />
      </svg>
    </span>
  );
}

function App() {
  const [roleSessions, setRoleSessions] = useState(roleSessionsSeed);
  const [activeRoleId, setActiveRoleId] = useState('role-enterprise-pm');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeView, setActiveView] = useState('conversation');
  const [evidenceId, setEvidenceId] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [viewerRole, setViewerRole] = useState('manager');
  const [selectedOutcome, setSelectedOutcome] = useState('diagnosis');
  const [outcomeConfirmed, setOutcomeConfirmed] = useState(false);

  const activeRole = useMemo(
    () => roleSessions.find((role) => role.id === activeRoleId) ?? roleSessions[0],
    [roleSessions, activeRoleId],
  );
  const evidence = evidenceId ? evidenceById[evidenceId] : null;

  function chooseRole(roleId) {
    setActiveRoleId(roleId);
    setActiveView('conversation');
    setEvidenceId(null);
    setOutcomeConfirmed(false);
  }

  function createRoleSession(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const roleName = form.get('roleName')?.toString().trim() || '未命名岗位';
    const team = form.get('team')?.toString().trim() || '待补充团队';
    const id = `role-${Date.now()}`;
    setRoleSessions((current) => [
      {
        id,
        name: roleName,
        team,
        stage: '需求待澄清',
        stageTone: 'active',
        meta: '刚创建',
        version: '未生成画像',
        updatedAt: '刚刚',
        unread: 1,
      },
      ...current,
    ]);
    setActiveRoleId(id);
    setActiveView('conversation');
    setCreateOpen(false);
  }

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'sidebar-is-collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="brand-row">
          <button className="brand" aria-label="画像澄清 Agent">
            <ClarifierMark size={34} plate />
            {!sidebarCollapsed && (
              <span className="brand-copy">
                <strong>画像澄清 Agent</strong>
                <small>ROLE CLARIFIER</small>
              </span>
            )}
          </button>
          <button
            className="icon-button subtle"
            onClick={() => setSidebarCollapsed((value) => !value)}
            aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
        </div>

        <button className="new-project-button" onClick={() => setCreateOpen(true)}>
          <Plus size={17} />
          {!sidebarCollapsed && <span>新建岗位澄清</span>}
        </button>

        {!sidebarCollapsed && (
          <div className="sidebar-section-title">
            <span>最近会话</span>
            <div>
              <button className="icon-button tiny" aria-label="搜索会话"><Search size={15} /></button>
              <button className="icon-button tiny" aria-label="会话筛选"><SlidersHorizontal size={15} /></button>
            </div>
          </div>
        )}

        <nav className="role-session-list" aria-label="岗位澄清会话列表">
          {roleSessions.map((role) => {
            const active = role.id === activeRoleId;
            return (
              <button
                className={`role-session-row ${active ? 'active' : ''}`}
                key={role.id}
                onClick={() => {
                  if (sidebarCollapsed) setSidebarCollapsed(false);
                  chooseRole(role.id);
                }}
                title={`${role.name} · ${role.stage}`}
              >
                <span className="session-icon"><MessageSquare size={15} /></span>
                {!sidebarCollapsed && (
                  <span className="role-session-copy">
                    <span className="role-session-title"><strong>{role.name}</strong><small>{role.updatedAt}</small></span>
                    <span className="role-session-meta">
                      <em className={role.stageTone}>{role.stage}</em>
                      <i>·</i>
                      <small>{role.meta}</small>
                    </span>
                  </span>
                )}
                {role.unread && <span className="session-unread">{role.unread}</span>}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <button className="sidebar-utility" title="资料与权限">
            <Settings size={17} />
            {!sidebarCollapsed && <span>资料与权限</span>}
          </button>
          <button className="user-chip" onClick={() => setProfileMenuOpen((value) => !value)}>
            <span className={`avatar ${viewerRole === 'manager' ? 'avatar-manager' : 'avatar-hr'}`}>{viewerRole === 'manager' ? '陈' : 'HR'}</span>
            {!sidebarCollapsed && (
              <span className="user-copy">
                <strong>{viewerRole === 'manager' ? '陈晓' : '林薇'}</strong>
                <small>{viewerRole === 'manager' ? '用人经理' : 'HR 招聘负责人'}</small>
              </span>
            )}
            {!sidebarCollapsed && <MoreHorizontal size={16} />}
          </button>
          {profileMenuOpen && !sidebarCollapsed && (
            <div className="profile-popover">
              <strong>预览角色权限</strong>
              <span>正式环境由企业身份和岗位协作关系自动授权。</span>
              <div className="role-preview-switch">
                <button className={viewerRole === 'manager' ? 'active' : ''} onClick={() => { setViewerRole('manager'); setProfileMenuOpen(false); }}>用人经理</button>
                <button className={viewerRole === 'hr' ? 'active' : ''} onClick={() => { setViewerRole('hr'); setProfileMenuOpen(false); }}>HR 招聘负责人</button>
              </div>
            </div>
          )}
        </div>
      </aside>

      <main className="main-workspace">
        <header className="workspace-header">
          <div className="title-stack">
            <div className="title-line">
              <strong>{activeRole.name}</strong>
              <span className={`role-stage-badge ${activeRole.stageTone}`}>{activeRole.stage}</span>
            </div>
            <div className="preset-line">
              <span className="preset-badge"><ClarifierMark size={16} />画像澄清 Agent</span>
              <span className="phase-dot" />
              <span>{activeRole.team}</span>
              <span className="phase-dot" />
              <span>{activeRole.version}</span>
            </div>
          </div>
          <div className="header-actions">
            <div className="collaborators" aria-label="会话协作者">
              <span className="avatar avatar-manager">陈</span>
              <span className="avatar avatar-hr">HR</span>
              <button className="avatar avatar-add" aria-label="邀请 HR"><Plus size={13} /></button>
            </div>
            <button className="quiet-button"><History size={15} />版本</button>
            <button className="icon-button" aria-label="更多操作"><MoreHorizontal size={18} /></button>
          </div>
        </header>

        <div className="workspace-tabs">
          <button className={activeView === 'conversation' ? 'active' : ''} onClick={() => setActiveView('conversation')}>
            对话
          </button>
          <button className={activeView === 'profile' ? 'active' : ''} onClick={() => setActiveView('profile')}>
            岗位画像 <span className="tab-state">{activeRole.version}</span>
          </button>
        </div>

        {activeView === 'conversation' ? (
          <ConversationView
            activeRole={activeRole}
            selectedOutcome={selectedOutcome}
            setSelectedOutcome={setSelectedOutcome}
            outcomeConfirmed={outcomeConfirmed}
            setOutcomeConfirmed={setOutcomeConfirmed}
            onOpenEvidence={setEvidenceId}
            onOpenProfile={() => setActiveView('profile')}
          />
        ) : (
          <ProfileView key={viewerRole} viewerRole={viewerRole} onOpenEvidence={setEvidenceId} />
        )}
      </main>

      {evidence && <EvidenceDrawer evidence={evidence} onClose={() => setEvidenceId(null)} />}
      {createOpen && <CreateRoleModal onClose={() => setCreateOpen(false)} onSubmit={createRoleSession} />}
    </div>
  );
}

function ConversationView({
  activeRole,
  selectedOutcome,
  setSelectedOutcome,
  outcomeConfirmed,
  setOutcomeConfirmed,
  onOpenEvidence,
  onOpenProfile,
}) {
  const isPrimaryDemo = activeRole.id === 'role-enterprise-pm';
  const outcomeLabels = {
    diagnosis: '建立跨项目的产品化责任主体',
    pilot: '补充客户项目交付产能',
    requirements: '加强需求承接和项目协调',
  };

  if (!isPrimaryDemo) {
    return (
      <section className="conversation-surface">
        <div className="conversation-scroll">
          <div className="transcript">
            <div className="session-intro compact-intro">
              <ClarifierMark size={40} plate />
              <div>
                <h1>{activeRole.name}</h1>
                <p>这个会话将持续保存需求澄清、岗位画像、候选人简历和招聘反馈，不需要再为不同阶段创建子会话。</p>
              </div>
            </div>
            <div className="empty-session-panel">
              <div className="empty-icon">{activeRole.stageTone === 'calibrating' ? <Database size={22} /> : <ShieldCheck size={22} />}</div>
              <strong>{activeRole.stage}</strong>
              <p>
                {activeRole.stageTone === 'calibrating'
                  ? '已导入首批简历。Agent 将比较画像要求与候选人证据，识别供给不足、画像过窄或评估口径偏差。'
                  : '当前画像已经过用人经理确认，后续招聘反馈仍会持续沉淀在本会话中。'}
              </p>
              <button className="primary-action" onClick={onOpenProfile}>查看当前岗位画像<ChevronRight size={16} /></button>
            </div>
          </div>
        </div>
        <Composer />
      </section>
    );
  }

  return (
    <section className="conversation-surface">
      <div className="conversation-scroll">
        <div className="transcript">
          <div className="session-intro">
            <ClarifierMark size={40} plate />
            <div>
              <h1>先确认为什么新增这个编制，再定义要找的人</h1>
              <p>HC 已审批，本轮不会重新判断是否招聘；我会确认获批原因，并把它依次转成成功标准、岗位画像、评估方案和对外 JD。</p>
            </div>
          </div>

          <div className="context-run">
            <div className="run-heading">
              <span><Sparkles size={15} />已为本次岗位澄清准备背景</span>
              <small>4 / 4 完成</small>
            </div>
            <div className="source-grid">
              {contextSources.map((source) => {
                const SourceIcon = sourceIcons[source.icon];
                return (
                  <button className="source-row" key={source.id} onClick={() => onOpenEvidence(source.evidenceId)}>
                    <span className="source-icon"><SourceIcon size={15} /></span>
                    <span><strong>{source.label}</strong><small>{source.detail}</small></span>
                    <CheckCircle2 size={15} className="source-check" />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="message message-user">
            <div className="message-label">你 · 用人经理</div>
            <div className="user-bubble">需要一个懂 B 端的产品经理，最好做过同行业。</div>
          </div>

          <div className="message message-agent">
            <span className="agent-avatar"><ClarifierMark size={25} /></span>
            <div className="message-body">
              <div className="message-label">画像澄清 Agent</div>
              <p>我先确认边界：这个新增 HC 已经审批通过，现在不再重新评估“要不要招”，而是要判断<strong>为什么新增这个编制</strong>，避免后续画像沿用旧岗位。</p>
              <p>我不会先把“懂 B 端”和“同行业”写成任职门槛。结合组织方向和旧 JD，我看到这个岗位已经发生了实质变化：</p>
              <p>过去偏客户项目交付；现在真正需要解决的是<strong>相似方案重复建设、产品能力难以规模复用</strong>。因此需要先确认成功结果，再判断行业经验是不是完成结果的必要条件。</p>
              <div className="inline-references">
                <button onClick={() => onOpenEvidence('E-02')}><Link2 size={13} />组织背景 E-02</button>
                <button onClick={() => onOpenEvidence('E-03')}><AlertTriangle size={13} />旧 JD 冲突 E-03</button>
                <button onClick={() => onOpenEvidence('E-06')}><Link2 size={13} />人才供给 E-06</button>
              </div>
            </div>
          </div>

          <div className="reasoning-node">
            <button className="reasoning-title">
              <ChevronDown size={14} />
              <span>判断过程</span>
              <small>获批原因 → 成功标准 → 岗位画像 → 评估方案 → 对外 JD</small>
            </button>
            <div className="reasoning-steps">
              <span><Check size={13} />确认 HC 已审批</span>
              <span><Check size={13} />识别业务变化与旧 JD 冲突</span>
              <span className="warn"><AlertTriangle size={13} />需要经理确认新增编制的核心目的</span>
            </div>
          </div>

          <div className="question-block">
            <div className="question-kicker"><CircleDot size={14} />需要你的判断</div>
            <h2>这次新增编制，最核心是要解决哪一个组织缺口？</h2>
            <p>这个判断不会影响已审批 HC，只决定后续成功标准、岗位画像和 JD 的方向。</p>
            <div className="choice-list">
              <OutcomeChoice
                code="A"
                value="diagnosis"
                selected={selectedOutcome}
                onSelect={setSelectedOutcome}
                title="建立跨项目的产品化责任主体"
                detail="负责共性需求、产品边界和标准化路线，推动能力完成多客户验证"
              />
              <OutcomeChoice
                code="B"
                value="pilot"
                selected={selectedOutcome}
                onSelect={setSelectedOutcome}
                title="补充客户项目交付产能"
                detail="主要增加需求承接、项目推进和客户交付能力"
              />
              <OutcomeChoice
                code="C"
                value="requirements"
                selected={selectedOutcome}
                onSelect={setSelectedOutcome}
                title="加强需求承接和项目协调"
                detail="聚焦需求池管理、研发协同和项目进度，不承担产品化结果"
              />
            </div>
            <div className="question-actions">
              <button className="text-action">都不准确，我补充</button>
              <button className="primary-action" onClick={() => setOutcomeConfirmed(true)} disabled={outcomeConfirmed}>
                {outcomeConfirmed ? <><Check size={16} />已记录</> : <>确认并继续<ArrowUp size={15} /></>}
              </button>
            </div>
          </div>

          {outcomeConfirmed && (
            <div className="message message-agent followup-message">
              <div className="agent-avatar success"><Check size={15} /></div>
              <div className="message-body">
                <div className="message-label">已确认招聘原因 · 草稿 v0.4</div>
                <p>已记录“{outcomeLabels[selectedOutcome]}”。下一步我会把这个原因拆成 90 天、6 个月和 12 个月成功标准，再反推岗位画像和对外 JD。</p>
                <button className="inline-profile-link" onClick={onOpenProfile}>查看招聘原因与画像推导<ChevronRight size={14} /></button>
              </div>
            </div>
          )}

          <div className="run-stats"><span>第 1 轮</span><span>3 个判断步骤</span><span>已引用 6 条证据</span></div>
        </div>
      </div>
      <Composer />
    </section>
  );
}

function OutcomeChoice({ code, value, selected, onSelect, title, detail }) {
  return (
    <label className={selected === value ? 'selected' : ''}>
      <input type="radio" name="outcome" checked={selected === value} onChange={() => onSelect(value)} />
      <span className="choice-marker">{code}</span>
      <span><strong>{title}</strong><small>{detail}</small></span>
      {selected === value && <Check size={16} />}
    </label>
  );
}

function Composer() {
  const [text, setText] = useState('');
  return (
    <div className="composer-dock">
      <div className="composer">
        <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="补充业务背景，或直接回答 Agent 的问题…" rows={1} />
        <div className="composer-toolbar">
          <div>
            <button className="icon-button tiny" aria-label="添加资料"><Plus size={17} /></button>
            <button className="composer-setting"><ShieldCheck size={14} />会话资料可读</button>
          </div>
          <div>
            <button className="composer-setting">DeepSeek V4 Pro<ChevronDown size={13} /></button>
            <button className="composer-setting">High<ChevronDown size={13} /></button>
            <button className="send-button" aria-label="发送" disabled={!text.trim()}><ArrowUp size={17} /></button>
          </div>
        </div>
      </div>
      <p className="composer-caption">画像结论保留证据和推断状态，仅在用人经理确认后生效。</p>
    </div>
  );
}

function ProfileView({ viewerRole, onOpenEvidence }) {
  const [section, setSection] = useState(viewerRole === 'hr' ? 'portrait' : 'basis');
  const [expandedScenario, setExpandedScenario] = useState('T-01');
  const [expandedRequirement, setExpandedRequirement] = useState('C-01');
  const [expandedScore, setExpandedScore] = useState('A-01');
  const meta = roleProfile.meta;

  const allProfileTabs = [
    { id: 'portrait', label: '招聘画像', meta: 'HR 寻源主视图' },
    { id: 'basis', label: '画像依据', meta: '招聘原因 · 成功标准 · 岗位画像' },
    { id: 'assessment', label: '评估方案', meta: `${roleProfile.scorecard.length} 个维度` },
    { id: 'jd', label: '对外 JD', meta: '最终候选人发布物' },
  ];
  const profileTabs = viewerRole === 'hr' ? allProfileTabs : allProfileTabs.filter((item) => item.id !== 'portrait');
  const primaryActionLabel = section === 'jd'
    ? '确认并交给 HR 发布'
    : section === 'assessment'
      ? '确认评估方案'
      : section === 'portrait'
        ? '保存 HR 招聘策略'
        : '确认画像依据';
  const decisionSteps = ['招聘原因与成功标准', '岗位画像', '评估方案', '对外 JD'];
  const currentDecisionStep = section === 'assessment' ? 2 : section === 'jd' ? 3 : 1;

  return (
    <section className="profile-surface redesigned-profile">
      <div className="profile-page profile-page-wide">
        <div className="profile-heading profile-heading-rich">
          <div>
            <div className="document-kicker"><FileSearch size={15} />招聘识别画像 · {meta.version}</div>
            <h1>{meta.title}</h1>
            <div className="profile-meta-line">
              <span className="approved-inline"><CheckCircle2 size={12} />HC 已审批</span><i>·</i><span>用人经理 陈晓</span><i>·</i><span>协作 HR 林薇</span>
            </div>
          </div>
          <div className="profile-heading-actions">
            <button className="quiet-button"><History size={15} />查看版本</button>
            <button className="primary-action">{primaryActionLabel}<ChevronRight size={16} /></button>
          </div>
        </div>

        <div className="portrait-basic-strip" aria-label="招聘基本信息">
          {recruitingPortrait.basicInfo.map((item) => (
            <div key={item.label} className={item.confirmed ? 'confirmed' : item.restricted ? 'restricted' : ''}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>

        <div className={`profile-permission-note ${viewerRole}`}>
          <ShieldCheck size={13} />
          <span>{viewerRole === 'hr' ? 'HR 权限：可查看内部寻源策略、候选人判断规则和全部协作产物。' : '用人经理权限：可确认画像依据、评估方案和对外 JD；HR 内部寻源策略不可见。'}</span>
        </div>

        {section !== 'portrait' && (
          <div className="decision-flow" aria-label="岗位画像产出流程">
            {decisionSteps.map((step, index) => (
              <React.Fragment key={step}>
                <div className={`${index < currentDecisionStep ? 'completed' : ''} ${index === currentDecisionStep ? 'current' : ''}`}>
                  <span>{index < currentDecisionStep ? <Check size={11} /> : index + 1}</span><strong>{step}</strong>
                </div>
                {index < decisionSteps.length - 1 && <ChevronRight size={13} />}
              </React.Fragment>
            ))}
          </div>
        )}

        <nav className={`profile-subnav tabs-${profileTabs.length}`} aria-label="岗位画像目录" style={{ gridTemplateColumns: `repeat(${profileTabs.length}, minmax(0, 1fr))` }}>
          {profileTabs.map((item) => (
            <button className={section === item.id ? 'active' : ''} key={item.id} onClick={() => setSection(item.id)}>
              <span>{item.label}</span><small>{item.meta}</small>
            </button>
          ))}
        </nav>

        <div className="profile-content-frame">
          {section === 'portrait' && <RecruitingPortrait onOpenEvidence={onOpenEvidence} />}
          {section === 'basis' && (
            <ProfileBasis
              expandedScenario={expandedScenario}
              setExpandedScenario={setExpandedScenario}
              expandedRequirement={expandedRequirement}
              setExpandedRequirement={setExpandedRequirement}
              onOpenEvidence={onOpenEvidence}
            />
          )}
          {section === 'assessment' && (
            <SuccessScorecard
              expandedScore={expandedScore}
              setExpandedScore={setExpandedScore}
            />
          )}
          {section === 'jd' && <JDPreview />}
        </div>
      </div>
    </section>
  );
}

function RecruitingPortrait({ onOpenEvidence }) {
  const portrait = recruitingPortrait;
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
          <button onClick={() => onOpenEvidence(portrait.approvedContext.evidence[0])}><CheckCircle2 size={12} />已获批业务目标<Link2 size={11} /></button>
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

function ProfileBasis({ expandedScenario, setExpandedScenario, expandedRequirement, setExpandedRequirement, onOpenEvidence }) {
  const [basisView, setBasisView] = useState('job');
  return (
    <div className="profile-basis-wrap">
      <div className="basis-switchbar">
        <button className={basisView === 'job' ? 'active' : ''} onClick={() => setBasisView('job')}>招聘原因与成功标准</button>
        <button className={basisView === 'talent' ? 'active' : ''} onClick={() => setBasisView('talent')}>岗位画像 · 人才要求</button>
      </div>
      {basisView === 'job' ? (
        <>
          <HiringReasonDecision onOpenEvidence={onOpenEvidence} />
          <JobDefinition expandedScenario={expandedScenario} setExpandedScenario={setExpandedScenario} onOpenEvidence={onOpenEvidence} />
        </>
      ) : (
        <TalentSpecification expandedRequirement={expandedRequirement} setExpandedRequirement={setExpandedRequirement} onOpenEvidence={onOpenEvidence} />
      )}
    </div>
  );
}

function HiringReasonDecision({ onOpenEvidence }) {
  const [confirmed, setConfirmed] = useState(false);
  return (
    <section className="hiring-reason-decision">
      <div className="hiring-boundary-note"><ShieldCheck size={14} /><span><strong>判断边界：</strong>HC 已审批，这里不重新判断“要不要招”，只确认获批原因是否被正确转成岗位成功标准。</span></div>
      <div className="hiring-reason-heading">
        <div><span>01</span><div><h2>为什么新增这个编制</h2><p>把招聘原因说清楚，后续岗位画像、评估方案和 JD 才不会发生偏移。</p></div></div>
        <div className="reason-evidence-links">
          {roleProfile.recruitment.evidence.slice(0, 3).map((id) => <button key={id} onClick={() => onOpenEvidence(id)}>{id}<Link2 size={10} /></button>)}
        </div>
      </div>
      <div className="hiring-judgement-chain">
        <div><span>已审批事实</span><strong>新增正式编制 1 人</strong><p>不是人员替换，也不是临时项目增援。</p></div>
        <ChevronRight size={15} />
        <div><span>业务变化</span><strong>从定制交付转向标准产品经营</strong><p>相似客户能力正在被重复建设。</p></div>
        <ChevronRight size={15} />
        <div><span>组织缺口</span><strong>缺少跨项目的产品化责任主体</strong><p>没有人持续负责产品边界和复用价值。</p></div>
        <ChevronRight size={15} />
        <div className="conclusion"><span>招聘结论</span><strong>新增企业产品经理，而非交付项目经理</strong><p>核心任务是沉淀标准产品并完成多客户验证。</p></div>
      </div>
      <div className="reason-impact-decision">
        <div><Sparkles size={15} /><p><strong>Agent 判断：</strong>候选人的核心门槛应是“跨客户抽象＋产品化闭环”，同行业经验只能作为加分项，不能成为首要筛选条件。</p></div>
        <button className={confirmed ? 'confirmed' : ''} onClick={() => setConfirmed(true)}>{confirmed ? <><Check size={13} />招聘原因已确认</> : <>确认招聘原因<ChevronRight size={13} /></>}</button>
      </div>
    </section>
  );
}

function JDPreview() {
  return (
    <div className="jd-preview-shell">
      <div className="jd-toolbar">
        <div><span className="jd-output-badge"><FileText size={12} />核心发布物</span><strong>对外 JD · 待用人经理确认</strong><span>由招聘原因、岗位画像和评估方案生成</span></div>
        <div className="jd-toolbar-actions"><button className="quiet-button"><FileText size={14} />复制 JD</button></div>
      </div>
      <article className="jd-document">
        <header>
          <span>企业服务产品部 · 北京 / 上海</span>
          <h1>企业产品经理</h1>
          <p>一起把复杂客户需求沉淀为真正可复用的标准产品。</p>
          <div className="jd-facts"><span>正式编制 · 1 人</span><span>3-2 至 4-1</span><span>汇报给产品负责人</span></div>
        </header>
        <section className="jd-background"><h2>为什么现在招聘这个岗位</h2><p>{recruitingPortrait.approvedContext.reason}</p><p>{recruitingPortrait.approvedContext.coreProblem}</p></section>
        <section><h2>岗位使命</h2><p>{roleProfile.recruitment.mission}</p></section>
        <section><h2>你将负责</h2><ul>
          <li>复盘多个客户项目，识别共性场景，形成标准产品路线与清晰边界。</li>
          <li>定义产品 MVP、验证指标和迭代优先级，并推动真实客户试点。</li>
          <li>协同销售、交付、解决方案与研发，在复杂约束下形成可执行决策。</li>
          <li>持续跟踪产品采用率、复用率和交付效率，验证产品化价值。</li>
        </ul></section>
        <section><h2>加入后，你需要取得的关键结果</h2><div className="jd-success-results">
          {roleProfile.outcomes.map((outcome) => <div key={outcome.id}><span>{outcome.horizon}</span><strong>{outcome.title}</strong><p>{outcome.definition}</p></div>)}
        </div></section>
        <section><h2>我们期待你</h2><ul>
          <li>有从多个客户需求中抽象共性、建立产品边界的真实经验。</li>
          <li>完整经历过从机会判断、MVP 到客户验证的产品化闭环。</li>
          <li>能够用事实和取舍推动跨角色团队达成复杂决策。</li>
        </ul></section>
        <aside className="jd-preferred"><strong>加分项</strong><p>有企业服务、平台产品或行业解决方案产品化经验；同行业背景不是硬门槛。</p></aside>
        <footer className="jd-document-footer"><span>本 JD 由画像澄清 Agent 根据用人经理确认内容生成</span><strong>版本 v0.4 · 待发布</strong></footer>
      </article>
    </div>
  );
}

function JobDefinition({ expandedScenario, setExpandedScenario, onOpenEvidence }) {
  return (
    <article className="profile-document-new">
      <section className="document-section first-section">
        <div className="document-section-heading">
          <span>02</span><div><h2>成功标准</h2><p>从入职结果反推岗位任务，而不是从旧 JD 复制职责。</p></div>
        </div>
        <div className="outcome-list">
          {roleProfile.outcomes.map((outcome) => (
            <div className="outcome-row" key={outcome.id}>
              <div className="outcome-time"><small>{outcome.id}</small><strong>{outcome.horizon}</strong></div>
              <div className="outcome-main">
                <div><h3>{outcome.title}</h3><span className={`profile-status ${outcome.tone}`}>{outcome.status}</span></div>
                <p>{outcome.definition}</p>
                <div className="measure-list">{outcome.measures.map((measure) => <span key={measure}>{measure}</span>)}</div>
              </div>
              <EvidenceLinks ids={outcome.evidence} onOpenEvidence={onOpenEvidence} compact />
            </div>
          ))}
        </div>
      </section>

      <section className="document-section">
        <div className="document-section-heading">
          <span>03</span><div><h2>关键工作场景</h2><p>聚焦最影响成功、最能区分候选人的真实工作。</p></div>
        </div>
        <div className="scenario-list">
          {roleProfile.scenarios.map((scenario) => {
            const expanded = expandedScenario === scenario.id;
            return (
              <div className={`scenario-row ${expanded ? 'expanded' : ''}`} key={scenario.id}>
                <button className="scenario-summary" onClick={() => setExpandedScenario(expanded ? null : scenario.id)}>
                  <span className="item-code">{scenario.id}</span>
                  <span><strong>{scenario.title}</strong><small>{scenario.frequency}</small></span>
                  <span className="outcome-map">{scenario.outcomes.join(' · ')}</span>
                  <ChevronDown size={16} />
                </button>
                {expanded && (
                  <div className="scenario-detail">
                    <DefinitionItem label="触发情境" value={scenario.trigger} />
                    <DefinitionItem label="关键动作" value={scenario.actions} />
                    <DefinitionItem label="主要产出" value={scenario.output} />
                    <DefinitionItem label="核心挑战" value={scenario.challenge} />
                    <DefinitionItem label="协作对象" value={scenario.stakeholders} />
                    <div className="detail-evidence"><span>依据</span><EvidenceLinks ids={scenario.evidence} onOpenEvidence={onOpenEvidence} compact /></div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="document-section">
        <div className="document-section-heading">
          <span>04</span><div><h2>权责边界与资源</h2><p>避免把“产品负责人”写成没有权限的项目协调人。</p></div>
        </div>
        <div className="boundary-grid">
          <div><h3>需要负责</h3>{roleProfile.boundaries.owns.map((item) => <p key={item}><Check size={13} />{item}</p>)}</div>
          <div><h3>不直接负责</h3>{roleProfile.boundaries.notOwns.map((item) => <p key={item}><X size={13} />{item}</p>)}</div>
          <div className="boundary-wide"><h3>决策权限</h3><p>{roleProfile.boundaries.decisionRights}</p></div>
          <div className="boundary-wide"><h3>协作资源</h3><p>{roleProfile.boundaries.resources}</p></div>
        </div>
      </section>
    </article>
  );
}

function TalentSpecification({ expandedRequirement, setExpandedRequirement, onOpenEvidence }) {
  return (
    <article className="profile-document-new">
      <div className="supply-callout">
        <BarChart3 size={18} />
        <div><strong>人才供给提醒</strong><p>同时硬筛“3 年同行业”和“平台产品落地”会使可触达样本降至约 13%。本画像将同行业经验定义为加分项，以相似复杂度和产品化结果作为替代证据。</p></div>
        <button onClick={() => onOpenEvidence('E-06')}>查看证据 E-06</button>
      </div>

      <section className="document-section first-section">
        <div className="document-section-heading">
          <span>01</span><div><h2>人才规格矩阵</h2><p>每项要求均包含业务原因、强证据、替代证据和风险信号。</p></div>
        </div>
        <div className="requirement-list">
          <div className="requirement-head"><span>优先级</span><span>能力要求</span><span>对应任务</span><span>评估方式</span><span /></div>
          {roleProfile.requirements.map((requirement) => {
            const expanded = expandedRequirement === requirement.id;
            return (
              <div className={`requirement-row ${expanded ? 'expanded' : ''}`} key={requirement.id}>
                <button className="requirement-summary" onClick={() => setExpandedRequirement(expanded ? null : requirement.id)}>
                  <span className={`priority-label ${requirement.priority === 'Must-have' ? 'must' : 'preferred'}`}>{requirement.priority}</span>
                  <span><strong>{requirement.id} · {requirement.title}</strong><small>{requirement.level}</small></span>
                  <span>{requirement.mapping.join(' · ')}</span>
                  <span>{requirement.assessment}</span>
                  <ChevronDown size={16} />
                </button>
                {expanded && (
                  <div className="requirement-detail">
                    <DefinitionItem label="为什么需要" value={requirement.why} />
                    <DefinitionItem label="强证据" value={requirement.strongEvidence} tone="positive" />
                    <DefinitionItem label="可接受替代" value={requirement.substitute} />
                    <DefinitionItem label="风险信号" value={requirement.risk} tone="negative" />
                    <div className="detail-evidence"><span>依据</span><EvidenceLinks ids={requirement.evidence} onOpenEvidence={onOpenEvidence} compact /></div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </article>
  );
}

function SuccessScorecard({ expandedScore, setExpandedScore }) {
  return (
    <article className="profile-document-new">
      <section className="scorecard-overview">
        <div>
          <div className="section-eyebrow"><ListChecks size={15} />统一招聘判断</div>
          <h2>5 个维度，共 100 分</h2>
          <p>面试官必须记录岗位相关证据；“感觉不错”不作为评分依据。</p>
        </div>
        <div className="weight-legend">
          {roleProfile.scorecard.map((item, index) => <span key={item.id} style={{ width: `${item.weight}%` }} className={`weight-${index + 1}`}>{item.weight}%</span>)}
        </div>
      </section>

      <section className="document-section first-section scorecard-section">
        <div className="scorecard-list">
          <div className="scorecard-head"><span>维度与权重</span><span>评估方式</span><span>责任人</span><span>映射</span><span /></div>
          {roleProfile.scorecard.map((item) => {
            const expanded = expandedScore === item.id;
            return (
              <div className={`scorecard-row ${expanded ? 'expanded' : ''}`} key={item.id}>
                <button className="scorecard-summary" onClick={() => setExpandedScore(expanded ? null : item.id)}>
                  <span><em>{item.weight}%</em><strong>{item.id} · {item.dimension}</strong></span>
                  <span>{item.method}</span>
                  <span>{item.owner}</span>
                  <span>{item.mapsTo.join(' · ')}</span>
                  <ChevronDown size={16} />
                </button>
                {expanded && (
                  <div className="scorecard-detail">
                    <div className="scorecard-question"><span>核心题目</span><p>{item.prompt}</p><small>必须收集：{item.requiredEvidence}</small></div>
                    <div className="anchor-grid">
                      <div className="anchor-1"><span>1 分 · 不符合</span><p>{item.anchors[1]}</p></div>
                      <div className="anchor-3"><span>3 分 · 达到要求</span><p>{item.anchors[3]}</p></div>
                      <div className="anchor-5"><span>5 分 · 显著超出</span><p>{item.anchors[5]}</p></div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </article>
  );
}

function DefinitionItem({ label, value, tone = '' }) {
  return <div className={`definition-item ${tone}`}><span>{label}</span><p>{value}</p></div>;
}

function EvidenceLinks({ ids, onOpenEvidence, compact = false }) {
  return (
    <div className={`evidence-links ${compact ? 'compact' : ''}`}>
      {ids.map((id) => <button key={id} onClick={() => onOpenEvidence(id)}>{id}<Link2 size={11} /></button>)}
    </div>
  );
}

function EvidenceDrawer({ evidence, onClose }) {
  return (
    <div className="drawer-layer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="evidence-drawer">
        <div className="drawer-header">
          <div><span className="drawer-kicker">证据详情</span><h2>{evidence.title}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="关闭证据"><X size={18} /></button>
        </div>
        <div className="evidence-id-row"><span>{evidence.id}</span><em className={evidence.conflict ? 'conflict' : ''}>{evidence.status}</em></div>
        <div className="evidence-meta">
          <div><span>资料类型</span><strong>{evidence.type}</strong></div>
          <div><span>来源</span><strong>{evidence.source}</strong></div>
          <div><span>获取时间</span><strong>{evidence.time}</strong></div>
        </div>
        <div className="evidence-quote"><span>原始内容</span><blockquote>“{evidence.quote}”</blockquote></div>
        {evidence.conflict && (
          <div className="conflict-note"><AlertTriangle size={17} /><div><strong>发现信息冲突</strong><p>{evidence.conflict}</p></div></div>
        )}
        <div className="support-block"><span>支持画像字段</span><div>{evidence.supports.map((item) => <button key={item}>{item}<ChevronRight size={13} /></button>)}</div></div>
        <div className="drawer-trace"><span><CheckCircle2 size={15} />来源与原文已保留</span><span><ShieldCheck size={15} />人工确认后写入正式画像</span></div>
      </aside>
    </div>
  );
}

function CreateRoleModal({ onClose, onSubmit }) {
  return (
    <div className="modal-layer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="create-modal" onSubmit={onSubmit}>
        <div className="modal-header">
          <ClarifierMark size={40} plate />
          <div><h2>新建岗位澄清</h2><p>一个具体招聘需求对应一条持续会话。</p></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </div>
        <label><span>招聘岗位</span><input name="roleName" placeholder="例如：企业产品经理" autoFocus required /></label>
        <label><span>所属团队</span><input name="team" placeholder="例如：企业服务产品部" /></label>
        <label><span>为什么现在需要招聘</span><textarea name="reason" placeholder="描述当前业务问题、变化或不招聘的影响即可…" rows={3} /></label>
        <div className="auto-fetch-panel">
          <div><Sparkles size={16} /><strong>创建后自动准备</strong></div>
          <span>组织背景</span><span>旧 JD</span><span>历史案例</span><span>人才供给</span>
        </div>
        <div className="modal-actions">
          <button type="button" className="quiet-button" onClick={onClose}>取消</button>
          <button type="submit" className="primary-action">创建并开始澄清<ChevronRight size={16} /></button>
        </div>
      </form>
    </div>
  );
}

export default App;
