import { useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  BriefcaseBusiness,
  History,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  X,
} from 'lucide-react';
import AdminTraceConsole from '../AdminTraceConsole.jsx';
import ClarifierMark from '../ClarifierMark.jsx';
import EvidenceDrawer from '../profile/EvidenceDrawer.jsx';
import ProfileView from '../profile/ProfileView.jsx';
import {
  actorRoleLabel,
  displayInitial,
} from '../../workbench/presentation.js';
import AdminTestRoleSwitch from './AdminTestRoleSwitch.jsx';
import { ConversationView } from './ConversationView.jsx';

export default function WorkbenchShell({ identity, workspace, actions }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const {
    actor,
    conversationActor,
    effectiveActorRole,
    viewerRole,
    adminTestRole,
  } = identity;
  const {
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
  } = workspace;
  const {
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
  } = actions;
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

        <button className="new-project-button" onClick={openHcLanding}>
          <BriefcaseBusiness size={17} />
          {!sidebarCollapsed && <span>返回选择 HC</span>}
        </button>

        {actor.role === 'ADMIN' && !sidebarCollapsed && (
          <AdminTestRoleSwitch value={adminTestRole} onChange={handleAdminTestRoleChange} />
        )}

        {!sidebarCollapsed && <div className="sidebar-section-title"><span>当前会话</span></div>}
        <nav className="role-session-list current-role-session-list" aria-label="当前岗位澄清会话">
          <button
            className="role-session-row active"
            type="button"
            onClick={() => setActiveView('conversation')}
            title={`${activeRole.name} · ${activeRole.stage}`}
          >
            <span className="session-icon"><MessageSquare size={15} /></span>
            {!sidebarCollapsed && (
              <span className="role-session-copy">
                <span className="role-session-title"><strong>{activeRole.name}</strong><small>{activeRole.updatedAt}</small></span>
                <span className="role-session-meta"><em className={activeRole.stageTone}>{activeRole.stage}</em><i>·</i><small>{activeRole.meta}</small></span>
              </span>
            )}
          </button>
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
              <span className={`avatar avatar-${viewerRole}`}>{displayInitial(actor.display_name, effectiveActorRole)}</span>
            {!sidebarCollapsed && (
              <span className="user-copy">
                <strong>{actor.display_name}</strong>
                <small>{actor.role === 'ADMIN' ? `管理员测试 · ${actorRoleLabel[effectiveActorRole]}` : actorRoleLabel[actor.role]}</small>
              </span>
            )}
            {!sidebarCollapsed && <MoreHorizontal size={16} />}
          </button>
          {profileMenuOpen && !sidebarCollapsed && (
            <div className="profile-popover">
              <strong>后端身份已验证</strong>
              <span>{actor.role === 'ADMIN' ? '当前仅切换 Agent 测试视角，真实审计身份仍为企业管理员。' : '权限来自签名 HttpOnly Session，不能通过前端参数切换。'}</span>
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
              <span className={`avatar avatar-${viewerRole}`} title={`${conversationActor.display_name} · ${actorRoleLabel[effectiveActorRole]}`}>
                {displayInitial(conversationActor.display_name, effectiveActorRole)}
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
          <AdminTraceConsole />
        ) : activeView === 'conversation' ? (
          <ConversationView
            activeRole={activeRole}
            onOpenEvidence={setEvidenceId}
            onOpenProfile={() => setActiveView('profile')}
            onSend={sendMessage}
            onExtend={extendClarification}
            agentEvents={agentEvents}
            agentStatus={agentStatus}
            actor={conversationActor}
            messages={messages}
            policy={clarificationPolicy}
          />
        ) : (
          <ProfileView
            key={viewerRole}
            viewerRole={viewerRole}
            actualActorRole={actor.role}
            onOpenEvidence={setEvidenceId}
            roleDetail={roleDetail}
            loading={roleDetailLoading}
            error={roleDetailError}
            onRetry={() => setRoleDetailReloadKey((value) => value + 1)}
            onArtifactAction={handleArtifactAction}
            agentStatus={agentStatus}
          />
        )}
      </main>

      {evidence && <EvidenceDrawer evidence={evidence} onClose={() => setEvidenceId(null)} />}
    </div>
  );
}
