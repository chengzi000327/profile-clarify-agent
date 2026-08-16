import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
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

function TraceContextSnapshot({ payload }) {
  const sections = [
    {
      key: 'system',
      label: 'System Prompt',
      subtitle: 'Harness 系统规则 · 长期固定指令',
      value: {
        section_name: payload.system_prompt?.section_name,
        content: payload.system_prompt?.content,
        harness_managed_base: payload.system_prompt?.harness_managed_base,
      },
    },
    {
      key: 'input',
      label: '当前用户输入',
      subtitle: '本轮请求 · 不属于记忆',
      value: payload.current_user_input,
    },
    {
      key: 'short',
      label: '短期记忆',
      subtitle: `最近会话窗口 · ${payload.short_term_memory?.window_size ?? 0} 条`,
      value: payload.short_term_memory,
    },
    {
      key: 'long',
      label: '长期记忆',
      subtitle: '业务数据库中的岗位事实、冲突与产物状态',
      value: payload.long_term_memory,
    },
    {
      key: 'task',
      label: '任务状态',
      subtitle: '角色、当前澄清题、运行上限与编排指令',
      value: payload.task_state,
    },
  ];
  return (
    <div className="trace-context-sections">
      {sections.map((section, index) => (
        <details className={`trace-context-section context-${section.key}`} key={section.key} open={index < 3}>
          <summary><span>{section.label}</span><small>{section.subtitle}</small></summary>
          <code>{JSON.stringify(section.value ?? null, null, 2)}</code>
        </details>
      ))}
    </div>
  );
}

export default function AdminTraceConsole() {
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
          : null,
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

  const selectedRun = useMemo(
    () => runs.find((item) => item.run.id === selectedId) ?? null,
    [runs, selectedId],
  );

  async function savePolicy() {
    setError('');
    try {
      await api.updateAgentPolicy(Number(initialBudget), Number(extensionSize));
      setPolicySaved(true);
      window.setTimeout(() => setPolicySaved(false), 1800);
    } catch (saveError) {
      setError(saveError.message);
    }
  }

  function openTrace(runId) {
    setTrace(null);
    setError('');
    setSelectedId(runId);
  }

  function closeTrace() {
    setSelectedId(null);
    setTrace(null);
    setError('');
  }

  if (selectedId) {
    return (
      <section className="admin-trace-console trace-detail-screen">
        <header className="trace-detail-page-header">
          <button className="trace-back-button" type="button" onClick={closeTrace}>
            <ArrowLeft size={15} />
            返回运行记录
          </button>
          <div className="trace-detail-breadcrumb">
            <span>Agent Trace 控制台</span>
            <ChevronRight size={13} />
            <strong>{selectedRun?.role_title ?? '运行详情'}</strong>
          </div>
        </header>

        {error && <div className="trace-console-error"><AlertTriangle size={14} />{error}</div>}

        <article className="trace-detail trace-detail-page">
          {!trace && <div className="trace-empty large">正在读取完整执行轨迹…</div>}
          {trace && (
            <>
              <div className="trace-detail-heading">
                <div>
                  <span>RUN {trace.run.id}</span>
                  <h2>{trace.run.task}</h2>
                  {selectedRun && <p>{selectedRun.role_title} · {selectedRun.actor_display_name}</p>}
                </div>
                <em className={trace.run.status.toLowerCase()}>{statusLabel[trace.run.status]}</em>
              </div>
              <div className="trace-metrics">
                <div><span>模型</span><strong>{trace.run.model_name}</strong><small>{trace.run.model_tier}</small></div>
                <div><span>耗时</span><strong>{durationOf(trace.run)}</strong><small><Clock3 size={11} />端到端</small></div>
                <div><span>Token</span><strong>{trace.run.input_tokens + trace.run.output_tokens}</strong><small>{trace.run.input_tokens} 输入 / {trace.run.output_tokens} 输出</small></div>
                <div><span>工具调用</span><strong>{trace.run.tool_count}</strong><small><Wrench size={11} />最多10个内部步骤</small></div>
              </div>
              <div className="trace-privacy-note"><ShieldCheck size={14} /><span>完整 Trace 已开启：上下文按 System Prompt、当前输入、短期会话记忆、长期岗位记忆与任务状态分层，并保留实际模型请求、最终输出和工具调用。API Key、Cookie、内部令牌及模型未提供的隐藏思维链不采集。</span></div>
              <div className="trace-timeline">
                {trace.events.map((event) => (
                  <div className={`trace-event ${event.type.includes('failed') ? 'failed' : ''}`} key={event.id}>
                    <span className="trace-event-dot">{event.type.includes('completed') ? <CheckCircle2 size={12} /> : <Activity size={11} />}</span>
                    <div>
                      <header><strong>{eventLabel[event.type] ?? event.type}</strong><time>{formatTime(event.created_at)}</time></header>
                      {event.type === 'context.snapshot'
                        ? <TraceContextSnapshot payload={event.payload} />
                        : <code>{JSON.stringify(event.payload, null, 2)}</code>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </article>
      </section>
    );
  }

  return (
    <section className="admin-trace-console trace-list-screen">
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

      <section className="trace-run-page">
        <div className="trace-list-heading">
          <div><strong>运行记录</strong><small>点击任意记录进入独立详情页</small></div>
          <span>{filteredRuns.length} 次运行</span>
        </div>
        <div className="trace-run-table-scroll">
          <div className="trace-run-table">
            <div className="trace-run-table-head" aria-hidden="true">
              <span>岗位与 Run</span>
              <span>操作者与任务</span>
              <span>模型</span>
              <span>开始时间</span>
              <span>状态</span>
              <span />
            </div>
          {loading && <div className="trace-empty">正在读取运行记录…</div>}
          {!loading && filteredRuns.length === 0 && <div className="trace-empty">暂无符合条件的运行记录</div>}
          {filteredRuns.map((item) => (
            <button className="trace-run-row" key={item.run.id} type="button" onClick={() => openTrace(item.run.id)}>
              <span className="trace-run-identity"><strong>{item.role_title}</strong><code>{item.run.id}</code></span>
              <span className="trace-run-actor"><strong>{item.actor_display_name}</strong><small>{item.run.task}</small></span>
              <span className="trace-run-model"><strong>{item.run.model_tier}</strong><small>{item.run.model_name}</small></span>
              <time>{formatTime(item.run.started_at)}</time>
              <em className={item.run.status.toLowerCase()}>{statusLabel[item.run.status]}</em>
              <ChevronRight className="trace-row-arrow" size={15} />
            </button>
          ))}
          </div>
        </div>
      </section>
    </section>
  );
}
