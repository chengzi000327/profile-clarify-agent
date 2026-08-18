import React, { useState } from 'react';
import {
  Activity, ArrowRight, BriefcaseBusiness, Building2, CalendarClock,
  CheckCircle2, FileText, LogOut, MapPin, Send, Users,
} from 'lucide-react';
import AdminTraceConsole from './AdminTraceConsole.jsx';
import ClarifierMark from './ClarifierMark.jsx';
import { hcProgress } from '../hc-progress.js';

const roleLabel = { MANAGER: '用人经理', HR: 'HR 招聘负责人', ADMIN: '企业管理员' };
const recruitmentLabel = {
  NEW_HEADCOUNT: '新增编制', REPLACEMENT: '人员替换',
  ATTRITION_REPLACEMENT: '离职补充', PERFORMANCE_REPLACEMENT: '汰换补充',
  ORGANIZATION_ADJUSTMENT: '组织调整', OTHER: '其他补充',
};
const formatDate = (value) => new Date(value).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
export default function HcApprovalLanding({
  actor, approvals, loading, error, activeView, onOpenHc,
  onOpenApprovals, onOpenProfile, onOpenTrace, onLogout,
}) {
  const [openingId, setOpeningId] = useState(null);

  async function openApproval(requestId) {
    setOpeningId(requestId);
    try { await onOpenHc(requestId); } finally { setOpeningId(null); }
  }

  return (
    <div className="app-shell hc-landing-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <button className="brand" aria-label="画像澄清 Agent">
            <ClarifierMark size={34} plate />
            <span className="brand-copy"><strong>画像澄清 Agent</strong><small>ROLE CLARIFIER</small></span>
          </button>
        </div>
        <button className="new-project-button" onClick={onOpenApprovals} aria-label="选择已审批 HC">
          <BriefcaseBusiness size={17} /><span>选择已审批 HC</span>
        </button>
        <div className="sidebar-section-title"><span>岗位澄清</span></div>
        <div className="hc-sidebar-summary">
          <span><strong>{approvals.length}</strong> 条待澄清 HC</span><small>均已通过业务审批</small>
        </div>
        <div className="sidebar-footer">
          {actor.role === 'ADMIN' && (
            <button className={`sidebar-utility ${activeView === 'admin-trace' ? 'active' : ''}`} onClick={onOpenTrace}>
              <Activity size={17} /><span>Agent Trace 控制台</span>
            </button>
          )}
          <div className="hc-sidebar-user">
            <span>{Array.from(actor.display_name)[0]}</span>
            <div><strong>{actor.display_name}</strong><small>{roleLabel[actor.role]}</small></div>
          </div>
          <button className="sidebar-utility" onClick={onLogout}><LogOut size={16} /><span>退出登录</span></button>
        </div>
      </aside>

      <main className="main-workspace">
        <header className="workspace-header">
          <div className="title-stack">
            <div className="title-line"><strong>岗位澄清对话</strong><span className="role-stage-badge confirmed">HC 已同步</span></div>
            <div className="preset-line"><span>岗位画像澄清 Agent</span><span className="phase-dot" /><span>{roleLabel[actor.role]}</span></div>
          </div>
        </header>
        <div className="workspace-tabs">
          <button className={activeView === 'hc' ? 'active' : ''} onClick={onOpenApprovals}>对话</button>
          <button className={activeView === 'profile' ? 'active' : ''} onClick={onOpenProfile}>
            岗位画像 <span className="tab-state">选择岗位后查看</span>
          </button>
          {actor.role === 'ADMIN' && (
            <button className={activeView === 'admin-trace' ? 'active' : ''} onClick={onOpenTrace}>
              Trace 控制台 <span className="tab-state">ADMIN</span>
            </button>
          )}
        </div>

        {activeView === 'admin-trace' && actor.role === 'ADMIN' ? (
          <AdminTraceConsole />
        ) : activeView === 'profile' ? (
          <section className="hc-profile-placeholder">
            <FileText size={28} /><h1>岗位画像</h1>
            <p>岗位画像模块保持不变。请先选择一条 HC，进入岗位后即可查看、生成和确认画像版本。</p>
            <button onClick={onOpenApprovals}>返回选择 HC</button>
          </section>
        ) : (
          <section className="hc-chat-surface">
            <div className="hc-chat-thread">
              <article className="hc-agent-message">
                <span className="hc-agent-avatar"><ClarifierMark size={28} /></span>
                <div className="hc-agent-message-body">
                  <small>画像澄清 Agent</small>
                  <h1>目前有以下 {approvals.length} 条审批通过的 HC 需要你进行岗位澄清</h1>
                  <p>请选择一条。进入后我会结合审批原因和组织缺口主动提出第一个问题，你只需要逐题回答。</p>
                  {error && <div className="hc-workbench-error">{error}</div>}
                  {loading && <div className="hc-loading">正在读取 HC 审批数据…</div>}
                  {!loading && approvals.length === 0 && <div className="hc-empty"><CheckCircle2 size={16} />当前没有待澄清的已审批 HC。</div>}
                  <div className="hc-conversation-choices" role="group" aria-label="已审批 HC">
                    {approvals.map((hc, index) => {
                      const basics = hc.context.job_basics;
                      const isOpening = openingId === hc.request_id;
                      const progress = hcProgress(hc);
                      return (
                        <button
                          className="hc-conversation-choice"
                          type="button"
                          key={hc.request_id}
                          disabled={Boolean(openingId)}
                          onClick={() => openApproval(hc.request_id)}
                        >
                          <span className="hc-choice-index">{String(index + 1).padStart(2, '0')}</span>
                          <span className="hc-choice-role">
                            <strong>{hc.title}</strong>
                            <small><Building2 size={11} />{hc.department}<i>·</i>{hc.request_id}</small>
                          </span>
                          <span className="hc-choice-reason">{hc.context.approved_reason}</span>
                          <span className="hc-choice-facts">
                            <small><Users size={11} />{recruitmentLabel[basics.recruitment_type]} · {basics.headcount} 人</small>
                            <small><MapPin size={11} />{basics.locations.join(' / ')}</small>
                            <small><CalendarClock size={11} />{basics.target_onboard}</small>
                          </span>
                          <span className={`hc-choice-action ${progress.tone}`}>
                            <small>{progress.status} · {formatDate(hc.context.approved_at)} 批准</small>
                            <strong>{isOpening ? '正在进入…' : progress.action}</strong>
                            {!isOpening && <ArrowRight size={14} />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </article>
            </div>
            <div className="hc-chat-composer" aria-disabled="true">
              <span>请先选择上方一条已审批 HC，Agent 将主动开始岗位澄清</span>
              <button type="button" disabled aria-label="发送"><Send size={16} /></button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
