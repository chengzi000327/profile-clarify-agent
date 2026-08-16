import React, { useState } from 'react';
import { Activity, BriefcaseBusiness, ShieldCheck, Users } from 'lucide-react';

const demoAccounts = [
  {
    accountId: 'manager-demo',
    role: 'MANAGER',
    displayName: '用人经理 · 陈曦',
    description: '创建岗位、澄清成功标准并确认正式产物',
    icon: BriefcaseBusiness,
  },
  {
    accountId: 'hr-demo',
    role: 'HR',
    displayName: 'HR · 林夏',
    description: '协作澄清、管理招聘画像、候选人证据与校准',
    icon: Users,
  },
  {
    accountId: 'admin-demo',
    role: 'ADMIN',
    displayName: '企业管理员 · 周宁',
    description: '企业空间最高权限，并可查看完整 Agent Trace',
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
        <p>选择模拟组织中的固定账号，直接体验不同角色的真实权限和协作流程。</p>

        <div className="login-organization">
          <span><ShieldCheck size={14} />模拟组织</span>
          <strong>云岚科技</strong>
          <small>三个账号的数据与权限相互独立；企业级记录仅在 Trace 中汇总审计。</small>
        </div>

        <fieldset className="login-role-fieldset">
          <legend>选择账号</legend>
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
        <small className="login-footnote">固定演示账号无需密码，不会创建新的组织或用户。</small>
      </form>
    </main>
  );
}
