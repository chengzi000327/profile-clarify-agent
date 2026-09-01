import { useEffect, useMemo, useRef, useState } from 'react';
import { evidenceById } from './data.js';
import { api, ApiError } from './api/client.js';
import { roleProfileAction } from './profile-content.js';
import LoginScreen from './components/LoginScreen.jsx';
import HcApprovalLanding from './components/HcApprovalLanding.jsx';
import ClarifierMark from './components/ClarifierMark.jsx';
import EmptyWorkspace from './components/workbench/EmptyWorkspace.jsx';
import WorkbenchShell from './components/workbench/WorkbenchShell.jsx';
import { useAgentRun } from './hooks/useAgentRun.js';
import { toRoleCard } from './workbench/presentation.js';

function App() {
  const [actor, setActor] = useState(null);
  const [booting, setBooting] = useState(true);
  const [hcApprovals, setHcApprovals] = useState([]);
  const [hcLoading, setHcLoading] = useState(false);
  const [hcError, setHcError] = useState('');
  const [landingMode, setLandingMode] = useState(true);
  const [roleSessions, setRoleSessions] = useState([]);
  const [activeRoleId, setActiveRoleId] = useState(null);
  const [newConversationMode, setNewConversationMode] = useState(false);
  const [roleDetail, setRoleDetail] = useState(null);
  const [roleDetailLoading, setRoleDetailLoading] = useState(false);
  const [roleDetailError, setRoleDetailError] = useState('');
  const [roleDetailReloadKey, setRoleDetailReloadKey] = useState(0);
  const [activeView, setActiveView] = useState('conversation');
  const [evidenceId, setEvidenceId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [clarificationPolicy, setClarificationPolicy] = useState(null);
  const [requestError, setRequestError] = useState('');
  const [adminTestRole, setAdminTestRole] = useState('MANAGER');
  const activeRoleIdRef = useRef(activeRoleId);
  const {
    events: agentEvents,
    status: agentStatus,
    setStatus: setAgentStatus,
    connect: connectAgentRun,
    stop: stopAgentRun,
    reset: resetAgentRun,
  } = useAgentRun(api.streamAgentRun);
  const effectiveActorRole = actor?.role === 'ADMIN' ? adminTestRole : actor?.role;
  const viewerRole = effectiveActorRole === 'HR' ? 'hr' : 'manager';
  const canCreateRole = effectiveActorRole === 'MANAGER';
  const testRoleParam = actor?.role === 'ADMIN' ? adminTestRole : undefined;
  const conversationActor = actor?.role === 'ADMIN'
    ? {
        ...actor,
        role: effectiveActorRole,
        display_name: effectiveActorRole === 'HR' ? 'HR 测试身份' : '用人经理测试身份',
      }
    : actor;

  const activeRole = useMemo(
    () => newConversationMode
      ? undefined
      : roleSessions.find((role) => role.id === activeRoleId) ?? roleSessions[0],
    [roleSessions, activeRoleId, newConversationMode],
  );
  const evidence = evidenceId ? evidenceById[evidenceId] : null;

  useEffect(() => {
    activeRoleIdRef.current = activeRoleId;
  }, [activeRoleId]);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        const session = await api.me();
        if (cancelled) return;
        setActor(session.actor);
        setActiveView('hc');
        await loadHcApprovals(cancelled);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) setRequestError(error.message);
      } finally {
        if (!cancelled) setBooting(false);
      }
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!actor || !activeRoleId) {
      setRoleDetail(null);
      setRoleDetailLoading(false);
      setRoleDetailError('');
      return;
    }
    let cancelled = false;
    setRoleDetail(null);
    setRoleDetailLoading(true);
    setRoleDetailError('');
    Promise.all([
      api.getRoleSession(activeRoleId),
      api.getMessages(activeRoleId),
    ])
      .then(([detail, conversation]) => {
        if (!cancelled) {
          setRoleDetail(detail);
          setMessages(conversation.items);
          setClarificationPolicy(conversation.policy);
        }
      })
      .catch((error) => {
        if (!cancelled) setRoleDetailError(error.message || '岗位详情加载失败');
      })
      .finally(() => {
        if (!cancelled) setRoleDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [actor, activeRoleId, roleDetailReloadKey]);

  async function loadRoleSessions(cancelled = false, preferredRoleId = null) {
    const [result, hcResult] = await Promise.all([
      api.listRoleSessions(),
      api.listHcApprovals(),
    ]);
    if (cancelled) return;
    setHcApprovals(hcResult.items);
    const linkedRoleIds = new Set(
      hcResult.items.map((hc) => hc.role_session_id).filter(Boolean),
    );
    const cards = result.items
      .filter((role) => linkedRoleIds.has(role.id))
      .map(toRoleCard);
    setRoleSessions(cards);
    setActiveRoleId((current) => {
      if (preferredRoleId && cards.some((item) => item.id === preferredRoleId)) return preferredRoleId;
      return cards.some((item) => item.id === current) ? current : cards[0]?.id ?? null;
    });
    if (cards.length === 0) setNewConversationMode(true);
  }

  async function loadHcApprovals(cancelled = false) {
    setHcLoading(true);
    setHcError('');
    try {
      const result = await api.listHcApprovals();
      if (!cancelled) setHcApprovals(result.items);
    } catch (error) {
      if (!cancelled) setHcError(error.message || 'HC 审批读取失败');
      throw error;
    } finally {
      if (!cancelled) setHcLoading(false);
    }
  }

  async function handleLogin(credentials) {
    const session = await api.login(credentials);
    setActor(session.actor);
    setActiveView('hc');
    setLandingMode(true);
    setNewConversationMode(false);
    setRequestError('');
    setAdminTestRole('MANAGER');
    await loadHcApprovals();
  }

  async function handleLogout() {
    stopAgentRun();
    await api.logout();
    setActor(null);
    setHcApprovals([]);
    setHcError('');
    setLandingMode(true);
    setRoleSessions([]);
    setActiveRoleId(null);
    setNewConversationMode(false);
    setRoleDetail(null);
    setMessages([]);
    setClarificationPolicy(null);
    setActiveView('conversation');
  }

  async function handleOpenHc(requestId) {
    setHcError('');
    try {
      const result = await api.openHcWorkspace(requestId);
      const roleId = result.role.state.id;
      const conversation = await api.getMessages(roleId);
      await loadRoleSessions(false, roleId);
      setNewConversationMode(false);
      setActiveRoleId(roleId);
      setRoleDetail(result.role);
      setMessages(conversation.items);
      setClarificationPolicy(conversation.policy);
      setActiveView('conversation');
      setLandingMode(false);
    } catch (error) {
      setHcError(error.message || '岗位澄清会话打开失败');
      throw error;
    }
  }

  function openHcLanding() {
    resetAgentRun();
    setLandingMode(true);
    setActiveRoleId(null);
    setRoleDetail(null);
    setMessages([]);
    setClarificationPolicy(null);
    setActiveView('hc');
    setRequestError('');
    loadHcApprovals().catch(() => {});
  }

  function chooseRole(roleId, nextView = 'conversation') {
    resetAgentRun();
    setNewConversationMode(false);
    setActiveRoleId(roleId);
    setActiveView(nextView);
    setEvidenceId(null);
    setRoleDetail(null);
    setMessages([]);
    setClarificationPolicy(null);
  }

  function handleAdminTestRoleChange(nextRole) {
    resetAgentRun();
    setAdminTestRole(nextRole);
    setRequestError('');
    if (nextRole === 'HR' && roleSessions.length > 0) {
      setNewConversationMode(false);
      setActiveRoleId((current) => current ?? roleSessions[0].id);
    }
  }

  function startNewConversation() {
    if (!canCreateRole) {
      setRequestError('HR 身份不创建岗位会话，请从左侧选择已通过 HC 审批的岗位。');
      return;
    }
    resetAgentRun();
    setNewConversationMode(true);
    setActiveRoleId(null);
    setRoleDetail(null);
    setMessages([]);
    setClarificationPolicy(null);
    setActiveView('conversation');
    setRequestError('');
  }

  async function refreshActiveRole(roleId = activeRoleId) {
    if (!roleId) return;
    const [detail] = await Promise.all([
      api.getRoleSession(roleId),
      loadRoleSessions(false),
    ]);
    if (activeRoleIdRef.current !== roleId) return;
    setRoleDetail(detail);
  }

  async function refreshConversation(roleId = activeRoleId) {
    if (!roleId) return;
    const conversation = await api.getMessages(roleId);
    if (activeRoleIdRef.current !== roleId) return;
    setMessages(conversation.items);
    setClarificationPolicy(conversation.policy);
  }

  function connectRun(runInfo, roleId = activeRoleId) {
    connectAgentRun(runInfo, {
      roleId,
      refreshRole: refreshActiveRole,
      refreshConversation,
      reportError: setRequestError,
    });
  }

  async function sendMessage(content) {
    if (!activeRoleId) return;
    setRequestError('');
    try {
      const run = await api.sendMessage(activeRoleId, content, roleDetail?.state.revision, testRoleParam);
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
      const result = await api.startIntake(content, testRoleParam);
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
    const action = type === 'ROLE_PROFILE' ? roleProfileAction(latest) : null;
    try {
      if (action?.kind === 'confirm' || (!action && latest?.status === 'DRAFT')) {
        await api.confirmArtifact(
          activeRoleId,
          latest.id,
          latest.content_hash,
          roleDetail.state.revision,
          testRoleParam,
        );
        await refreshActiveRole();
      } else {
        const run = await api.generateArtifact(activeRoleId, type, testRoleParam);
        connectRun(run);
      }
    } catch (error) {
      setRequestError(error.message);
    }
  }

  if (booting) {
    return <div className="app-loading"><ClarifierMark size={46} plate /><span>正在加载岗位澄清…</span></div>;
  }

  if (!actor) return <LoginScreen onLogin={handleLogin} />;

  if (landingMode) {
    return (
      <HcApprovalLanding
        actor={actor}
        approvals={hcApprovals}
        loading={hcLoading}
        error={hcError}
        activeView={activeView}
        onOpenHc={handleOpenHc}
        onOpenApprovals={() => setActiveView('hc')}
        onOpenProfile={() => setActiveView('profile')}
        onOpenTrace={() => setActiveView('admin-trace')}
        onLogout={handleLogout}
      />
    );
  }

  if (!activeRole) {
    return (
      <EmptyWorkspace
        actor={actor}
        displayActor={conversationActor}
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
        adminTestRole={adminTestRole}
        onAdminTestRoleChange={handleAdminTestRoleChange}
        canCreateRole={canCreateRole}
      />
    );
  }

  return (
    <WorkbenchShell
      identity={{
        actor,
        conversationActor,
        effectiveActorRole,
        viewerRole,
        adminTestRole,
      }}
      workspace={{
        activeRole,
        activeView,
        requestError,
        roleDetail,
        roleDetailLoading,
        roleDetailError,
        evidence,
        agentEvents,
        agentStatus,
        messages,
        clarificationPolicy,
      }}
      actions={{
        openHcLanding,
        handleAdminTestRoleChange,
        setActiveView,
        handleLogout,
        setRequestError,
        setEvidenceId,
        sendMessage,
        extendClarification,
        setRoleDetailReloadKey,
        handleArtifactAction,
      }}
    />
  );
}

export default App;
