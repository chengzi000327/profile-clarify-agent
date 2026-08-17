import React, { useState } from 'react';
import { Activity, BriefcaseBusiness, ShieldCheck, Users } from 'lucide-react';

const demoAccounts = [
  {
    workspace_id: 'legacy-demo', account_id: 'manager-demo', display_name: '用人经理 · 陈曦', role: 'MANAGER',
    label: '用人经理', description: '创建岗位、澄清成功标准并确认正式产物', icon: BriefcaseBusiness,
  },
  {
    workspace_id: 'legacy-demo', account_id: 'hr-demo', display_name: 'HR · 林夏', role: 'HR',
    label: 'HR', description: '协作澄清、管理招聘画像、候选人证据与校准', icon: Users,
  },
  {
    workspace_id: 'legacy-demo', account_id: 'admin-demo', display_name: '企业管理员 · 周宁', role: 'ADMIN',
    label: '企业管理员', description: '企业空间最高权限，并可查看完整 Agent Trace', icon: Activity,
  },
];

export default function LoginScreen({ onLogin }) {
  const [accountId, setAccountId] = useState(demoAccounts[0].account_id);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const selectedAccount = demoAccounts.find((account) => account.account_id === accountId) ?? demoAccounts[0];

  async function login(event) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      await onLogin({
        workspace_id: selectedAccount.workspace_id,
        account_id: selectedAccount.account_id,
        display_name: selectedAccount.display_name,
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
        <p>当前演示环境只开放三个固定身份。请选择与你本次测试任务对应的账号。</p>

        <fieldset className="login-role-fieldset fixed-account-fieldset">
          <legend>选择登录账号</legend>
          <div className="login-options">
            {demoAccounts.map((account) => {
              const Icon = account.icon;
              const selected = account.account_id === accountId;
              return (
                <button
                  className={selected ? 'selected' : ''}
                  key={account.account_id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setAccountId(account.account_id)}
                >
                  <span><Icon size={18} /></span>
                  <div><strong>{account.display_name}</strong><small>{account.description}</small></div>
                  <em>{selected ? '已选择' : account.label}</em>
                </button>
              );
            })}
          </div>
        </fieldset>

        {error && <div className="login-error">{error}</div>}
        <button className="login-submit" disabled={pending} type="submit">
          {pending ? '正在进入…' : `以${selectedAccount.label}身份进入`}
        </button>
        <small className="login-footnote">不支持新增账号或临时切换角色；身份与权限由服务端固定校验。</small>
      </form>
    </main>
  );
}
