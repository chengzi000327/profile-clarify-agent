import React, { useEffect, useState } from 'react';
import {
  canDecideFact,
  factCategoryLabel,
  factStatusLabel,
} from '../fact-decision.js';

const formatDateTime = (value) => new Date(value).toLocaleString('zh-CN', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export default function FactDecisionCard({ fact, effectiveRole, pending, onDecide }) {
  const [editing, setEditing] = useState(false);
  const [statement, setStatement] = useState(fact.statement);
  const [category, setCategory] = useState(fact.category);
  const canDecide = canDecideFact(effectiveRole, fact);

  useEffect(() => {
    setEditing(false);
    setStatement(fact.statement);
    setCategory(fact.category);
  }, [fact.id, fact.statement, fact.category]);

  return (
    <section className={`fact-decision-card status-${fact.status.toLowerCase()}`} aria-label="岗位事实确认">
      <header>
        <span>{factCategoryLabel[category] ?? category}</span>
        <strong>{factStatusLabel[fact.status] ?? fact.status}</strong>
      </header>
      {editing ? (
        <div className="fact-decision-editor">
          <label>
            事实类型
            <select value={category} disabled={pending} onChange={(event) => setCategory(event.target.value)}>
              {Object.entries(factCategoryLabel).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            事实内容
            <textarea
              value={statement}
              maxLength={2000}
              disabled={pending}
              onChange={(event) => setStatement(event.target.value)}
            />
          </label>
        </div>
      ) : <p>{fact.statement}</p>}
      <small className="fact-decision-source">
        {fact.source}
        {fact.confirmed_at ? ` · ${formatDateTime(fact.confirmed_at)} 已确认` : ''}
      </small>
      {canDecide && !editing && (
        <div className="fact-decision-actions">
          <button className="primary" type="button" disabled={pending} onClick={() => onDecide('CONFIRM')}>确认生效</button>
          <button type="button" disabled={pending} onClick={() => setEditing(true)}>修改</button>
          <button type="button" disabled={pending} onClick={() => onDecide('REJECT')}>拒绝</button>
        </div>
      )}
      {canDecide && editing && (
        <div className="fact-decision-actions">
          <button
            className="primary"
            type="button"
            disabled={pending || !statement.trim()}
            onClick={() => onDecide('REVISE', {
              replacement: { category, statement: statement.trim() },
            })}
          >
            保存修改
          </button>
          <button type="button" disabled={pending} onClick={() => setEditing(false)}>取消</button>
        </div>
      )}
      {!canDecide && (fact.status === 'DRAFT' || fact.status === 'CONFLICTED') && (
        <small className="fact-decision-readonly">等待用人经理确认</small>
      )}
    </section>
  );
}
