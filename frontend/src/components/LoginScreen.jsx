import React, { useState } from 'react';
import { ShieldCheck, Users } from 'lucide-react';

export default function LoginScreen({ onLogin }) {
  const [pending, setPending] = useState(null);
  const [error, setError] = useState('');

  async function login(userId) {
    setPending(userId);
    setError('');
    try {
      await onLogin(userId);
    } catch (loginError) {
      setError(loginError.message);
      setPending(null);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-card">
        <div className="login-mark"><ShieldCheck size={24} /></div>
        <span className="login-kicker">ROLE CLARIFIER MVP</span>
        <h1>岗位画像澄清 Agent</h1>
        <p>测试环境使用两个真实后端账号。权限由 HttpOnly Session 决定，前端不能自行切换角色。</p>
        <div className="login-options">
          <button disabled={Boolean(pending)} onClick={() => login('manager-demo')}>
            <span><Users size={18} /></span>
            <div><strong>用人经理 · 陈曦</strong><small>确认事实、画像、评分卡与公开 JD</small></div>
            <em>{pending === 'manager-demo' ? '登录中…' : '进入工作台'}</em>
          </button>
          <button disabled={Boolean(pending)} onClick={() => login('hr-demo')}>
            <span><ShieldCheck size={18} /></span>
            <div><strong>HR · 林夏</strong><small>内部招聘画像、候选人证据与校准审核</small></div>
            <em>{pending === 'hr-demo' ? '登录中…' : '进入工作台'}</em>
          </button>
        </div>
        {error && <div className="login-error">{error}</div>}
        <small className="login-footnote">仅可使用合成或脱敏候选人数据</small>
      </section>
    </main>
  );
}
