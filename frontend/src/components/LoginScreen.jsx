import React, { useState } from 'react';
import { Activity, BriefcaseBusiness, ShieldCheck, Users } from 'lucide-react';

const roles = [
  {
    value: 'MANAGER',
    label: '用人经理',
    description: '创建岗位、澄清成功标准并确认正式产物',
    icon: BriefcaseBusiness,
  },
  {
    value: 'HR',
    label: 'HR',
    description: '协作澄清、管理招聘画像、候选人证据与校准',
    icon: Users,
  },
  {
    value: 'ADMIN',
    label: '企业管理员',
    description: '企业空间最高权限，并可查看完整 Agent Trace',
    icon: Activity,
  },
];

export default function LoginScreen({ onLogin }) {
  const [role, setRole] = useState('MANAGER');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function login(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError('');
    try {
      await onLogin({
        workspace_id: form.get('workspaceId')?.toString().trim(),
        account_id: form.get('accountId')?.toString().trim(),
        display_name: form.get('displayName')?.toString().trim(),
        role,
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
        <p>先选择你本次使用的真实角色。账号与岗位数据绑定：同一账号会恢复历史内容，新账号会进入空工作台。</p>

        <div className="login-fields">
          <label>
            <span>企业空间 ID</span>
            <input name="workspaceId" defaultValue="demo-company" autoComplete="organization" required minLength={3} maxLength={64} />
            <small>同一企业空间内，企业管理员可查看组织级岗位与 Trace。</small>
          </label>
          <label>
            <span>账号</span>
            <input name="accountId" placeholder="例如 zhangsan 或工作邮箱" autoComplete="username" required minLength={3} maxLength={80} />
          </label>
          <label>
            <span>你的姓名</span>
            <input name="displayName" placeholder="例如 张三" autoComplete="name" required maxLength={40} />
          </label>
        </div>

        <fieldset className="login-role-fieldset">
          <legend>选择角色</legend>
          <div className="login-options">
            {roles.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  className={role === item.value ? 'selected' : ''}
                  key={item.value}
                  type="button"
                  aria-pressed={role === item.value}
                  onClick={() => setRole(item.value)}
                >
                  <span><Icon size={18} /></span>
                  <div><strong>{item.label}</strong><small>{item.description}</small></div>
                  <em>{role === item.value ? '已选择' : '选择'}</em>
                </button>
              );
            })}
          </div>
        </fieldset>

        {error && <div className="login-error">{error}</div>}
        <button className="login-submit" disabled={pending} type="submit">
          {pending ? '正在进入…' : '进入工作台'}
        </button>
        <small className="login-footnote">Demo 环境不设密码，请勿填写真实密码或敏感身份信息。</small>
      </form>
    </main>
  );
}
