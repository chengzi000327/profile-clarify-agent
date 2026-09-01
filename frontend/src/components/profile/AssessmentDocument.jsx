import { ListChecks } from 'lucide-react';
import { normalizeAssessmentContent } from '../../assessment-content.js';

export default function GeneratedAssessment({ artifact }) {
  const { dimensions, decisionRule } = normalizeAssessmentContent(artifact?.content);
  return (
    <article className="generated-artifact-document assessment-artifact">
      <section className="generated-artifact-hero">
        <div className="assessment-rule-heading">
          <span><ListChecks size={14} />招聘评估方案</span>
          {decisionRule.status && <em>{decisionRule.status}</em>}
        </div>
        <h2>把岗位成功标准转成统一、可观察的面试判断</h2>
        {decisionRule.summary && <p>{decisionRule.summary}</p>}
        {decisionRule.items.length > 0 && (
          <div className="assessment-decision-rule-grid">
            {decisionRule.items.map((item) => (
              <div key={item.label}><small>{item.label}</small><strong>{item.value}</strong></div>
            ))}
          </div>
        )}
      </section>
      <section className="generated-section">
        <div className="assessment-dimension-grid">
          {dimensions.map((dimension, index) => {
            return (
              <div className="assessment-dimension-card" key={`${dimension.name}-${index}`}>
                <header><span>{dimension.id}</span><div><h3>{dimension.name}</h3><p>{dimension.weight === '—' ? '权重待确认' : `${dimension.weight}%`} · {dimension.method}</p></div></header>
                {dimension.owner && <p><strong>评估人：</strong>{dimension.owner}</p>}
                {dimension.question && <p><strong>核心问题：</strong>{dimension.question}</p>}
                {dimension.evidence && <p><strong>必须听到：</strong>{dimension.evidence}</p>}
                <div className="assessment-anchor-list">{dimension.anchors.map((anchor) => <span key={anchor}>{anchor}</span>)}</div>
              </div>
            );
          })}
          {dimensions.length === 0 && <p className="generated-empty-copy">当前版本没有评估维度。</p>}
        </div>
      </section>
    </article>
  );
}
