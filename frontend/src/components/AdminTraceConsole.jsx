import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Filter,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { api } from '../api/client.js';

const statusLabel = {
  QUEUED: '排队中',
  RUNNING: '运行中',
  COMPLETED: '已完成',
  FAILED: '失败',
  CANCELLED: '已取消',
};

const eventLabel = {
  'run.started': '运行开始',
  'channel.received': '渠道事件已接收',
  'channel.response.sent': '渠道回复已发送',
  'channel.response.failed': '渠道回复失败',
  'agent.status': 'Agent 状态',
  'message.accepted': '用户消息原文',
  'context.snapshot': '注入上下文分层',
  'model.request': '发送给模型的完整 Prompt',
  'model.response': '模型原始最终输出',
  'assistant.delta': '用户可见 Agent 回复',
  'assistant.completed': 'Agent 回复已落库',
  'tool.started': '工具开始',
  'tool.completed': '工具完成',
  'question.ready': '澄清问题就绪',
  'clarification.round.opened': '澄清轮次开启',
  'clarification.round.completed': '澄清轮次完成',
  'clarification.limit.reached': '澄清预算已用完',
  'artifact.updated': '产物已更新',
  'run.completed': '运行完成',
  'run.failed': '运行失败',
};

function formatTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function durationOf(run) {
  if (!run.started_at) return '—';
  const end = run.completed_at ? new Date(run.completed_at).getTime() : Date.now();
  return `${Math.max(0, end - new Date(run.started_at).getTime())} ms`;
}

const contextTabs = [
  { key: 'system', label: 'System Prompt', description: '系统规则与安全边界' },
  { key: 'input', label: '当前输入', description: '本轮原始请求' },
  { key: 'short', label: '短期记忆', description: '最近会话窗口' },
  { key: 'long', label: '长期记忆', description: '岗位数据库快照' },
  { key: 'task', label: '任务状态', description: '本轮编排参数' },
];

function JsonSnapshot({ value }) {
  return <code className="trace-context-json">{JSON.stringify(value ?? null, null, 2)}</code>;
}

function TraceContextWorkspace({ payload }) {
  const [activeTab, setActiveTab] = useState('system');
  if (!payload) {
    return (
      <section className="trace-context-workspace empty">
        <div><strong>本次运行没有上下文快照</strong><span>只有进入 Harness 正式执行的运行才会记录五层上下文；路由失败或尚未执行时这里为空。</span></div>
      </section>
    );
  }

  const messages = Array.isArray(payload.short_term_memory?.messages)
    ? payload.short_term_memory.messages
    : [];
  const roleState = payload.long_term_memory?.role_state;
  const roleStateObject = roleState && typeof roleState === 'object' ? roleState : {};
  const roleIdentity = roleStateObject.role && typeof roleStateObject.role === 'object'
    ? roleStateObject.role
    : roleStateObject;
  const facts = Array.isArray(roleStateObject.facts) ? roleStateObject.facts : [];
  const artifacts = Array.isArray(roleStateObject.artifact_refs)
    ? roleStateObject.artifact_refs.map((artifact) => [artifact?.type ?? 'UNKNOWN', artifact])
    : roleStateObject.latest_artifacts && typeof roleStateObject.latest_artifacts === 'object'
      ? Object.entries(roleStateObject.latest_artifacts)
      : [];
  const tabCounts = {
    system: payload.system_prompt?.content ? '1 份' : '0',
    input: payload.current_user_input?.content == null ? '0' : '1 条',
    short: `${messages.length} 条`,
    long: `${facts.length} 事实 · ${artifacts.length} 产物`,
    task: `${Object.keys(payload.task_state ?? {}).length} 项`,
  };

  return (
    <section className="trace-context-workspace">
      <div className="trace-context-heading">
        <div><span>CONTEXT LAYERS</span><h3>本轮模型实际注入的上下文</h3></div>
        <small>五类信息独立展示，不与模型输出和工具事件混排</small>
      </div>
      <nav className="trace-context-tabs" aria-label="上下文分层">
        {contextTabs.map((tab) => (
          <button key={tab.key} className={`${activeTab === tab.key ? 'active' : ''} context-${tab.key}`} onClick={() => setActiveTab(tab.key)}>
            <span>{tab.label}<em>{tabCounts[tab.key]}</em></span>
            <small>{tab.description}</small>
          </button>
        ))}
      </nav>
      <div className={`trace-context-panel context-${activeTab}`}>
        {activeTab === 'system' && (
          <>
            <div className="trace-context-panel-meta">
              <span>来源 <strong>{payload.system_prompt?.provenance ?? '未知'}</strong></span>
              <span>段落 <strong>{payload.system_prompt?.section_name ?? '未命名'}</strong></span>
              <span>Harness Base <strong>{payload.system_prompt?.harness_managed_base?.included ? '已注入' : '未注入'}</strong></span>
            </div>
            <pre className="trace-prompt-content">{payload.system_prompt?.content ?? '未记录 System Prompt'}</pre>
            {payload.system_prompt?.harness_managed_base && <p className="trace-context-note">{payload.system_prompt.harness_managed_base.description}</p>}
          </>
        )}
        {activeTab === 'input' && (
          <>
            <div className="trace-context-panel-meta"><span>来源 <strong>{payload.current_user_input?.source ?? 'CURRENT_REQUEST'}</strong></span><span>性质 <strong>本轮输入，不进入记忆</strong></span></div>
            <JsonSnapshot value={payload.current_user_input?.content} />
          </>
        )}
        {activeTab === 'short' && (
          <>
            <div className="trace-context-panel-meta"><span>来源 <strong>{payload.short_term_memory?.source ?? 'RECENT_CONVERSATION'}</strong></span><span>窗口 <strong>{payload.short_term_memory?.window_size ?? messages.length} 条</strong></span></div>
            <div className="trace-memory-message-list">
              {messages.length === 0 && <p className="trace-context-empty-copy">本轮没有注入历史会话消息。</p>}
              {messages.map((message, index) => (
                <article key={`${message?.sender_type ?? 'message'}-${index}`}>
                  <header><strong>{message?.sender_type === 'HUMAN' ? '用户' : message?.sender_type === 'AGENT' ? 'Agent' : message?.sender_type ?? '消息'}</strong><span>{message?.sender_role ?? ''}</span><em>#{index + 1}</em></header>
                  <p>{message?.content ?? JSON.stringify(message)}</p>
                </article>
              ))}
            </div>
          </>
        )}
        {activeTab === 'long' && (
          <>
            <div className="trace-context-panel-meta"><span>来源 <strong>{payload.long_term_memory?.source ?? 'BUSINESS_DATABASE'}</strong></span><span>岗位事实 <strong>{facts.length} 条</strong></span><span>最新产物 <strong>{artifacts.length} 个</strong></span></div>
            <div className="trace-role-state-summary">
              <div><span>岗位</span><strong>{roleIdentity.title ?? '—'}</strong></div>
              <div><span>团队</span><strong>{roleIdentity.department ?? '—'}</strong></div>
              <div><span>阶段</span><strong>{roleIdentity.stage ?? '—'}</strong></div>
              <div><span>Revision</span><strong>{roleStateObject.state_revision ?? roleStateObject.revision ?? '—'}</strong></div>
            </div>
            <div className="trace-long-term-columns">
              <section><h4>岗位事实</h4>{facts.length === 0 ? <p>无岗位事实</p> : facts.map((fact, index) => <div key={fact.id ?? `${fact.category}-${index}`}><span>{fact.category}</span><strong>{fact.statement}</strong><em>{fact.status}</em></div>)}</section>
              <section><h4>岗位产物引用</h4>{artifacts.length === 0 ? <p>无岗位产物</p> : artifacts.map(([type, artifact], index) => <div key={`${type}-${artifact?.id ?? index}`}><span>{type}</span><strong>v{artifact?.version ?? '—'}</strong><em>{artifact?.status ?? '—'}</em></div>)}</section>
            </div>
            <details className="trace-raw-snapshot"><summary>查看完整长期记忆 JSON</summary><JsonSnapshot value={payload.long_term_memory} /></details>
          </>
        )}
        {activeTab === 'task' && (
          <>
            <div className="trace-context-panel-meta"><span>用途 <strong>本轮编排与执行控制</strong></span><span>字段 <strong>{Object.keys(payload.task_state ?? {}).length} 项</strong></span></div>
            <div className="trace-task-state-grid">{Object.entries(payload.task_state ?? {}).map(([key, value]) => <div key={key}><span>{key}</span><strong>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</strong></div>)}</div>
            <details className="trace-raw-snapshot"><summary>查看完整任务状态 JSON</summary><JsonSnapshot value={payload.task_state} /></details>
          </>
        )}
      </div>
    </section>
  );
}

function ChannelTracePanel({ origin, events }) {
  const channel = origin?.channel ?? 'WEB';
  const deliveryEvents = (events ?? []).filter((event) =>
    event.type === 'channel.response.sent' || event.type === 'channel.response.failed');
  const isFeishu = channel === 'FEISHU';
  const isWeb = channel === 'WEB';
  const webhook = origin?.webhook_event ?? {};
  const verification = origin?.verification ?? {};
  const identity = origin?.identity_mapping ?? {};
  const routing = origin?.role_routing ?? {};
  const command = origin?.command ?? {};

  return (
    <section className={`trace-channel-panel channel-${String(channel).toLowerCase()}`}>
      <div className="trace-channel-heading">
        <div><span>CHANNEL TRACE</span><h3>渠道链路</h3></div>
        <em>{isFeishu ? '飞书 FEISHU' : isWeb ? 'Web 工作台' : '历史记录 · 渠道未知'}</em>
      </div>
      {isFeishu ? (
        <div className="trace-channel-steps">
          <div className="completed"><span>01</span><strong>接收飞书回调</strong><small>{webhook.event_type ?? 'im.message.receive_v1'} · {webhook.message_id ?? '—'}</small></div>
          <div className={verification.token_verified ? 'completed' : 'warning'}><span>02</span><strong>安全与幂等校验</strong><small>Token {verification.token_verified ? '通过' : '未知'} · {verification.deduplication ?? '未知'}</small></div>
          <div className="completed"><span>03</span><strong>用户身份映射</strong><small>{identity.actor_display_name ?? '—'} · {identity.actor_role ?? '—'} · {identity.source ?? '—'}</small></div>
          <div className="completed"><span>04</span><strong>路由岗位会话</strong><small>{routing.role_title ?? '—'} · {routing.resolution ?? '—'}</small></div>
          <div className="completed"><span>05</span><strong>提交 Agent Run</strong><small>{command.kind === 'GENERATE_ARTIFACT' ? `生成 ${command.artifact_type}` : `对话消息 · ${command.text_length ?? 0} 字`}</small></div>
          <div className={deliveryEvents.some((event) => event.type === 'channel.response.failed') ? 'failed' : deliveryEvents.length > 0 ? 'completed' : 'pending'}><span>06</span><strong>返回飞书</strong><small>{deliveryEvents.length > 0 ? deliveryEvents.map((event) => `${event.payload.delivery ?? '回复'} · ${event.type === 'channel.response.sent' ? '已发送' : '失败'}`).join('；') : '等待或未记录发送结果'}</small></div>
        </div>
      ) : isWeb ? (
        <div className="trace-web-channel-summary"><CheckCircle2 size={14} /><div><strong>请求来自 Web 工作台</strong><span>浏览器 Session 完成身份验证后直接提交到当前岗位会话，没有经过外部渠道适配层。</span></div></div>
      ) : (
        <div className="trace-web-channel-summary unknown"><AlertTriangle size={14} /><div><strong>历史运行未记录渠道来源</strong><span>该 Run 产生于渠道 Trace 上线前，无法可靠判断来自 Web 还是飞书；不会进行猜测或错误归类。</span></div></div>
      )}
      {isFeishu && <details className="trace-raw-snapshot"><summary>查看飞书渠道元数据（已脱敏）</summary><JsonSnapshot value={origin} /></details>}
    </section>
  );
}

export default function AdminTraceConsole({ onPolicyUpdated }) {
  const [runs, setRuns] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [trace, setTrace] = useState(null);
  const [status, setStatus] = useState('');
  const [modelTier, setModelTier] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [initialBudget, setInitialBudget] = useState(6);
  const [extensionSize, setExtensionSize] = useState(2);
  const [policySaved, setPolicySaved] = useState(false);

  async function loadRuns() {
    setLoading(true);
    setError('');
    try {
      const result = await api.listAdminRuns({ status, model_tier: modelTier });
      setRuns(result.items);
      setSelectedId((current) =>
        result.items.some((item) => item.run.id === current)
          ? current
          : result.items[0]?.run.id ?? null,
      );
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRuns();
  }, [status, modelTier]);

  useEffect(() => {
    let cancelled = false;
    api.getAgentPolicy()
      .then((policy) => {
        if (cancelled) return;
        setInitialBudget(policy.initial_budget);
        setExtensionSize(policy.extension_size);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setTrace(null);
      return;
    }
    let cancelled = false;
    api.getAdminTrace(selectedId)
      .then((result) => {
        if (!cancelled) setTrace(result);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError.message);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const filteredRuns = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return runs;
    return runs.filter((item) =>
      [item.role_title, item.actor_display_name, item.run.id, item.run.model_name]
        .some((value) => String(value).toLowerCase().includes(keyword)),
    );
  }, [runs, query]);

  const contextSnapshot = useMemo(() => {
    const contextEvent = [...(trace?.events ?? [])]
      .reverse()
      .find((event) => event.type === 'context.snapshot');
    return contextEvent?.payload ?? null;
  }, [trace]);

  const runOrigin = useMemo(() => {
    const startedEvent = trace?.events?.find((event) => event.type === 'run.started');
    if (!startedEvent) return null;
    return startedEvent.payload?.origin ?? {
      channel: startedEvent.payload?.channel ?? 'UNKNOWN',
      source: startedEvent.payload?.channel === 'WEB' ? 'WEB_WORKSPACE' : 'LEGACY_TRACE',
    };
  }, [trace]);

  async function savePolicy() {
    setError('');
    try {
      const policy = await api.updateAgentPolicy(Number(initialBudget), Number(extensionSize));
      setInitialBudget(policy.initial_budget);
      setExtensionSize(policy.extension_size);
      await onPolicyUpdated?.(policy);
      setPolicySaved(true);
      window.setTimeout(() => setPolicySaved(false), 1800);
    } catch (saveError) {
      setError(saveError.message);
    }
  }

  return (
    <section className="admin-trace-console">
      <header className="trace-console-header">
        <div>
          <span className="trace-kicker"><ShieldCheck size={14} />企业管理员最高权限</span>
          <h1>Agent Trace 控制台</h1>
          <p>查看企业内全部岗位的完整执行轨迹、模型路由、工具入参与返回、模型输入输出和运行指标。</p>
        </div>
        <div className="trace-policy-card">
          <span><Settings2 size={14} />企业澄清策略</span>
          <label>初始轮数<input type="number" min="1" max="30" value={initialBudget} onChange={(event) => setInitialBudget(event.target.value)} /></label>
          <label>每次增加<input type="number" min="1" max="10" value={extensionSize} onChange={(event) => setExtensionSize(event.target.value)} /></label>
          <button onClick={savePolicy}>{policySaved ? '已保存' : '应用到全部岗位'}</button>
        </div>
      </header>

      {error && <div className="trace-console-error"><AlertTriangle size={14} />{error}</div>}

      <div className="trace-toolbar">
        <label className="trace-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索岗位、操作者、Run ID" /></label>
        <label><Filter size={13} /><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><Activity size={13} /><select value={modelTier} onChange={(event) => setModelTier(event.target.value)}><option value="">全部模型</option><option value="FLASH">Flash</option><option value="PRO">Pro</option></select></label>
        <button onClick={loadRuns}><RefreshCw size={13} />刷新</button>
      </div>

      <div className="trace-console-grid">
        <aside className="trace-run-list">
          <div className="trace-list-heading"><strong>运行记录</strong><span>{filteredRuns.length}</span></div>
          {loading && <div className="trace-empty">正在读取运行记录…</div>}
          {!loading && filteredRuns.length === 0 && <div className="trace-empty">暂无符合条件的运行记录</div>}
          {filteredRuns.map((item) => (
            <button className={selectedId === item.run.id ? 'active' : ''} key={item.run.id} onClick={() => setSelectedId(item.run.id)}>
              <div><strong>{item.role_title}</strong><em className={item.run.status.toLowerCase()}>{statusLabel[item.run.status]}</em></div>
              <p>{item.actor_display_name} · {item.run.model_tier} · {item.run.task}</p>
              <span>{formatTime(item.run.started_at)}<code>{item.run.id.slice(0, 8)}</code></span>
            </button>
          ))}
        </aside>

        <main className="trace-detail">
          {!trace && <div className="trace-empty large">选择一次运行查看完整执行轨迹</div>}
          {trace && (
            <>
              <div className="trace-detail-heading">
                <div><span>RUN {trace.run.id}</span><h2>{trace.run.task}</h2></div>
                <em className={trace.run.status.toLowerCase()}>{statusLabel[trace.run.status]}</em>
              </div>
              <div className="trace-metrics">
                <div><span>模型</span><strong>{trace.run.model_name}</strong><small>{trace.run.model_tier}</small></div>
                <div><span>耗时</span><strong>{durationOf(trace.run)}</strong><small><Clock3 size={11} />端到端</small></div>
                <div><span>Token</span><strong>{trace.run.input_tokens + trace.run.output_tokens}</strong><small>{trace.run.input_tokens} 输入 / {trace.run.output_tokens} 输出</small></div>
                <div><span>工具调用</span><strong>{trace.run.tool_count}</strong><small><Wrench size={11} />最多10个内部步骤</small></div>
              </div>
              <div className="trace-privacy-note"><ShieldCheck size={14} /><span>完整 Trace 已开启：上下文按 System Prompt、当前输入、短期会话记忆、长期岗位记忆与任务状态分层，并保留实际模型请求、最终输出和工具调用。API Key、Cookie、内部令牌及模型未提供的隐藏思维链不采集。</span></div>
              <ChannelTracePanel origin={runOrigin} events={trace.events} />
              <TraceContextWorkspace payload={contextSnapshot} />
              <div className="trace-timeline">
                {trace.events.map((event) => (
                  <div className={`trace-event ${event.type.includes('failed') ? 'failed' : ''}`} key={event.id}>
                    <span className="trace-event-dot">{event.type.includes('completed') ? <CheckCircle2 size={12} /> : <Activity size={11} />}</span>
                    <div>
                      <header><strong>{eventLabel[event.type] ?? event.type}</strong><time>{formatTime(event.created_at)}</time></header>
                      {event.type === 'context.snapshot'
                        ? <div className="trace-context-event-summary"><CheckCircle2 size={13} /><span>五层上下文快照已捕获，并独立展示在上方“本轮模型实际注入的上下文”区域。</span></div>
                        : <code>{JSON.stringify(event.payload, null, 2)}</code>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </main>
      </div>
    </section>
  );
}
