import { useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CircleDot,
  History,
  MoreHorizontal,
  Plus,
  Settings,
  Sparkles,
  X,
} from 'lucide-react';
import { Composer, LiveAgentRun } from '../AgentConversation.jsx';
import AdminTraceConsole from '../AdminTraceConsole.jsx';
import ClarifierMark from '../ClarifierMark.jsx';
import {
  actorRoleLabel,
  displayInitial,
} from '../../workbench/presentation.js';
import AdminTestRoleSwitch from './AdminTestRoleSwitch.jsx';

export default function EmptyWorkspace({
  actor,
  displayActor,
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
  adminTestRole,
  onAdminTestRoleChange,
  canCreateRole,
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  const effectiveActorRole = actor.role === 'ADMIN' ? adminTestRole : actor.role;
  const viewerRole = effectiveActorRole === 'HR' ? 'hr' : 'manager';
  const recentRole = roleSessions[0] ?? null;
  return (
    <div className="app-shell empty-workspace-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand">
            <ClarifierMark size={34} plate />
            <span className="brand-copy"><strong>画像澄清 Agent</strong><small>ROLE CLARIFIER</small></span>
          </div>
        </div>
        <button className="new-project-button" onClick={onStartNew} disabled={!canCreateRole}>
          <Plus size={17} /><span>{canCreateRole ? '开始新岗位对话' : 'HR 查看获批岗位'}</span>
        </button>
        {actor.role === 'ADMIN' && (
          <AdminTestRoleSwitch value={adminTestRole} onChange={onAdminTestRoleChange} />
        )}
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
            <span className={`avatar avatar-${viewerRole}`}>{displayInitial(actor.display_name, effectiveActorRole)}</span>
            <span className="user-copy"><strong>{actor.display_name}</strong><small>{actor.role === 'ADMIN' ? `管理员测试 · ${actorRoleLabel[effectiveActorRole]}` : actorRoleLabel[actor.role]}</small></span>
            <MoreHorizontal size={16} />
          </button>
          {profileOpen && (
            <div className="profile-popover">
              <strong>后端身份已验证</strong>
              <span>{actor.role === 'ADMIN' ? '当前仅切换 Agent 测试视角，真实审计身份仍为企业管理员。' : '权限来自签名 HttpOnly Session，不能通过前端参数切换。'}</span>
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
              <strong>{canCreateRole ? '新岗位对话' : '已审批岗位'}</strong>
              <span className="role-stage-badge empty">{canCreateRole ? '等待识别' : '暂无岗位'}</span>
            </div>
            <div className="preset-line">
              <span className="preset-badge"><ClarifierMark size={16} />画像澄清 Agent</span>
              <span className="phase-dot" />
              <span>{canCreateRole ? '直接描述招聘需求' : '仅展示 HC 已审批岗位'}</span>
              <span className="phase-dot" />
              <span>未生成画像</span>
            </div>
          </div>
          <div className="header-actions">
            <div className="collaborators" aria-label="当前账号">
              <span className={`avatar avatar-${viewerRole}`} title={`${displayActor.display_name} · ${actorRoleLabel[effectiveActorRole]}`}>
                {displayInitial(displayActor.display_name, effectiveActorRole)}
              </span>
              <button className="avatar avatar-add" aria-label="邀请协作者" disabled><Plus size={13} /></button>
            </div>
            <button className="quiet-button" disabled><History size={15} />版本</button>
            <button className="icon-button" aria-label="更多操作" disabled><MoreHorizontal size={18} /></button>
          </div>
        </header>

        <div className="workspace-tabs">
          <button className={activeView === 'conversation' ? 'active' : ''} onClick={onOpenConversation}>对话</button>
          <button
            className={!recentRole ? 'empty-disabled-tab' : ''}
            type="button"
            disabled={!recentRole}
            onClick={() => recentRole && onChooseRole(recentRole.id, 'profile')}
            title={recentRole ? `查看${recentRole.name}岗位画像` : '当前还没有可查看的岗位画像'}
          >
            岗位画像 <span className="tab-state">{recentRole?.version ?? '未生成'}</span>
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
        ) : !canCreateRole ? (
          <section className="conversation-surface real-conversation empty-conversation hr-empty-workspace">
            <div className="conversation-scroll">
              <div className="transcript">
                <div className="session-intro">
                  <ClarifierMark size={40} plate />
                  <div>
                    <h1>当前没有可查看的已审批岗位</h1>
                    <p>HR 不在这里创建招聘需求。用人经理完成 HC 审批并进入岗位澄清后，该岗位会自动出现在同一会话列表中。</p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : (
          <section className="conversation-surface real-conversation empty-conversation">
            <div className="conversation-scroll">
              <div className="transcript">
                <div className="session-intro">
                  <ClarifierMark size={40} plate />
                  <div>
                    <h1>先聊聊你为什么想招人</h1>
                    <p>不用先创建岗位或填写表单。直接描述业务问题，Agent 会在对话中识别岗位、补齐事实并逐步建立岗位画像。</p>
                  </div>
                </div>

                <div className="conversation-policy-strip empty-policy-strip">
                  <span><CircleDot size={13} />岗位建立 <strong>从第一句话开始</strong></span>
                  <span>岗位名称、团队和成功标准会在对话中逐步补全</span>
                </div>

                <div className="message message-agent empty-onboarding-message">
                  <span className="agent-avatar"><ClarifierMark size={25} /></span>
                  <div className="message-body">
                    <div className="message-label">画像澄清 Agent</div>
                    <p>你好，{displayActor.display_name}。我们不用从一张表单开始。</p>
                    <p>你可以直接说：“最近业务遇到了什么问题，所以想招什么样的人？”我会边聊边帮你建立岗位。</p>
                    <div className="empty-chat-starters">
                      <span><Sparkles size={14} />你可以这样开始</span>
                      <button type="button" onClick={() => onSend('我们有一个新的业务目标，但还不确定应该招聘什么岗位，你先帮我梳理一下。')}>有业务目标，但岗位还没想清楚</button>
                      <button type="button" onClick={() => onSend('我想招聘一位企业产品经理，请从招聘原因开始帮我澄清。')}>已经知道想招什么岗位</button>
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
