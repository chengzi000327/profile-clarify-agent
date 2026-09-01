import React, { useState } from 'react';
import { ArrowUp, ChevronDown, Plus, ShieldCheck, Sparkles } from 'lucide-react';

export function LiveAgentRun({ events, status }) {
  const visible = events.filter((event) => [
    'user.message',
    'agent.status',
    'assistant.delta',
    'question.ready',
    'artifact.updated',
    'run.failed',
  ].includes(event.type));
  return (
    <div className="live-agent-run">
      <div className="live-run-heading">
        <span><Sparkles size={14} />实时 Agent Run</span>
        <em className={status}>{status === 'completed' ? '已完成' : status === 'reconnecting' ? '正在重连' : status === 'failed' ? '失败' : '执行中'}</em>
      </div>
      {visible.slice(-8).map((event) => (
        <div className={`live-run-event ${event.type}`} key={event.id}>
          {event.type === 'user.message' && <><strong>你</strong><p>{event.payload.content}</p></>}
          {event.type === 'agent.status' && <><strong>状态</strong><p>{event.payload.status}</p></>}
          {event.type === 'assistant.delta' && <><strong>Agent</strong><p>{event.payload.delta}</p></>}
          {event.type === 'question.ready' && <><strong>需要你的判断</strong><p>{event.payload.question}</p></>}
          {event.type === 'artifact.updated' && <><strong>产物已更新</strong><p>{event.payload.artifact_type} · v{event.payload.version ?? '—'}</p></>}
          {event.type === 'run.failed' && <><strong>运行失败</strong><p>{event.payload.message}</p></>}
        </div>
      ))}
    </div>
  );
}

export function Composer({ onSend, onExtend, pending = false, policy }) {
  const [text, setText] = useState('');

  async function submit() {
    const value = text.trim();
    if (!value || pending) return;
    setText('');
    await onSend?.(value);
  }

  return (
    <div className="composer-dock">
      <div className="composer">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="补充业务背景，或直接回答 Agent 的问题…"
          rows={1}
        />
        <div className="composer-toolbar">
          <div>
            <button className="icon-button tiny" aria-label="添加资料"><Plus size={17} /></button>
            <button className="composer-setting"><ShieldCheck size={14} />会话资料可读</button>
          </div>
          <div>
            <button className="composer-setting">Flash / Pro 自动路由<ChevronDown size={13} /></button>
            {policy && (
              <span className={`composer-rounds ${policy.status === 'LIMIT_REACHED' ? 'limit' : ''}`}>
                主动澄清 {Math.min(policy.opened_rounds, policy.initial_budget + policy.granted_rounds)} / {policy.initial_budget + policy.granted_rounds} 轮
              </span>
            )}
            <button className="send-button" aria-label="发送" onClick={submit} disabled={!text.trim() || pending}><ArrowUp size={17} /></button>
          </div>
        </div>
      </div>
      {policy?.status === 'LIMIT_REACHED' && (
        <div className="clarification-limit-bar">
          <span>Agent 已停止主动追问，正常聊天仍然可用。</span>
          <button type="button" onClick={() => onExtend?.('需要继续确认尚未解决的岗位关键问题')}>
            增加 {policy.extension_size} 轮
          </button>
        </div>
      )}
      <p className="composer-caption">画像结论保留证据和推断状态，仅在用人经理确认后生效。</p>
    </div>
  );
}
