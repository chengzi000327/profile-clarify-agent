import { ShieldCheck } from 'lucide-react';

export default function AdminTestRoleSwitch({ value, onChange, compact = false }) {
  return (
    <div className={`admin-test-role-switch ${compact ? 'compact' : ''}`} aria-label="Agent 测试身份">
      {!compact && <span><ShieldCheck size={13} />Agent 测试身份</span>}
      <div>
        <button className={value === 'MANAGER' ? 'active' : ''} type="button" onClick={() => onChange('MANAGER')}>用人经理</button>
        <button className={value === 'HR' ? 'active' : ''} type="button" onClick={() => onChange('HR')}>HR</button>
      </div>
      {!compact && <small>真实审计身份始终为企业管理员</small>}
    </div>
  );
}
