import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ShieldCheck,
  X,
} from 'lucide-react';

export default function EvidenceDrawer({ evidence, onClose }) {
  return (
    <div className="drawer-layer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="evidence-drawer">
        <div className="drawer-header">
          <div><span className="drawer-kicker">证据详情</span><h2>{evidence.title}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="关闭证据"><X size={18} /></button>
        </div>
        <div className="evidence-id-row"><span>{evidence.id}</span><em className={evidence.conflict ? 'conflict' : ''}>{evidence.status}</em></div>
        <div className="evidence-meta">
          <div><span>资料类型</span><strong>{evidence.type}</strong></div>
          <div><span>来源</span><strong>{evidence.source}</strong></div>
          <div><span>获取时间</span><strong>{evidence.time}</strong></div>
        </div>
        <div className="evidence-quote"><span>原始内容</span><blockquote>“{evidence.quote}”</blockquote></div>
        {evidence.conflict && (
          <div className="conflict-note"><AlertTriangle size={17} /><div><strong>发现信息冲突</strong><p>{evidence.conflict}</p></div></div>
        )}
        <div className="support-block"><span>支持画像字段</span><div>{evidence.supports.map((item) => <button key={item}>{item}<ChevronRight size={13} /></button>)}</div></div>
        <div className="drawer-trace"><span><CheckCircle2 size={15} />来源与原文已保留</span><span><ShieldCheck size={15} />人工确认后写入正式画像</span></div>
      </aside>
    </div>
  );
}
