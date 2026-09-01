import { useEffect, useRef } from 'react';
import {
  AlertTriangle,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Database,
  FileText,
  Link2,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { contextSources } from '../../data.js';
import { Composer, LiveAgentRun } from '../AgentConversation.jsx';
import ClarifierMark from '../ClarifierMark.jsx';

const sourceIcons = {
  org: Users,
  doc: FileText,
  people: Users,
  database: Database,
};

export function ConversationView({
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

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, agentEvents]);

  return (
    <section className="conversation-surface real-conversation">
      <div className="conversation-scroll" ref={scrollRef}>
        <div className="transcript">
          <div className="session-intro">
            <ClarifierMark size={40} plate />
            <div>
              <h1>{activeRole.name}岗位澄清</h1>
              <p>用人经理、HR和企业管理员可以在同一会话中补充事实、追问Agent并持续生成岗位画像。每条消息都会保留真实身份。</p>
            </div>
            <button className="conversation-profile-link" onClick={onOpenProfile}>查看岗位画像<ChevronRight size={14} /></button>
          </div>

          <div className="conversation-policy-strip">
            <span><CircleDot size={13} />主动澄清 <strong>{policy?.opened_rounds ?? 0} / {budget} 轮</strong></span>
            <span>{policy?.status === 'LIMIT_REACHED' ? '已停止主动追问，正常对话仍可继续' : 'Agent会围绕尚未确认的岗位关键问题主动追问'}</span>
          </div>

          {messages.length === 0 && (
            <div className="conversation-empty-state">
              <ClarifierMark size={34} plate />
              <strong>Agent 正在准备第一个澄清问题</strong>
              <p>系统会根据已审批 HC 的招聘原因和组织缺口主动发问，请稍候。</p>
            </div>
          )}

          {messages.map((message) => {
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
                      <span><CircleDot size={13} />{structured.kind === 'HC_OPENING_QUESTION'
                        ? 'Agent 主动发起 · 第一个问题'
                        : `第 ${structured.round_ordinal} / ${structured.budget} 轮主动澄清`}</span>
                      <strong>{structured.question}</strong>
                      <small>{structured.kind === 'HC_OPENING_QUESTION'
                        ? '请用人经理直接在下方回答；HR 和企业管理员可以补充事实。'
                        : '经理、HR或企业管理员都可以直接在下方回答。'}</small>
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

export function LegacyConversationView({
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
