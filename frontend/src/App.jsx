import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  traceRows,
  versions,
} from './data.js';
import { api, ApiError } from './api/client.js';
import LoginScreen from './components/LoginScreen.jsx';
import { Composer, LiveAgentRun } from './components/AgentConversation.jsx';
import AdminTraceConsole from './components/AdminTraceConsole.jsx';

const sourceIcons = {
  org: Users,
  doc: FileText,
  people: Users,
  database: Database,
};

const stagePresentation = {
  CREATED: ['待同步背景', 'active'],
  CONTEXT_SYNCING: ['正在同步背景', 'active'],
  REASON_CLARIFYING: ['招聘原因澄清', 'active'],
  SUCCESS_CLARIFYING: ['成功标准澄清', 'active'],
  PROFILE_DRAFT: ['画像待确认', 'active'],
  PROFILE_CONFIRMED: ['画像已确认', 'confirmed'],
  ASSESSMENT_DRAFT: ['评估方案待确认', 'active'],
  ASSESSMENT_CONFIRMED: ['评估方案已确认', 'confirmed'],
  JD_DRAFT: ['JD 待确认', 'active'],
  JD_CONFIRMED: ['JD 已确认', 'confirmed'],
  HR_BRIEF_DRAFT: ['HR 画像待确认', 'active'],
  HR_BRIEF_CONFIRMED: ['HR 画像已确认', 'confirmed'],
  RECRUITING: ['招聘进行中', 'confirmed'],
  CALIBRATION_OBSERVING: ['校准观察期', 'calibrating'],
  CALIBRATION_HR_REVIEW: ['等待 HR 审核', 'calibrating'],
  CALIBRATION_MANAGER_REVIEW: ['等待经理校准', 'calibrating'],
  READY_TO_PUBLISH: ['发布准备完成', 'confirmed'],
  ARCHIVED: ['已归档', 'confirmed'],
};

const actorRoleLabel = {
  MANAGER: '用人经理',
  HR: 'HR 招聘负责人',
  ADMIN: '企业管理员 · 最高权限',
};

function displayInitial(name, role) {
  const value = String(name ?? '').trim();
  if (value) return Array.from(value)[0];
  return role === 'ADMIN' ? '管' : role === 'HR' ? 'HR' : '用';
}

function privateMessagesForActor(items, actorId) {
  return (items ?? []).filter((message) => message.conversation_user_id === actorId);
}

function toRoleCard(state) {
  const [stage, stageTone] = stagePresentation[state.stage] ?? [state.stage, 'active'];
  const latestProfile = state.latest_artifacts?.ROLE_PROFILE;
  return {
    id: state.id,
    name: state.title,
    team: state.department,
    stage,
    stageTone,
    meta: state.hc_status === 'APPROVED' ? 'HC 已审批' : 'HC 待审批',
    version: latestProfile ? `画像 v${latestProfile.version}` : '未生成画像',
    updatedAt: new Date(state.updated_at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }),
    unread: 0,
    apiState: state,
  };
}

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
  const [actor, setActor] = useState(null);
  const [booting, setBooting] = useState(true);
  const [roleSessions, setRoleSessions] = useState([]);
  const [activeRoleId, setActiveRoleId] = useState(null);
  const [newConversationMode, setNewConversationMode] = useState(false);
  const [roleDetail, setRoleDetail] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeView, setActiveView] = useState('conversation');
  const [evidenceId, setEvidenceId] = useState(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [selectedOutcome, setSelectedOutcome] = useState('diagnosis');
  const [outcomeConfirmed, setOutcomeConfirmed] = useState(false);
  const [agentEvents, setAgentEvents] = useState([]);
  const [agentStatus, setAgentStatus] = useState('idle');
  const [messages, setMessages] = useState([]);
  const [clarificationPolicy, setClarificationPolicy] = useState(null);
  const [requestError, setRequestError] = useState('');
  const streamStopRef = useRef(null);
  const actorIdRef = useRef(null);
  const viewerRole = actor?.role === 'ADMIN' ? 'admin' : actor?.role === 'HR' ? 'hr' : 'manager';

  useEffect(() => {
    actorIdRef.current = actor?.user_id ?? null;
  }, [actor]);

  const activeRole = useMemo(
    () => newConversationMode
      ? undefined
      : roleSessions.find((role) => role.id === activeRoleId) ?? roleSessions[0],
    [roleSessions, activeRoleId, newConversationMode],
  );
  const evidence = evidenceId ? evidenceById[evidenceId] : null;

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        const session = await api.me();
        if (cancelled) return;
        setActor(session.actor);
        await loadRoleSessions(cancelled);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) setRequestError(error.message);
      } finally {
        if (!cancelled) setBooting(false);
      }
    }
    bootstrap();
    return () => {
      cancelled = true;
      streamStopRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (!actor || !activeRoleId) return;
    let cancelled = false;
    setMessages([]);
    setAgentEvents([]);
    setAgentStatus('idle');
    Promise.all([
      api.getRoleSession(activeRoleId),
      api.getMessages(activeRoleId),
    ])
      .then(([detail, conversation]) => {
        if (!cancelled) {
          setRoleDetail(detail);
          setMessages(privateMessagesForActor(conversation.items, actor.user_id));
          setClarificationPolicy(conversation.policy);
        }
      })
      .catch((error) => {
        if (!cancelled) setRequestError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [actor, activeRoleId, activeView]);

  async function loadRoleSessions(cancelled = false, preferredRoleId = null) {
    const result = await api.listRoleSessions();
    if (cancelled) return;
    const cards = result.items.map(toRoleCard);
    setRoleSessions(cards);
    setActiveRoleId((current) => {
      if (preferredRoleId && cards.some((item) => item.id === preferredRoleId)) return preferredRoleId;
      return cards.some((item) => item.id === current) ? current : cards[0]?.id ?? null;
    });
    if (cards.length === 0) setNewConversationMode(true);
  }

  async function handleLogin(credentials) {
    const session = await api.login(credentials);
    streamStopRef.current?.();
    setMessages([]);
    setAgentEvents([]);
    setAgentStatus('idle');
    setClarificationPolicy(null);
    setActor(session.actor);
    setActiveView('conversation');
    setNewConversationMode(false);
    setRequestError('');
    await loadRoleSessions();
  }

  async function handleLogout() {
    streamStopRef.current?.();
    await api.logout();
    setActor(null);
    setRoleSessions([]);
    setActiveRoleId(null);
    setNewConversationMode(false);
    setRoleDetail(null);
    setMessages([]);
    setAgentEvents([]);
    setAgentStatus('idle');
    setClarificationPolicy(null);
    setProfileMenuOpen(false);
    setActiveView('conversation');
  }

  function chooseRole(roleId) {
    setNewConversationMode(false);
    setActiveRoleId(roleId);
    setActiveView('conversation');
    setEvidenceId(null);
    setMessages([]);
    setClarificationPolicy(null);
    setAgentEvents([]);
    setAgentStatus('idle');
    setOutcomeConfirmed(false);
  }

  function startNewConversation() {
    streamStopRef.current?.();
    setNewConversationMode(true);
    setActiveRoleId(null);
    setRoleDetail(null);
    setMessages([]);
    setClarificationPolicy(null);
    setAgentEvents([]);
    setAgentStatus('idle');
    setActiveView('conversation');
    setRequestError('');
  }

  async function refreshActiveRole(roleId = activeRoleId) {
    if (!roleId) return;
    const [detail] = await Promise.all([
      api.getRoleSession(roleId),
      loadRoleSessions(false, roleId),
    ]);
    setRoleDetail(detail);
  }

  async function refreshConversation(roleId = activeRoleId) {
    if (!roleId) return;
    const actorId = actor?.user_id;
    if (!actorId) return;
    const conversation = await api.getMessages(roleId);
    if (actorIdRef.current !== actorId) return;
    setMessages(privateMessagesForActor(conversation.items, actorId));
    setClarificationPolicy(conversation.policy);
  }

  function connectRun(runInfo, roleId = activeRoleId) {
    streamStopRef.current?.();
    setAgentEvents([]);
    setAgentStatus('running');
    streamStopRef.current = api.streamAgentRun(
      runInfo.stream_url,
      (event) => {
        setAgentEvents((current) => [...current, event]);
        if (event.type === 'agent.status') setAgentStatus(event.payload.status);
        if (event.type === 'run.completed') {
          setAgentStatus('completed');
          Promise.all([refreshActiveRole(roleId), refreshConversation(roleId)])
            .catch((error) => setRequestError(error.message));
        }
        if (event.type === 'assistant.completed' || event.type === 'clarification.limit.reached') {
          refreshConversation(roleId).catch((error) => setRequestError(error.message));
        }
        if (event.type === 'run.failed') {
          setAgentStatus('failed');
          setRequestError(event.payload.message ?? 'Agent Run 失败');
          refreshConversation(roleId).catch(() => {});
        }
      },
      () => setAgentStatus((current) => current === 'running' ? 'reconnecting' : current),
    );
  }

  async function sendMessage(content) {
    if (!activeRoleId) return;
    setRequestError('');
    try {
      const run = await api.sendMessage(activeRoleId, content, roleDetail?.state.revision);
      setMessages((current) => current.some((item) => item.id === run.message.id)
        ? current
        : [...current, run.message]);
      connectRun(run);
    } catch (error) {
      setAgentStatus('failed');
      setRequestError(error.message);
    }
  }

  async function sendIntakeMessage(content) {
    setRequestError('');
    setAgentStatus('running');
    try {
      const result = await api.startIntake(content);
      const roleId = result.role.state.id;
      setNewConversationMode(false);
      setActiveRoleId(roleId);
      setRoleDetail(result.role);
      setMessages([result.message]);
      setActiveView('conversation');
      connectRun(result, roleId);
      Promise.all([
        loadRoleSessions(false, roleId),
        refreshConversation(roleId),
      ]).catch((error) => setRequestError(error.message));
    } catch (error) {
      setAgentStatus('failed');
      setRequestError(error.message);
    }
  }

  async function confirmPendingFacts(factIds) {
    if (!activeRoleId || !roleDetail || factIds.length === 0) return;
    setRequestError('');
    try {
      await api.confirmFacts(activeRoleId, factIds, roleDetail.state.revision);
      await refreshActiveRole();
    } catch (error) {
      setRequestError(error.message);
    }
  }

  async function extendClarification(reason) {
    if (!activeRoleId) return;
    try {
      const result = await api.extendClarification(activeRoleId, reason);
      setClarificationPolicy(result.policy);
      setRequestError('');
    } catch (error) {
      setRequestError(error.message);
    }
  }

  async function handleArtifactAction(type) {
    if (!activeRoleId || !roleDetail) return;
    const latest = roleDetail.state.latest_artifacts?.[type];
    try {
      if (latest?.status === 'DRAFT') {
        await api.confirmArtifact(
          activeRoleId,
          latest.id,
          latest.content_hash,
          roleDetail.state.revision,
        );
        await refreshActiveRole();
      } else {
        const run = await api.generateArtifact(activeRoleId, type);
        connectRun(run);
      }
    } catch (error) {
      setRequestError(error.message);
    }
  }

  if (booting) {
    return <div className="app-loading"><ClarifierMark size={46} plate /><span>正在加载岗位工作台…</span></div>;
  }

  if (!actor) return <LoginScreen onLogin={handleLogin} />;

  if (!activeRole) {
    return (
      <EmptyWorkspace
        actor={actor}
        activeView={activeView}
        roleSessions={roleSessions}
        agentEvents={agentEvents}
        agentStatus={agentStatus}
        requestError={requestError}
        onDismissError={() => setRequestError('')}
        onChooseRole={chooseRole}
        onSend={sendIntakeMessage}
        onOpenConversation={() => setActiveView('conversation')}
        onOpenTrace={() => setActiveView('admin-trace')}
        onStartNew={startNewConversation}
        onLogout={handleLogout}
      />
    );
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

        <button className="new-project-button" onClick={startNewConversation}>
          <Plus size={17} />
          {!sidebarCollapsed && (
            <span>{actor.role === 'HR'
              ? '开始岗位需求审核'
              : actor.role === 'ADMIN'
                ? '开始 Agent 测试对话'
                : '开始新岗位对话'}</span>
          )}
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
          {actor.role === 'ADMIN' && (
            <button className={`sidebar-utility ${activeView === 'admin-trace' ? 'active' : ''}`} title="Agent Trace 控制台" onClick={() => setActiveView('admin-trace')}>
              <BarChart3 size={17} />
              {!sidebarCollapsed && <span>Agent Trace 控制台</span>}
            </button>
          )}
          <button className="sidebar-utility" title="资料与权限">
            <Settings size={17} />
            {!sidebarCollapsed && <span>资料与权限</span>}
          </button>
          <button className="user-chip" onClick={() => setProfileMenuOpen((value) => !value)}>
            <span className={`avatar avatar-${viewerRole}`}>{displayInitial(actor.display_name, actor.role)}</span>
            {!sidebarCollapsed && (
              <span className="user-copy">
                <strong>{actor.display_name}</strong>
                <small>{actorRoleLabel[actor.role]}</small>
              </span>
            )}
            {!sidebarCollapsed && <MoreHorizontal size={16} />}
          </button>
          {profileMenuOpen && !sidebarCollapsed && (
            <div className="profile-popover">
              <strong>后端身份已验证</strong>
              <span>权限来自签名 HttpOnly Session，不能通过前端参数切换。</span>
              <div className="role-preview-switch">
                <button className="active" type="button">{actorRoleLabel[actor.role]}</button>
                <button type="button" onClick={handleLogout}>退出并切换账号</button>
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
              <span className={`avatar avatar-${viewerRole}`} title={`${actor.display_name} · ${actorRoleLabel[actor.role]}`}>
                {displayInitial(actor.display_name, actor.role)}
              </span>
              <button className="avatar avatar-add" aria-label="邀请协作者"><Plus size={13} /></button>
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
          {actor.role === 'ADMIN' && (
            <button className={activeView === 'admin-trace' ? 'active' : ''} onClick={() => setActiveView('admin-trace')}>
              Trace 控制台 <span className="tab-state">ADMIN</span>
            </button>
          )}
        </div>

        {requestError && <div className="workspace-error"><AlertTriangle size={14} />{requestError}<button onClick={() => setRequestError('')}><X size={13} /></button></div>}

        {activeView === 'admin-trace' && actor.role === 'ADMIN' ? (
          <AdminTraceConsole onPolicyUpdated={() => refreshConversation()} />
        ) : activeView === 'conversation' ? (
          <ConversationView
            activeRole={activeRole}
            onOpenEvidence={setEvidenceId}
            onOpenProfile={() => setActiveView('profile')}
            onSend={sendMessage}
            onExtend={extendClarification}
            agentEvents={agentEvents}
            agentStatus={agentStatus}
            actor={actor}
            messages={messages}
            policy={clarificationPolicy}
          />
        ) : (
          <ProfileView
            key={viewerRole}
            viewerRole={viewerRole}
            onOpenEvidence={setEvidenceId}
            onOpenConversation={() => setActiveView('conversation')}
            roleDetail={roleDetail}
            onArtifactAction={handleArtifactAction}
            onConfirmFacts={confirmPendingFacts}
            agentStatus={agentStatus}
          />
        )}
      </main>

      {evidence && <EvidenceDrawer evidence={evidence} onClose={() => setEvidenceId(null)} />}
    </div>
  );
}

function EmptyWorkspace({
  actor,
  activeView,
  roleSessions,
  agentEvents,
  agentStatus,
  requestError,
  onDismissError,
  onChooseRole,
  onSend,
  onOpenConversation,
  onOpenTrace,
  onStartNew,
  onLogout,
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  const viewerRole = actor.role === 'ADMIN' ? 'admin' : actor.role === 'HR' ? 'hr' : 'manager';
  const guidance = actor.role === 'HR'
    ? {
        sidebarAction: '开始岗位需求审核',
        emptyListHint: '在右侧和 Agent 一起审核',
        workspaceTitle: '新岗位需求审核',
        phaseLabel: '协助业务审核招聘需求',
        introTitle: '先帮业务把招聘需求审清楚',
        introDescription: '把业务方提出的岗位设想或招聘背景告诉 Agent。Agent 会协助你核对招聘原因、成功标准和岗位边界，标出证据缺口与待业务确认项。',
        policyLabel: '需求审核',
        policyStrong: '从业务问题开始',
        policyHint: '岗位身份、招聘理由和成功标准会在审核中逐项核对',
        greeting: `你好，${actor.display_name}。你可以把业务方提出的招聘需求交给我，我们先核对它要解决的业务问题是否清楚。`,
        prompt: '你可以直接说：“业务想招聘一位……，请帮我审核这项需求是否成立、还缺哪些信息。”我会边审边记录缺口，并整理需要用人经理确认的问题。',
        starterLabel: '你可以这样开始审核',
        starters: [
          {
            label: '审核一份业务招聘需求',
            message: '业务希望招聘一位新同事，请帮我从招聘原因、成功标准和岗位边界开始审核。',
          },
          {
            label: '招聘理由还不够清楚',
            message: '业务提出了招聘需求，但招聘理由还不够清楚，请帮我梳理还需要向用人经理确认哪些信息。',
          },
        ],
      }
    : actor.role === 'ADMIN'
      ? {
          sidebarAction: '开始 Agent 测试对话',
          emptyListHint: '在右侧验证 Agent 行为',
          workspaceTitle: 'Agent 测试对话',
          phaseLabel: '独立验证 Agent 行为',
          introTitle: '选择你要验证的 Agent 行为',
          introDescription: '企业管理员可以在这里独立测试岗位澄清与产物生成流程。经理和 HR 的真实会话不会显示在这里，请前往 Trace 控制台统一审计。',
          policyLabel: '管理员对话',
          policyStrong: '与业务会话隔离',
          policyHint: '这里只保存你与 Agent 的测试消息，不会混入经理或 HR 的对话',
          greeting: `你好，${actor.display_name}。你可以在这里测试 Agent 的澄清、追问和产物生成行为，或描述需要排查的流程问题。`,
          prompt: '如果要查看经理或 HR 的真实运行记录，请使用 Trace 控制台；这里不会展示他们的聊天内容。',
          starterLabel: '你可以这样开始验证',
          starters: [
            {
              label: '测试岗位澄清流程',
              message: '我要测试一条新的岗位澄清流程，请从岗位身份识别开始。',
            },
            {
              label: '检查 Agent 的追问行为',
              message: '我想检查 Agent 的主动澄清与追问是否符合规则，请从一个待识别岗位开始。',
            },
          ],
        }
    : {
        sidebarAction: '开始新岗位对话',
        emptyListHint: '直接在右侧和 Agent 聊聊',
        workspaceTitle: '新岗位对话',
        phaseLabel: '直接描述招聘需求',
        introTitle: '先聊聊你为什么想招人',
        introDescription: '不用先创建岗位或填写表单。直接描述业务问题，Agent 会在对话中识别岗位、补齐事实并逐步建立岗位画像。',
        policyLabel: '岗位建立',
        policyStrong: '从第一句话开始',
        policyHint: '岗位名称、团队和成功标准会在对话中逐步补全',
        greeting: `你好，${actor.display_name}。我们先从这次招聘要解决的业务问题聊起。`,
        prompt: '你可以直接说：“最近业务遇到了什么问题，所以想招什么样的人？”我会边聊边帮你建立岗位。',
        starterLabel: '你可以这样开始',
        starters: [
          {
            label: '有业务目标，但岗位还没想清楚',
            message: '我们有一个新的业务目标，但还不确定应该招聘什么岗位，你先帮我梳理一下。',
          },
          {
            label: '已经知道想招什么岗位',
            message: '我想招聘一位企业产品经理，请从招聘原因开始帮我澄清。',
          },
        ],
      };
  return (
    <div className="app-shell empty-workspace-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand">
            <ClarifierMark size={34} plate />
            <span className="brand-copy"><strong>画像澄清 Agent</strong><small>ROLE CLARIFIER</small></span>
          </div>
        </div>
        <button className="new-project-button" onClick={onStartNew}>
          <Plus size={17} /><span>{guidance.sidebarAction}</span>
        </button>
        <div className="sidebar-section-title">
          <span>最近会话</span>
          <div>
            <button className="icon-button tiny" aria-label="搜索会话"><Search size={15} /></button>
            <button className="icon-button tiny" aria-label="会话筛选"><SlidersHorizontal size={15} /></button>
          </div>
        </div>
        <nav className="role-session-list empty-role-session-list" aria-label="岗位澄清会话列表">
          {roleSessions.length === 0 ? (
            <div className="empty-session-list">
              <span className="session-icon"><MessageSquare size={15} /></span>
              <span><strong>还没有岗位会话</strong><small>{guidance.emptyListHint}</small></span>
            </div>
          ) : roleSessions.map((role) => (
            <button className="role-session-row" key={role.id} onClick={() => onChooseRole(role.id)}>
              <span className="session-icon"><MessageSquare size={15} /></span>
              <span className="role-session-copy">
                <span className="role-session-title"><strong>{role.name}</strong><small>{role.updatedAt}</small></span>
                <span className="role-session-meta"><em className={role.stageTone}>{role.stage}</em><i>·</i><small>{role.meta}</small></span>
              </span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          {actor.role === 'ADMIN' && (
            <button className={`sidebar-utility ${activeView === 'admin-trace' ? 'active' : ''}`} onClick={onOpenTrace}>
              <BarChart3 size={17} /><span>Agent Trace 控制台</span>
            </button>
          )}
          <button className="sidebar-utility" type="button">
            <Settings size={17} /><span>资料与权限</span>
          </button>
          <button className="user-chip" type="button" onClick={() => setProfileOpen((value) => !value)}>
            <span className={`avatar avatar-${viewerRole}`}>{displayInitial(actor.display_name, actor.role)}</span>
            <span className="user-copy"><strong>{actor.display_name}</strong><small>{actorRoleLabel[actor.role]}</small></span>
            <MoreHorizontal size={16} />
          </button>
          {profileOpen && (
            <div className="profile-popover">
              <strong>后端身份已验证</strong>
              <span>权限来自签名 HttpOnly Session，不能通过前端参数切换。</span>
              <div className="role-preview-switch">
                <button className="active" type="button">{actorRoleLabel[actor.role]}</button>
                <button type="button" onClick={onLogout}>退出并切换账号</button>
              </div>
            </div>
          )}
        </div>
      </aside>
      <main className="main-workspace empty-main-workspace">
        <header className="workspace-header">
          <div className="title-stack">
            <div className="title-line">
              <strong>{guidance.workspaceTitle}</strong>
              <span className="role-stage-badge empty">等待识别</span>
            </div>
            <div className="preset-line">
              <span className="preset-badge"><ClarifierMark size={16} />画像澄清 Agent</span>
              <span className="phase-dot" />
              <span>{guidance.phaseLabel}</span>
              <span className="phase-dot" />
              <span>未生成画像</span>
            </div>
          </div>
          <div className="header-actions">
            <div className="collaborators" aria-label="当前账号">
              <span className={`avatar avatar-${viewerRole}`} title={`${actor.display_name} · ${actorRoleLabel[actor.role]}`}>
                {displayInitial(actor.display_name, actor.role)}
              </span>
              <button className="avatar avatar-add" aria-label="邀请协作者" disabled><Plus size={13} /></button>
            </div>
            <button className="quiet-button" disabled><History size={15} />版本</button>
            <button className="icon-button" aria-label="更多操作" disabled><MoreHorizontal size={18} /></button>
          </div>
        </header>

        <div className="workspace-tabs">
          <button className={activeView === 'conversation' ? 'active' : ''} onClick={onOpenConversation}>对话</button>
          <button className="empty-disabled-tab" type="button" disabled>
            岗位画像 <span className="tab-state">未生成</span>
          </button>
          {actor.role === 'ADMIN' && (
            <button className={activeView === 'admin-trace' ? 'active' : ''} onClick={onOpenTrace}>
              Trace 控制台 <span className="tab-state">ADMIN</span>
            </button>
          )}
        </div>

        {requestError && <div className="workspace-error"><AlertTriangle size={14} />{requestError}<button onClick={onDismissError}><X size={13} /></button></div>}

        {activeView === 'admin-trace' && actor.role === 'ADMIN' ? (
          <AdminTraceConsole />
        ) : (
          <section className="conversation-surface real-conversation empty-conversation">
            <div className="conversation-scroll">
              <div className="transcript">
                <div className="session-intro">
                  <ClarifierMark size={40} plate />
                  <div>
                    <h1>{guidance.introTitle}</h1>
                    <p>{guidance.introDescription}</p>
                  </div>
                </div>

                <div className="conversation-policy-strip empty-policy-strip">
                  <span><CircleDot size={13} />{guidance.policyLabel} <strong>{guidance.policyStrong}</strong></span>
                  <span>{guidance.policyHint}</span>
                </div>

                <div className="message message-agent empty-onboarding-message">
                  <span className="agent-avatar"><ClarifierMark size={25} /></span>
                  <div className="message-body">
                    <div className="message-label">画像澄清 Agent</div>
                    <p>{guidance.greeting}</p>
                    <p>{guidance.prompt}</p>
                    <div className="empty-chat-starters">
                      <span><Sparkles size={14} />{guidance.starterLabel}</span>
                      {guidance.starters.map((starter) => (
                        <button key={starter.label} type="button" onClick={() => onSend(starter.message)}>{starter.label}</button>
                      ))}
                    </div>
                  </div>
                </div>
                {(agentStatus === 'running' || agentStatus === 'reconnecting') && (
                  <LiveAgentRun events={agentEvents} status={agentStatus} />
                )}
              </div>
            </div>
            <Composer onSend={onSend} pending={agentStatus === 'running' || agentStatus === 'reconnecting'} />
          </section>
        )}
      </main>
    </div>
  );
}

function ConversationView({
  activeRole,
  onOpenProfile,
  onSend,
  onExtend,
  agentEvents,
  agentStatus,
  actor,
  messages,
  policy,
}) {
  const scrollRef = useRef(null);
  const budget = policy ? policy.initial_budget + policy.granted_rounds : 6;
  const visibleMessages = useMemo(
    () => privateMessagesForActor(messages, actor.user_id),
    [messages, actor.user_id],
  );

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [visibleMessages, agentEvents]);

  return (
    <section className="conversation-surface real-conversation">
      <div className="conversation-scroll" ref={scrollRef}>
        <div className="transcript">
          <div className="session-intro">
            <ClarifierMark size={40} plate />
            <div>
              <h1>{activeRole.name}岗位澄清</h1>
              <p>{actor.role === 'ADMIN'
                ? '这里只展示你与 Agent 的对话；经理和 HR 的对话请在 Trace 控制台中审计。'
                : '这里只展示你与 Agent 的对话；其他协作成员的消息不会出现在这里。'}</p>
            </div>
            <button className="conversation-profile-link" onClick={onOpenProfile}>查看岗位画像<ChevronRight size={14} /></button>
          </div>

          <div className="conversation-policy-strip">
            <span><CircleDot size={13} />主动澄清 <strong>{policy?.opened_rounds ?? 0} / {budget} 轮</strong></span>
            <span>{policy?.status === 'LIMIT_REACHED' ? '已停止主动追问，正常对话仍可继续' : 'Agent会围绕尚未确认的岗位关键问题主动追问'}</span>
          </div>

          {visibleMessages.length === 0 && (
            <div className="conversation-empty-state">
              <ClarifierMark size={34} plate />
              <strong>开始真实岗位对话</strong>
              <p>{actor.display_name}，请补充招聘原因、成功标准或希望Agent协助判断的问题。消息发送后会立即保存。</p>
            </div>
          )}

          {visibleMessages.map((message) => {
            if (message.sender_type === 'HUMAN') {
              const roleLabel = message.sender_role === 'MANAGER' ? '用人经理' : message.sender_role === 'HR' ? 'HR' : '企业管理员';
              return (
                <div className={`message message-user human-${message.sender_role?.toLowerCase()}`} key={message.id}>
                  <div className="message-label">{message.sender_name} · {roleLabel}</div>
                  <div className="user-bubble">{message.content}</div>
                </div>
              );
            }
            if (message.sender_type === 'SYSTEM') {
              return <div className="conversation-system-message" key={message.id}><AlertTriangle size={13} />{message.content}</div>;
            }
            const structured = message.structured_content ?? {};
            return (
              <div className="message message-agent persisted-agent-message" key={message.id}>
                <span className="agent-avatar"><ClarifierMark size={25} /></span>
                <div className="message-body">
                  <div className="message-label">画像澄清 Agent · 已保存</div>
                  {message.content.split('\n').filter(Boolean).map((paragraph, index) => <p key={`${message.id}-${index}`}>{paragraph}</p>)}
                  {structured.question && (
                    <div className="persisted-question">
                      <span><CircleDot size={13} />第 {structured.round_ordinal} / {structured.budget} 轮主动澄清</span>
                      <strong>{structured.question}</strong>
                      <small>这条问题只会出现在你与 Agent 的对话中，你可以直接在下方回答。</small>
                    </div>
                  )}
                  {structured.kind === 'CLARIFICATION_LIMIT' && (
                    <div className="persisted-limit-action">
                      <span>主动澄清预算已用完</span>
                      <button onClick={() => onExtend('当前岗位仍有关键问题需要继续澄清')}>增加 {policy?.extension_size ?? 2} 轮</button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {agentEvents.length > 0 && agentStatus !== 'completed' && (
            <LiveAgentRun events={agentEvents} status={agentStatus} />
          )}
        </div>
      </div>
      <Composer
        onSend={onSend}
        onExtend={onExtend}
        pending={agentStatus === 'running'}
        policy={policy}
      />
    </section>
  );
}

function LegacyConversationView({
  activeRole,
  selectedOutcome,
  setSelectedOutcome,
  outcomeConfirmed,
  setOutcomeConfirmed,
  onOpenEvidence,
  onOpenProfile,
  onSend,
  agentEvents,
  agentStatus,
}) {
  const isPrimaryDemo = activeRole.id === 'role-enterprise-pm' || Boolean(activeRole.apiState);
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
        <Composer onSend={onSend} pending={agentStatus === 'running'} />
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

          {agentEvents.length > 0 && (
            <LiveAgentRun events={agentEvents} status={agentStatus} />
          )}

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
      <Composer onSend={onSend} pending={agentStatus === 'running'} />
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

const artifactStatusLabel = (status) => ({
  DRAFT: '草稿待确认',
  CONFIRMED: '已确认',
  INVALIDATED: '已失效',
}[status] ?? '尚未生成');

const assessmentMethodLabel = (type) => ({
  STRUCTURED_BEHAVIORAL_INTERVIEW: '结构化行为面试',
  WORK_SAMPLE: '工作样本',
  CASE_EXERCISE: '案例演练',
  PORTFOLIO_REVIEW: '作品集评审',
  TECHNICAL_INTERVIEW: '专业面试',
  ROLE_PLAY: '角色扮演',
}[type] ?? type ?? '待定义');

const publicFieldValue = (field, fallback = '待确认') => field?.value ?? fallback;

const factCategoryLabels = {
  BACKGROUND: '业务背景',
  HIRING_REASON: '招聘原因',
  SUCCESS_CRITERION: '成功标准',
  CONSTRAINT: '岗位约束',
};

function ArtifactEmptyState({ title, description, invalidated = false }) {
  return (
    <div className="profile-empty-document embedded-artifact-empty">
      <span className="profile-empty-icon">{invalidated ? <AlertTriangle size={24} /> : <FileSearch size={24} />}</span>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}

function ProfileView({ viewerRole, onOpenEvidence, onOpenConversation, roleDetail, onArtifactAction, onConfirmFacts, agentStatus }) {
  const [section, setSection] = useState(viewerRole === 'hr' || viewerRole === 'admin' ? 'portrait' : 'basis');
  const [expandedScenario, setExpandedScenario] = useState(null);
  const [expandedRequirement, setExpandedRequirement] = useState(null);
  const [expandedScore, setExpandedScore] = useState(null);
  const state = roleDetail?.state;
  const profileArtifact = state?.latest_artifacts?.ROLE_PROFILE;
  const assessmentArtifact = state?.latest_artifacts?.ASSESSMENT_SCORECARD;
  const jdArtifact = state?.latest_artifacts?.PUBLIC_JD;
  const recruitingArtifact = state?.latest_artifacts?.HR_RECRUITING_BRIEF;
  const hcApproval = state?.hc_approval;
  const profile = profileArtifact?.content;
  const pendingFacts = (state?.facts ?? []).filter((fact) => fact.status === 'DRAFT');
  const pendingFactSignature = pendingFacts.map((fact) => `${fact.id}:${fact.category}`).join('|');
  const [selectedPendingFactIds, setSelectedPendingFactIds] = useState([]);
  const confirmedCategories = new Set(
    (state?.facts ?? [])
      .filter((fact) => fact.status === 'CONFIRMED')
      .map((fact) => fact.category),
  );
  const confirmedFactSignature = [...confirmedCategories].sort().join('|');
  const profileReady = confirmedCategories.has('HIRING_REASON')
    && confirmedCategories.has('SUCCESS_CRITERION');
  const canConfirmFacts = viewerRole === 'manager' || viewerRole === 'admin';

  useEffect(() => {
    const latestRecommendedByCategory = new Map();
    pendingFacts.forEach((fact) => {
      if (
        ['HIRING_REASON', 'SUCCESS_CRITERION', 'CONSTRAINT'].includes(fact.category)
        && !confirmedCategories.has(fact.category)
      ) {
        latestRecommendedByCategory.set(fact.category, fact.id);
      }
    });
    setSelectedPendingFactIds([...latestRecommendedByCategory.values()]);
  }, [state?.id, pendingFactSignature, confirmedFactSignature]);

  if (!profileArtifact) {
    const stageLabel = stagePresentation[state?.stage]?.[0] ?? '岗位澄清中';
    const roleIdentified = Boolean(state?.title && state.title !== '待识别岗位');
    return (
      <section className="profile-surface redesigned-profile empty-profile-surface">
        <div className="profile-page profile-page-wide">
          <div className="profile-heading profile-heading-rich">
            <div>
              <div className="document-kicker"><FileSearch size={15} />岗位画像 · 未生成</div>
              <h1>{state?.title ?? '待识别岗位'}</h1>
              <div className="profile-meta-line">
                <span>{state?.department ?? '待确认团队'}</span><i>·</i><span>{stageLabel}</span>
              </div>
            </div>
          </div>

          <div className="profile-empty-document">
            <span className="profile-empty-icon"><FileSearch size={24} /></span>
            <h2>岗位画像尚未生成</h2>
            <p>
              {pendingFacts.length > 0
                ? `Agent 已提取 ${pendingFacts.length} 条事实草稿。请在下方核对并人工确认，确认后才会用于生成岗位画像。`
                : roleIdentified
                ? '当前只建立了待招岗位。请先在对话中确认招聘原因和成功标准；画像草稿生成后，这里才会展示真实岗位内容。'
                : 'Agent 还在识别岗位名称和所属团队。请先继续对话；画像草稿生成后，这里才会展示真实岗位内容。'}
            </p>
            <div className="profile-readiness-list" aria-label="岗位画像生成条件">
              <span className={roleIdentified ? 'ready' : ''}>{roleIdentified ? <Check size={13} /> : <CircleDot size={13} />}岗位身份</span>
              <span className={confirmedCategories.has('HIRING_REASON') ? 'ready' : ''}>{confirmedCategories.has('HIRING_REASON') ? <Check size={13} /> : <CircleDot size={13} />}招聘原因</span>
              <span className={confirmedCategories.has('SUCCESS_CRITERION') ? 'ready' : ''}>{confirmedCategories.has('SUCCESS_CRITERION') ? <Check size={13} /> : <CircleDot size={13} />}成功标准</span>
            </div>

            {hcApproval && (
              <div className={`empty-profile-hc-context ${hcApproval.status.toLowerCase()}`}>
                <div>
                  <span>HC {hcApproval.status === 'APPROVED' ? '已审批' : hcApproval.status === 'REJECTED' ? '已驳回' : '审批中'}</span>
                  <strong>{hcApproval.approval_id}</strong>
                  <small>{hcApproval.synthetic ? 'Mock HRIS' : hcApproval.source_system}</small>
                </div>
                <p>{hcApproval.hiring_reason}</p>
              </div>
            )}

            {pendingFacts.length > 0 && (
              <div className="empty-profile-fact-review">
                <div className="empty-profile-fact-review-heading">
                  <div>
                    <strong>{pendingFacts.length} 条事实待确认</strong>
                    <span>确认后会成为岗位画像的正式依据</span>
                  </div>
                  <CircleDot size={17} />
                </div>
                <div className="empty-profile-fact-list">
                  {pendingFacts.map((fact) => (
                    <label className="empty-profile-fact-item" key={fact.id}>
                      <input
                        checked={selectedPendingFactIds.includes(fact.id)}
                        disabled={!canConfirmFacts}
                        type="checkbox"
                        onChange={() => setSelectedPendingFactIds((current) => current.includes(fact.id)
                          ? current.filter((id) => id !== fact.id)
                          : [...current, fact.id])}
                      />
                      <span>{factCategoryLabels[fact.category] ?? fact.category}</span>
                      <p>{fact.statement}</p>
                    </label>
                  ))}
                </div>
                {!canConfirmFacts && (
                  <small>当前身份可查看事实草稿，需由用人经理或企业管理员确认。</small>
                )}
              </div>
            )}
            <button
              className="primary-action"
              disabled={agentStatus === 'running' || (!profileReady && canConfirmFacts && pendingFacts.length > 0 && selectedPendingFactIds.length === 0)}
              onClick={() => {
                if (profileReady) {
                  onArtifactAction?.('ROLE_PROFILE');
                  return;
                }
                if (selectedPendingFactIds.length > 0 && canConfirmFacts) {
                  onConfirmFacts?.(selectedPendingFactIds);
                  return;
                }
                onOpenConversation?.();
              }}
            >
              {agentStatus === 'running'
                ? 'Agent 生成中…'
                : profileReady
                  ? '生成岗位画像草稿'
                : pendingFacts.length > 0 && canConfirmFacts
                  ? `确认已选的 ${selectedPendingFactIds.length} 条事实`
                  : '返回对话继续澄清'}
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </section>
    );
  }
  const publicBasics = state?.public_job_basics ?? {};
  const basicInfo = [
    { label: '所属团队', value: state?.department ?? '待确认', confirmed: Boolean(state?.department) },
    { label: '招聘类型', value: '待确认', confirmed: false },
    { label: '职级', value: publicFieldValue(publicBasics.level), confirmed: Boolean(publicBasics.level) },
    { label: '汇报对象', value: publicFieldValue(publicBasics.reporting_line), confirmed: Boolean(publicBasics.reporting_line) },
    { label: '工作地点', value: publicFieldValue(publicBasics.location), confirmed: Boolean(publicBasics.location) },
    { label: '雇佣类型', value: publicFieldValue(publicBasics.employment_type), confirmed: Boolean(publicBasics.employment_type) },
    { label: '薪酬范围', value: publicFieldValue(publicBasics.compensation, '按权限可见'), restricted: !publicBasics.compensation },
    { label: 'HC 状态', value: state?.hc_status === 'APPROVED' ? '已审批' : '待审批', confirmed: state?.hc_status === 'APPROVED' },
  ];

  const allProfileTabs = [
    { id: 'portrait', label: '招聘画像', meta: recruitingArtifact ? `v${recruitingArtifact.version} · ${artifactStatusLabel(recruitingArtifact.status)}` : '尚未生成' },
    { id: 'basis', label: '画像依据', meta: `v${profileArtifact.version} · ${artifactStatusLabel(profileArtifact.status)}` },
    { id: 'assessment', label: '评估方案', meta: assessmentArtifact ? `${assessmentArtifact.content?.dimensions?.length ?? 0} 个维度` : '尚未生成' },
    { id: 'jd', label: '对外 JD', meta: jdArtifact ? `v${jdArtifact.version} · ${artifactStatusLabel(jdArtifact.status)}` : '尚未生成' },
  ];
  const profileTabs = viewerRole === 'hr' || viewerRole === 'admin' ? allProfileTabs : allProfileTabs.filter((item) => item.id !== 'portrait');
  const primaryActionLabel = section === 'jd'
    ? '确认并交给 HR 发布'
    : section === 'assessment'
      ? '确认评估方案'
      : section === 'portrait'
        ? '保存 HR 招聘策略'
        : '确认画像依据';
  const artifactType = section === 'jd'
    ? 'PUBLIC_JD'
    : section === 'assessment'
      ? 'ASSESSMENT_SCORECARD'
      : section === 'portrait'
        ? 'HR_RECRUITING_BRIEF'
        : 'ROLE_PROFILE';
  const latestArtifact = roleDetail?.state?.latest_artifacts?.[artifactType];
  const connectedActionLabel = latestArtifact?.status === 'DRAFT'
    ? primaryActionLabel
    : latestArtifact?.status === 'CONFIRMED'
      ? '生成新版本'
      : latestArtifact?.status === 'INVALIDATED'
        ? '基于最新事实重新生成'
        : `生成${section === 'jd' ? ' JD' : '草稿'}`;
  const decisionSteps = ['招聘原因与成功标准', '岗位画像', '评估方案', '对外 JD'];
  const currentDecisionStep = section === 'assessment' ? 2 : section === 'jd' ? 3 : 1;

  return (
    <section className="profile-surface redesigned-profile">
      <div className="profile-page profile-page-wide">
        <div className="profile-heading profile-heading-rich">
          <div>
            <div className="document-kicker"><FileSearch size={15} />招聘识别画像 · v{profileArtifact.version} · {artifactStatusLabel(profileArtifact.status)}</div>
            <h1>{state?.title ?? '待识别岗位'}</h1>
            <div className="profile-meta-line">
              <span className={state?.hc_status === 'APPROVED' ? 'approved-inline' : ''}><CheckCircle2 size={12} />HC {state?.hc_status === 'APPROVED' ? '已审批' : '待审批'}</span><i>·</i><span>{state?.department ?? '待确认团队'}</span>
            </div>
          </div>
          <div className="profile-heading-actions">
            <button className="quiet-button"><History size={15} />查看版本</button>
            <button
              className="primary-action"
              disabled={agentStatus === 'running'}
              onClick={() => onArtifactAction?.(artifactType)}
            >
              {agentStatus === 'running' ? 'Agent 生成中…' : connectedActionLabel}<ChevronRight size={16} />
            </button>
          </div>
        </div>

        <div className="portrait-basic-strip" aria-label="招聘基本信息">
          {basicInfo.map((item) => (
            <div key={item.label} className={item.confirmed ? 'confirmed' : item.restricted ? 'restricted' : ''}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>

        <div className={`profile-permission-note ${viewerRole}`}>
          <ShieldCheck size={13} />
          <span>{viewerRole === 'admin' ? '企业管理员最高权限：可查看和处理企业内全部岗位、内部画像、产物与审计记录。' : viewerRole === 'hr' ? 'HR 权限：可查看内部寻源策略、候选人判断规则和全部协作产物。' : '用人经理权限：可确认画像依据、评估方案和对外 JD；HR 内部寻源策略不可见。'}</span>
        </div>

        {profileArtifact.status === 'INVALIDATED' && (
          <div className="profile-sync-notice stale">
            <AlertTriangle size={15} />
            <div><strong>当前岗位画像已失效</strong><span>会话中的已确认事实发生了变化。此版本仅供回看，请基于最新事实重新生成，评估方案、JD 和 HR 招聘画像也不能继续沿用。</span></div>
          </div>
        )}
        {profileArtifact.status !== 'INVALIDATED' && pendingFacts.length > 0 && (
          <div className="profile-sync-notice pending">
            <CircleDot size={15} />
            <div><strong>会话中有 {pendingFacts.length} 条待确认事实尚未进入当前画像</strong><span>当前页面只使用已确认事实生成。请在此核对并确认，再生成新版本，避免把未确认信息误写入正式画像。</span></div>
            {(viewerRole === 'manager' || viewerRole === 'admin') && <button disabled={agentStatus === 'running'} onClick={() => onConfirmFacts?.(pendingFacts.map((fact) => fact.id))}>确认这些事实</button>}
          </div>
        )}

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
          {section === 'portrait' && <RecruitingPortrait artifact={recruitingArtifact} profile={profile} />}
          {section === 'basis' && (
            <ProfileBasis
              state={state}
              profile={profile}
              assessment={assessmentArtifact?.content}
              expandedScenario={expandedScenario}
              setExpandedScenario={setExpandedScenario}
              expandedRequirement={expandedRequirement}
              setExpandedRequirement={setExpandedRequirement}
              onOpenEvidence={onOpenEvidence}
            />
          )}
          {section === 'assessment' && (
            <SuccessScorecard
              artifact={assessmentArtifact}
              expandedScore={expandedScore}
              setExpandedScore={setExpandedScore}
            />
          )}
          {section === 'jd' && <JDPreview jd={jdArtifact} state={state} />}
        </div>
      </div>
    </section>
  );
}

function buildRecruitingPortrait(artifact, profile) {
  const content = artifact?.content;
  if (!content) return null;
  const nonTarget = content.resume_screen?.non_target_signals ?? [];
  return {
    version: artifact.version,
    status: artifact.status,
    candidateDefinition: content.target_candidate_summary,
    approvedContext: {
      evidence: [
        ...(profile?.mission?.hiring_reason_fact_refs ?? []),
        ...(profile?.mission?.success_criterion_fact_refs ?? []),
      ],
      coreProblem: profile?.mission?.statement ?? '岗位使命尚未形成',
    },
    sourcingBrief: {
      targetTypes: (content.target_types ?? []).map((item, index) => ({
        code: String.fromCharCode(65 + index),
        title: item.label,
        why: item.fit_rationale,
        check: [...(item.requirement_refs ?? []), ...(item.work_refs ?? [])].join(' · '),
      })),
      query: content.search_strategy?.boolean_query ?? '',
      titles: content.search_strategy?.titles ?? [],
      keywords: (content.search_strategy?.keyword_groups ?? []).flatMap((group) => group.keywords ?? []),
      nonTarget: nonTarget.map((item) => `${item.signal}：${item.reason}`),
    },
    resumeScreening: {
      decision: '简历未写明时进入电话核实，不因信息缺失直接淘汰。',
      coreSignals: (content.resume_screen?.thirty_second_checks ?? []).map((item, index) => ({
        id: `S-${String(index + 1).padStart(2, '0')}`,
        title: item.criterion,
        required: true,
        lookFor: item.evidence_to_find ?? [],
        notEnough: '未发现时标记待核实，不直接拒绝。',
      })),
      rules: nonTarget.map((item) => ({
        label: item.action === 'VERIFY' ? '需要核实' : 'HR 复核',
        condition: `${item.signal}：${item.reason}`,
        tone: 'review',
      })),
    },
    phoneScreen: (content.phone_questions ?? []).map((item) => ({
      question: item.prompt,
      listenFor: item.evidence_to_collect?.join('；') ?? '',
      risk: `追问：${item.probes?.join('；') ?? '无'}`,
    })),
    marketContext: content.market_context,
    calibrationWatchpoints: content.calibration_watchpoints ?? [],
    openQuestions: content.open_questions ?? [],
  };
}

function RecruitingPortrait({ artifact, profile }) {
  const portrait = buildRecruitingPortrait(artifact, profile);
  if (!portrait) {
    return <ArtifactEmptyState title="HR 招聘画像尚未生成" description="请先确认岗位画像和评估方案，再生成与当前会话一致的寻源、简历初筛和电话筛选策略。" />;
  }

  return (
    <article className="profile-document-new recruiting-portrait-card action-portrait">
      <section className="action-portrait-hero">
        <div className="action-hero-heading">
          <div><Target size={15} /><span>今天就按这句话找人</span></div>
          <button disabled><CheckCircle2 size={12} />来自当前岗位画像 v{portrait.version}</button>
        </div>
        <h2>{portrait.candidateDefinition}</h2>
        <p><strong>业务要解决：</strong>{portrait.approvedContext.coreProblem}</p>
      </section>

      <section className="action-section sourcing-action-section">
        <ActionSectionHeading number="01" title="先去这些人里找" description={`${portrait.sourcingBrief.targetTypes.length} 类优先来源，每一类都给出简历检查点。`} />
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
        <ActionSectionHeading number="03" title={`电话初筛就问这 ${portrait.phoneScreen.length} 个问题`} description="每个问题都配有应听到的证据和追问方向。" />
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
          <ActionSectionHeading number="04" title="校准观察点" description="达到样本门槛后再用真实候选人信号发起 HR 复核，不把演示数据当成事实。" />
          <div><span className="demo-data-label">{portrait.marketContext?.note ?? '人才库状态未知'}</span></div>
        </div>
        <div className="calibration-watchpoint-list">
          {portrait.calibrationWatchpoints.map((item, index) => (
            <div key={`${item.signal}-${index}`}>
              <CircleDot size={13} />
              <div><strong>{item.signal}</strong><p>触发条件：至少 {item.trigger_rule.minimum_candidates} 位候选人、{item.trigger_rule.minimum_channels} 个渠道，同一信号重复 {item.trigger_rule.repeated_signal_count} 次；关联 {item.requirement_refs.join(' · ')}。</p></div>
            </div>
          ))}
        </div>
        {portrait.openQuestions.length > 0 && <div className="artifact-open-questions"><AlertTriangle size={14} /><div><strong>待 HR 补充</strong>{portrait.openQuestions.map((question) => <p key={question}>{question}</p>)}</div></div>}
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

function ProfileBasis({ state, profile, assessment, expandedScenario, setExpandedScenario, expandedRequirement, setExpandedRequirement, onOpenEvidence }) {
  const [basisView, setBasisView] = useState('job');
  return (
    <div className="profile-basis-wrap">
      <div className="basis-switchbar">
        <button className={basisView === 'job' ? 'active' : ''} onClick={() => setBasisView('job')}>招聘原因与成功标准</button>
        <button className={basisView === 'talent' ? 'active' : ''} onClick={() => setBasisView('talent')}>岗位画像 · 人才要求</button>
      </div>
      {basisView === 'job' ? (
        <>
          <HiringReasonDecision state={state} profile={profile} onOpenEvidence={onOpenEvidence} />
          <JobDefinition state={state} profile={profile} expandedScenario={expandedScenario} setExpandedScenario={setExpandedScenario} onOpenEvidence={onOpenEvidence} />
        </>
      ) : (
        <TalentSpecification profile={profile} assessment={assessment} expandedRequirement={expandedRequirement} setExpandedRequirement={setExpandedRequirement} onOpenEvidence={onOpenEvidence} />
      )}
    </div>
  );
}

function HiringReasonDecision({ state, profile, onOpenEvidence }) {
  const factGroups = [
    ['业务背景', 'BACKGROUND'],
    ['招聘原因', 'HIRING_REASON'],
    ['成功标准', 'SUCCESS_CRITERION'],
    ['约束条件', 'CONSTRAINT'],
  ].map(([label, category]) => ({
    label,
    category,
    items: (state?.facts ?? []).filter((fact) => fact.category === category),
  }));
  const evidenceRefs = [...new Set(factGroups.flatMap((group) => group.items.flatMap((fact) => fact.evidence_refs ?? [])))];
  return (
    <section className="hiring-reason-decision">
      <div className="hiring-boundary-note"><ShieldCheck size={14} /><span><strong>数据边界：</strong>本页内容来自当前会话的岗位事实与岗位画像产物；草稿事实会展示状态，但不会被当作已确认依据。</span></div>
      <div className="hiring-reason-heading">
        <div><span>01</span><div><h2>为什么新增这个编制</h2><p>把招聘原因说清楚，后续岗位画像、评估方案和 JD 才不会发生偏移。</p></div></div>
        <EvidenceLinks ids={evidenceRefs} onOpenEvidence={onOpenEvidence} compact />
      </div>
      <div className="dynamic-fact-grid">
        {factGroups.map((group) => (
          <div key={group.category}>
            <span>{group.label}</span>
            {group.items.length > 0
              ? group.items.map((fact) => <p key={fact.id}><em className={fact.status === 'CONFIRMED' ? 'confirmed' : 'draft'}>{fact.status === 'CONFIRMED' ? '已确认' : '待确认'}</em>{fact.statement}<small>{fact.source}</small></p>)
              : <p className="empty-fact">当前会话尚未形成</p>}
          </div>
        ))}
      </div>
      <div className="reason-impact-decision">
        <div><Sparkles size={15} /><p><strong>岗位使命：</strong>{profile?.mission?.statement ?? '尚未生成岗位使命'}</p></div>
        <span className="profile-fact-source">引用 {(profile?.mission?.hiring_reason_fact_refs?.length ?? 0) + (profile?.mission?.success_criterion_fact_refs?.length ?? 0)} 条已确认事实</span>
      </div>
    </section>
  );
}

function JDPreview({ jd, state }) {
  const content = jd?.content;
  if (!content) {
    return <ArtifactEmptyState title="对外 JD 尚未生成" description="请先确认岗位画像和评估方案，并补齐可公开的工作地点、雇佣类型等基础字段。" />;
  }
  const responsibilities = content.what_you_will_do ?? [];
  const capabilities = (content.what_we_look_for ?? []).map((item) => ({
    title: item,
    description: '',
  }));
  const basics = content?.title_and_basics;

  return (
    <div className="jd-preview-shell">
      <div className="jd-toolbar">
        <div><span className="jd-output-badge"><FileText size={12} />候选人版</span><strong>对外 JD · {artifactStatusLabel(jd?.status)}</strong><span>内容来自当前会话的正式产物</span></div>
        <div className="jd-toolbar-actions"><button className="quiet-button"><FileText size={14} />复制 JD</button></div>
      </div>
      {jd?.status === 'INVALIDATED' && <div className="artifact-inline-warning"><AlertTriangle size={14} />此 JD 的上游岗位事实或画像已变化，请重新生成后再发布。</div>}
      <article className="jd-document">
        <header>
          <span>{basics?.department ?? state?.department} · {basics?.location}</span>
          <h1>{basics?.title ?? state?.title}</h1>
          <div className="jd-facts">{[basics?.employment_type, basics?.level, basics?.work_mode, basics?.reporting_line ? `汇报给${basics.reporting_line}` : null].filter(Boolean).map((item) => <span key={item}>{item}</span>)}</div>
        </header>
        <section className="jd-about-role">
          <h2>关于岗位</h2>
          <p>{content.about_the_role}</p>
        </section>
        <section><h2>你会做什么</h2><ol className="jd-responsibility-list">
          {responsibilities.map((item) => <li key={item}>{item}</li>)}
        </ol></section>
        <section><h2>我们希望你具备</h2><div className="jd-capability-list">
          {capabilities.map((capability) => <div key={capability.title}><strong>{capability.title}</strong>{capability.description && <p>{capability.description}</p>}</div>)}
        </div></section>
        <footer className="jd-document-footer"><span>候选人版预览 · 仅包含可公开字段</span><strong>版本 v{jd?.version} · {artifactStatusLabel(jd?.status)}</strong></footer>
      </article>
    </div>
  );
}

function JobDefinition({ state, profile, expandedScenario, setExpandedScenario, onOpenEvidence }) {
  const facts = state?.facts ?? [];
  const factById = new Map(facts.map((fact) => [fact.id, fact]));
  const successFacts = facts.filter((fact) => fact.category === 'SUCCESS_CRITERION');
  const work = profile?.work ?? [];
  const boundaries = profile?.boundaries ?? {};
  return (
    <article className="profile-document-new">
      <section className="document-section first-section">
        <div className="document-section-heading">
          <span>02</span><div><h2>成功标准</h2><p>从入职结果反推岗位任务，而不是从旧 JD 复制职责。</p></div>
        </div>
        <div className="outcome-list">
          {successFacts.map((fact, index) => (
            <div className="outcome-row" key={fact.id}>
              <div className="outcome-time"><small>SC-{String(index + 1).padStart(2, '0')}</small><strong>{fact.status === 'CONFIRMED' ? '已确认' : '待确认'}</strong></div>
              <div className="outcome-main">
                <div><h3>{fact.statement}</h3><span className={`profile-status ${fact.status === 'CONFIRMED' ? '' : 'warning'}`}>{fact.status === 'CONFIRMED' ? '正式依据' : '不进入生成'}</span></div>
                <p>来源：{fact.source}</p>
                <div className="measure-list"><span>更新时间 {new Date(fact.updated_at).toLocaleDateString('zh-CN')}</span></div>
              </div>
              <EvidenceLinks ids={fact.evidence_refs ?? []} onOpenEvidence={onOpenEvidence} compact />
            </div>
          ))}
          {successFacts.length === 0 && <p className="section-empty-copy">当前会话尚未形成成功标准。</p>}
        </div>
      </section>

      <section className="document-section">
        <div className="document-section-heading">
          <span>03</span><div><h2>关键工作场景</h2><p>聚焦最影响成功、最能区分候选人的真实工作。</p></div>
        </div>
        <div className="scenario-list">
          {work.map((item) => {
            const expanded = expandedScenario === item.id;
            return (
              <div className={`scenario-row ${expanded ? 'expanded' : ''}`} key={item.id}>
                <button className="scenario-summary" onClick={() => setExpandedScenario(expanded ? null : item.id)}>
                  <span className="item-code">{item.id}</span>
                  <span><strong>{item.title}</strong><small>{item.description}</small></span>
                  <span className="outcome-map">{item.success_criterion_fact_refs?.join(' · ')}</span>
                  <ChevronDown size={16} />
                </button>
                {expanded && (
                  <div className="scenario-detail">
                    <DefinitionItem label="工作定义" value={item.description} />
                    <DefinitionItem label="主要产出" value={(item.deliverables ?? []).join('；')} />
                    <DefinitionItem label="对应成功标准" value={(item.success_criterion_fact_refs ?? []).map((id) => factById.get(id)?.statement ?? id).join('；')} />
                    <DefinitionItem label="其他依据" value={(item.other_fact_refs ?? []).map((id) => factById.get(id)?.statement ?? id).join('；') || '无'} />
                    <div className="detail-evidence"><span>事实引用</span><EvidenceLinks ids={[...(item.success_criterion_fact_refs ?? []), ...(item.other_fact_refs ?? [])]} onOpenEvidence={onOpenEvidence} compact /></div>
                  </div>
                )}
              </div>
            );
          })}
          {work.length === 0 && <p className="section-empty-copy">当前画像尚未定义关键工作。</p>}
        </div>
      </section>

      <section className="document-section">
        <div className="document-section-heading">
          <span>04</span><div><h2>权责边界与资源</h2><p>避免把“产品负责人”写成没有权限的项目协调人。</p></div>
        </div>
        <div className="boundary-grid">
          <BoundaryGroup title="需要负责" items={boundaries.owns} icon="check" />
          <BoundaryGroup title="不直接负责" items={boundaries.does_not_own} icon="cross" />
          <BoundaryGroup title="决策权限" items={boundaries.decision_rights} wide />
          <BoundaryGroup title="协作资源" items={boundaries.collaboration_and_resources} wide />
        </div>
        {(profile?.open_questions?.length ?? 0) > 0 && <div className="artifact-open-questions"><AlertTriangle size={14} /><div><strong>画像仍有开放问题</strong>{profile.open_questions.map((item) => <p key={item.field_path}>{item.question}<small>{item.reason}</small></p>)}</div></div>}
      </section>
    </article>
  );
}

function BoundaryGroup({ title, items = [], icon, wide = false }) {
  return (
    <div className={wide ? 'boundary-wide' : ''}>
      <h3>{title}</h3>
      {items.length > 0
        ? items.map((item, index) => <p key={`${item.statement}-${index}`}>{icon === 'check' ? <Check size={13} /> : icon === 'cross' ? <X size={13} /> : null}{item.statement}</p>)
        : <p className="empty-fact">当前会话尚未确认</p>}
    </div>
  );
}

function TalentSpecification({ profile, assessment, expandedRequirement, setExpandedRequirement, onOpenEvidence }) {
  const requirements = profile?.requirements ?? [];
  const dimensions = assessment?.dimensions ?? [];
  return (
    <article className="profile-document-new">
      <section className="document-section first-section">
        <div className="document-section-heading">
          <span>01</span><div><h2>人才规格矩阵</h2><p>每项要求均包含业务原因、强证据、替代证据和风险信号。</p></div>
        </div>
        <div className="requirement-list">
          <div className="requirement-head"><span>优先级</span><span>能力要求</span><span>对应任务</span><span>评估方式</span><span /></div>
          {requirements.map((requirement) => {
            const expanded = expandedRequirement === requirement.id;
            const mappedDimensions = dimensions.filter((dimension) => dimension.requirement_refs?.includes(requirement.id));
            return (
              <div className={`requirement-row ${expanded ? 'expanded' : ''}`} key={requirement.id}>
                <button className="requirement-summary" onClick={() => setExpandedRequirement(expanded ? null : requirement.id)}>
                  <span className={`priority-label ${requirement.priority === 'MUST_HAVE' ? 'must' : 'preferred'}`}>{requirement.priority === 'MUST_HAVE' ? 'Must-have' : 'Preferred'}</span>
                  <span><strong>{requirement.id} · {requirement.name}</strong><small>{requirement.level}</small></span>
                  <span>{requirement.work_refs?.join(' · ') || '事实依据'}</span>
                  <span>{mappedDimensions.length > 0 ? mappedDimensions.map((item) => assessmentMethodLabel(item.method?.type)).join(' · ') : '评估方案待生成'}</span>
                  <ChevronDown size={16} />
                </button>
                {expanded && (
                  <div className="requirement-detail">
                    <DefinitionItem label="为什么需要" value={requirement.rationale} />
                    <DefinitionItem label="强证据" value={requirement.strong_evidence?.join('；')} tone="positive" />
                    <DefinitionItem label="可接受替代" value={requirement.acceptable_alternatives?.join('；') || '无'} />
                    <DefinitionItem label="风险信号" value={requirement.risk_signals?.join('；')} tone="negative" />
                    <div className="detail-evidence"><span>依据</span><EvidenceLinks ids={[...(requirement.work_refs ?? []), ...(requirement.success_criterion_fact_refs ?? []), ...(requirement.constraint_fact_refs ?? [])]} onOpenEvidence={onOpenEvidence} compact /></div>
                  </div>
                )}
              </div>
            );
          })}
          {requirements.length === 0 && <p className="section-empty-copy">当前画像尚未形成人才要求。</p>}
        </div>
      </section>
    </article>
  );
}

function SuccessScorecard({ artifact, expandedScore, setExpandedScore }) {
  const scorecard = artifact?.content;
  if (!scorecard) {
    return <ArtifactEmptyState title="评估方案尚未生成" description="请先确认当前岗位画像，再生成结构化评估维度、题目、证据标准和评分锚点。" />;
  }
  const dimensions = scorecard.dimensions ?? [];
  const interviewPlan = scorecard.interview_plan ?? [];
  const totalWeight = dimensions.reduce((total, item) => total + item.weight, 0);
  return (
    <article className="profile-document-new">
      {artifact.status === 'INVALIDATED' && <div className="artifact-inline-warning"><AlertTriangle size={14} />此评估方案所依据的岗位画像已变化，请重新生成后再用于面试。</div>}
      <section className="scorecard-overview">
        <div>
          <div className="section-eyebrow"><ListChecks size={15} />统一招聘判断</div>
          <h2>{dimensions.length} 个维度，共 {totalWeight} 分</h2>
          <p>面试官必须记录岗位相关证据；“感觉不错”不作为评分依据。</p>
        </div>
        <div className="weight-legend">
          {dimensions.map((item, index) => <span key={item.id} style={{ width: `${item.weight}%` }} className={`weight-${(index % 5) + 1}`}>{item.weight}%</span>)}
        </div>
      </section>

      <section className="document-section first-section scorecard-section">
        <div className="scorecard-list">
          <div className="scorecard-head"><span>维度与权重</span><span>评估方式</span><span>责任人</span><span>映射</span><span /></div>
          {dimensions.map((item) => {
            const expanded = expandedScore === item.id;
            const owners = interviewPlan.filter((stage) => stage.dimension_refs?.includes(item.id)).map((stage) => stage.interviewer_role);
            return (
              <div className={`scorecard-row ${expanded ? 'expanded' : ''}`} key={item.id}>
                <button className="scorecard-summary" onClick={() => setExpandedScore(expanded ? null : item.id)}>
                  <span><em>{item.weight}%</em><strong>{item.id} · {item.name}</strong></span>
                  <span>{assessmentMethodLabel(item.method?.type)}</span>
                  <span>{owners.join(' · ') || '待分配'}</span>
                  <span>{[...(item.requirement_refs ?? []), ...(item.work_refs ?? [])].join(' · ')}</span>
                  <ChevronDown size={16} />
                </button>
                {expanded && (
                  <div className="scorecard-detail">
                    <div className="scorecard-question"><span>执行说明</span><p>{item.method?.instructions}</p></div>
                    {(item.questions ?? []).map((question, index) => <div className="scorecard-question" key={`${item.id}-q-${index}`}><span>核心题目 {index + 1}</span><p>{question.prompt}</p><small>追问：{question.probes?.join('；') || '无'}<br />必须收集：{question.evidence_to_collect?.join('；')}</small></div>)}
                    <div className="assessment-evidence-criteria"><DefinitionItem label="强证据" value={item.evidence_criteria?.strong_evidence?.join('；')} tone="positive" /><DefinitionItem label="可接受证据" value={item.evidence_criteria?.acceptable_evidence?.join('；')} /><DefinitionItem label="风险信号" value={item.evidence_criteria?.risk_signals?.join('；')} tone="negative" /></div>
                    <div className="anchor-grid">
                      <div className="anchor-1"><span>1 分 · 不符合</span><p>{item.anchors?.score_1}</p></div>
                      <div className="anchor-3"><span>3 分 · 达到要求</span><p>{item.anchors?.score_3}</p></div>
                      <div className="anchor-5"><span>5 分 · 显著超出</span><p>{item.anchors?.score_5}</p></div>
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
  return <div className={`definition-item ${tone}`}><span>{label}</span><p>{value || '尚未定义'}</p></div>;
}

function EvidenceLinks({ ids, onOpenEvidence, compact = false }) {
  const uniqueIds = [...new Set((ids ?? []).filter(Boolean))];
  const displayRef = (id) => id.length > 22 ? `${id.slice(0, 10)}…${id.slice(-6)}` : id;
  return (
    <div className={`evidence-links ${compact ? 'compact' : ''}`}>
      {uniqueIds.map((id) => evidenceById[id]
        ? <button key={id} onClick={() => onOpenEvidence(id)} title={id}>{displayRef(id)}<Link2 size={11} /></button>
        : <span key={id} title={id}>{displayRef(id)}<Link2 size={11} /></span>)}
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

export default App;
