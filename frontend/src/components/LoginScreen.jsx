import React, { useState } from 'react';
import { Activity, BriefcaseBusiness, ShieldCheck, Users } from 'lucide-react';

const demoAccounts = [
  {
    accountId: 'manager-demo',
    role: 'MANAGER',
    displayName: '用人经理 · 陈曦',
    description: '查看已审批 HC，澄清岗位画像并确认正式产物',
    icon: BriefcaseBusiness,
  },
  {
    accountId: 'hr-demo',
    role: 'HR',
    displayName: 'HR · 林夏',
    description: '进入同一岗位会话，生成招聘画像并推进招聘协作',
    icon: Users,
  },
  {
    accountId: 'admin-demo',
    role: 'ADMIN',
    displayName: '企业管理员 · 周宁',
    description: '查看企业全部岗位、会话记录与完整 Agent Trace',
    icon: Activity,
  },
];

export default function LoginScreen({ onLogin }) {
  const [selectedAccountId, setSelectedAccountId] = useState('manager-demo');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const selectedAccount = demoAccounts.find((item) => item.accountId === selectedAccountId)
    ?? demoAccounts[0];

  async function login(event) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      await onLogin({
        workspace_id: 'legacy-demo',
        account_id: selectedAccount.accountId,
        display_name: selectedAccount.displayName,
        role: selectedAccount.role,
      });
    } catch (loginError) {
      setError(loginError.message);
      setPending(false);
    }
  }

  return (
    <main className="login-screen">
      <form className="login-card" onSubmit={login}>
        <div className="login-mark"><ShieldCheck size={24} /></div>
        <span className="login-kicker">ROLE CLARIFIER MVP</span>
        <h1>进入岗位画像澄清 Agent</h1>
        <p>选择同一模拟企业中的固定账号，直接验证 HC、岗位协作、权限与企业级 Trace。</p>

        <div className="login-organization">
          <span><ShieldCheck size={14} />当前企业</span>
          <strong>云岚科技</strong>
          <small>三个账号共享同一企业数据；岗位来自 HC 审批，管理员可查看全企业会话和 Trace。</small>
        </div>

        <fieldset className="login-role-fieldset">
          <legend>选择测试账号</legend>
          <div className="login-options">
            {demoAccounts.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  className={selectedAccountId === item.accountId ? 'selected' : ''}
                  key={item.accountId}
                  type="button"
                  aria-pressed={selectedAccountId === item.accountId}
                  onClick={() => setSelectedAccountId(item.accountId)}
                >
                  <span><Icon size={18} /></span>
                  <div>
                    <strong>{item.displayName}</strong>
                    <small>{item.description}</small>
                    <code>{item.accountId}</code>
                  </div>
                  <em>{selectedAccountId === item.accountId ? '已选择' : '选择'}</em>
                </button>
              );
            })}
          </div>
        </fieldset>

        {error && <div className="login-error">{error}</div>}
        <button className="login-submit" disabled={pending} type="submit">
          {pending ? '正在进入…' : `以${selectedAccount.displayName}身份进入`}
        </button>
        <small className="login-footnote">固定演示账号无需密码，不会创建新的企业或用户。</small>
      </form>
    </main>
  );
}
