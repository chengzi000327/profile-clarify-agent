import React from 'react';
import {
  ArrowDown,
  ArrowRight,
  Bot,
  Braces,
  Check,
  CheckCircle2,
  Database,
  FileCheck2,
  GitBranch,
  Layers3,
  LockKeyhole,
  MessageCircle,
  Route,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Wrench,
} from 'lucide-react';

const tighteningLayers = [
  {
    number: '01',
    title: '先路由，再执行',
    description: '所有自由文本先交给 Flash Router。它可以回答、追问或交接任务，但工具列表永远为空。',
    proof: 'RESPOND / ASK / HANDOFF',
    icon: Route,
  },
  {
    number: '02',
    title: '按任务隐藏工具',
    description: '领域 Agent 创建时只注入当前任务需要的 Tool Schema。模型看不到，就无法误选。',
    proof: 'tools.restrict()',
    icon: Layers3,
  },
  {
    number: '03',
    title: '执行器再次核验',
    description: 'Executor 同时拒绝白名单外工具，并检查必需工具是否真的成功，不只检查最终回答。',
    proof: 'allowed + required',
    icon: CheckCircle2,
  },
  {
    number: '04',
    title: '内部 API 绑定活跃 Run',
    description: '工具请求必须能映射到当前岗位和正在运行的任务；过期、伪造或越界调用直接返回 403。',
    proof: 'active run policy',
    icon: LockKeyhole,
  },
  {
    number: '05',
    title: '业务服务最终裁决',
    description: '租户、成员、角色、阶段、字段可见域、PII、Schema、版本和乐观锁仍由业务层校验。',
    proof: 'server-side authority',
    icon: ShieldCheck,
  },
  {
    number: '06',
    title: '正式决定留给人',
    description: '模型只能生成草稿或提出信号，不能确认事实、发布 JD、审核信号或替经理修改正式画像。',
    proof: 'human approval',
    icon: UserCheck,
  },
];

const tools = [
  ['read_role_state', '读取按角色和任务过滤后的最小岗位状态', '澄清、校准'],
  ['update_role_identity_draft', '记录明确提到的岗位名称或团队草稿', '澄清可选'],
  ['save_fact_draft', '保存招聘原因、成功标准或约束草稿', '澄清必需'],
  ['save_artifact_draft', '保存画像、评分卡、JD 或 HR Brief 草稿', '已注册，当前不暴露'],
  ['save_candidate_evidence', '保存脱敏候选人证据', '已注册，当前不暴露'],
  ['propose_calibration_signal', '提出待 HR 审核的校准信号', '校准必需'],
  ['read_version_diff', '读取两个正式产物版本的授权差异', '版本比较必需'],
];

const scenarios = [
  {
    label: '一句“你好”',
    tone: 'cyan',
    steps: ['保存用户消息', 'Flash Router 调用模型', '返回自然语言 RESPOND', 'SSE 推送回复'],
    result: '1 次模型调用 · 0 个工具 · 0 次业务写入',
  },
  {
    label: '补充招聘原因',
    tone: 'blue',
    steps: ['Flash Router 识别', '交接 CLARIFY_MESSAGE', '读取最小岗位状态', '保存 DRAFT 并追问'],
    result: '2 次模型调用 · 3 个工具可见 · 2 个工具必需',
  },
  {
    label: '生成岗位画像',
    tone: 'orange',
    steps: ['服务端检查生成门禁', 'Pro 接收已确认事实', '输出严格结构化 JSON', 'API 校验后保存'],
    result: '领域模型直达 · 0 个工具 · Caller 持久化',
  },
];

export default function App() {
  const workspaceUrl = import.meta.env.VITE_WORKSPACE_URL || 'http://localhost:5173';

  return (
    <main className="about-agent-page" id="top">
      <header className="about-topbar">
        <a className="about-wordmark" href="#top" aria-label="返回页面顶部">
          <span><Sparkles size={18} /></span>
          <strong>画像澄清 Agent</strong>
        </a>
        <nav aria-label="页面导航">
          <a href="#about-why">为什么</a>
          <a href="#about-architecture">架构</a>
          <a href="#about-tightening">如何收紧</a>
          <a href="#about-implementation">具体实现</a>
        </nav>
        <a className="about-enter-button" href={workspaceUrl}>
          打开工作台 <ArrowRight size={16} />
        </a>
      </header>

      <section className="about-hero">
        <div className="about-hero-copy">
          <span className="about-eyebrow"><span /> ROLE CLARIFIER · SYSTEM DESIGN</span>
          <h1>把一句模糊的招聘需求，<em>收紧</em>成一条可信的决策链。</h1>
          <p>
            画像澄清 Agent 不是一个“帮我写 JD”的聊天机器人。它从招聘原因出发，逐步沉淀成功标准、岗位画像、评估方案和公开 JD，并让每个结论都能回到事实、权限和人的确认。
          </p>
          <div className="about-hero-actions">
            <a className="about-primary-link" href="#about-architecture">查看系统架构 <ArrowDown size={16} /></a>
            <a className="about-secondary-link" href="#about-tightening">我们如何控制风险</a>
          </div>
        </div>

        <div className="about-hero-system" aria-label="画像澄清 Agent 核心处理链路">
          <div className="hero-system-header">
            <span>一次用户输入</span>
            <code>RUN / 8F2A</code>
          </div>
          <div className="hero-message"><MessageCircle size={18} /><span>“我们要招一位企业产品经理，半年内把交付经验沉淀成标准产品。”</span></div>
          <div className="hero-route-line"><span /><em>MODEL ROUTING</em><span /></div>
          <div className="hero-router-card">
            <div><Route size={18} /><strong>Flash Router</strong></div>
            <small>无工具 · 只做理解与分流</small>
            <div className="hero-route-options"><span>RESPOND</span><span>ASK</span><span className="selected">HANDOFF</span></div>
          </div>
          <div className="hero-policy-row">
            <div><LockKeyhole size={16} /><span>权限与阶段门禁</span><Check size={14} /></div>
            <div><Wrench size={16} /><span>任务级工具白名单</span><Check size={14} /></div>
          </div>
          <div className="hero-domain-card">
            <span className="hero-domain-index">01</span>
            <div><small>DOMAIN TASK</small><strong>CLARIFY_MESSAGE</strong></div>
            <code>3 tools visible</code>
          </div>
          <div className="hero-system-footer"><span><Database size={14} />只保存 DRAFT</span><span><FileCheck2 size={14} />等待人类确认</span></div>
        </div>
      </section>

      <section className="about-numbers" aria-label="系统关键数字">
        <div><strong>3</strong><span>Router 动作</span><small>回答 / 追问 / 交接</small></div>
        <div><strong>8</strong><span>领域任务</span><small>7 个可路由 + 1 个明确入口</small></div>
        <div><strong>7</strong><span>注册工具</span><small>按任务最小暴露</small></div>
        <div><strong>4</strong><span>核心产物</span><small>画像 / 评分卡 / JD / HR Brief</small></div>
      </section>

      <section className="about-section about-why" id="about-why">
        <div className="about-section-heading">
          <span>01 · WHY</span>
          <h2>招聘真正缺的，不是更多文字，<br />而是更少的误解。</h2>
          <p>传统需求会和通用大模型很容易快速得到一份“像 JD 的内容”，却没有解决事实从哪里来、谁有权决定、招聘团队如何执行。</p>
        </div>
        <div className="why-grid">
          <article>
            <span className="why-index">A</span>
            <h3>业务语言不是岗位定义</h3>
            <p>“找个懂 B 端的人”没有说明业务变化、组织缺口、成功结果，也无法稳定推导 Must-have。</p>
            <small>需要：从招聘原因反推成功标准</small>
          </article>
          <article>
            <span className="why-index">B</span>
            <h3>生成内容不等于正式事实</h3>
            <p>模型补全得越流畅，越容易把猜测包装成共识。未确认信息必须停留在草稿，而不是进入正式画像。</p>
            <small>需要：事实状态、来源和人工确认</small>
          </article>
          <article>
            <span className="why-index">C</span>
            <h3>一个 Agent 面对多重边界</h3>
            <p>经理、HR、候选人数据和公开 JD 的可见范围不同，Prompt 本身无法承担真正的权限控制。</p>
            <small>需要：服务端身份与字段级权限</small>
          </article>
        </div>

        <div className="decision-chain">
          <span className="chain-label">从一句需求到招聘执行</span>
          <div className="chain-flow">
            <div><small>WHY</small><strong>招聘原因</strong></div><ArrowRight size={18} />
            <div><small>OUTCOME</small><strong>成功标准</strong></div><ArrowRight size={18} />
            <div><small>ROLE</small><strong>岗位画像</strong></div><ArrowRight size={18} />
            <div><small>EVALUATE</small><strong>评估方案</strong></div><ArrowRight size={18} />
            <div><small>PUBLISH</small><strong>公开 JD</strong></div>
          </div>
          <p>每一步都只使用上游已确认事实；关键字段变化会让旧确认失效，而不是静默覆盖。</p>
        </div>
      </section>

      <section className="about-section about-architecture" id="about-architecture">
        <div className="about-section-heading split">
          <div><span>02 · ARCHITECTURE</span><h2>模型负责理解，<br />服务端负责边界。</h2></div>
          <p>自由文本和明确 API 入口分开处理。模型可以做它擅长的语义判断，但任务、权限、工具和持久化方式都由服务端确定。</p>
        </div>

        <div className="architecture-map">
          <div className="architecture-lane lane-input">
            <span className="lane-label">INPUT</span>
            <div className="lane-card"><MessageCircle size={20} /><strong>自由文本</strong><small>问候、查询、补充事实、生成请求</small></div>
            <div className="lane-card muted"><Braces size={20} /><strong>明确 API</strong><small>生成产物、导入候选人</small></div>
          </div>

          <div className="architecture-arrow"><ArrowRight size={22} /></div>

          <div className="architecture-lane lane-route">
            <span className="lane-label">ROUTE</span>
            <div className="lane-card featured"><Route size={20} /><strong>Flash Router</strong><small>工具数固定为 0</small></div>
            <div className="route-branches"><span>RESPOND</span><span>ASK</span><span>HANDOFF</span></div>
          </div>

          <div className="architecture-arrow"><ArrowRight size={22} /></div>

          <div className="architecture-lane lane-policy">
            <span className="lane-label">CONTROL</span>
            <div className="lane-card"><ShieldCheck size={20} /><strong>服务端门禁</strong><small>角色 · 阶段 · 数据条件</small></div>
            <div className="lane-card"><Wrench size={20} /><strong>任务策略</strong><small>允许工具 · 必需工具 · 上限</small></div>
          </div>

          <div className="architecture-arrow"><ArrowRight size={22} /></div>

          <div className="architecture-lane lane-domain">
            <span className="lane-label">EXECUTE</span>
            <div className="lane-card featured dark"><Bot size={20} /><strong>领域 Agent</strong><small>Flash / Pro + 当前任务 Prompt</small></div>
            <div className="route-branches domain"><span>TOOL</span><span>CALLER</span><span>NONE</span></div>
          </div>

          <div className="architecture-arrow"><ArrowRight size={22} /></div>

          <div className="architecture-lane lane-store">
            <span className="lane-label">PERSIST</span>
            <div className="lane-card"><Database size={20} /><strong>业务事实层</strong><small>Schema · 版本 · Trace · 审计</small></div>
            <div className="lane-card human"><UserCheck size={20} /><strong>人工确认</strong><small>经理 / HR 的正式决策</small></div>
          </div>
        </div>

        <div className="architecture-note">
          <GitBranch size={22} />
          <div><strong>为什么有两种入口？</strong><p>聊天需要模型理解“用户到底想做什么”；点击“生成画像”或提交候选人批次时，意图已经明确，再调用 Router 只会增加成本和误判。</p></div>
        </div>
      </section>

      <section className="about-section about-tightening" id="about-tightening">
        <div className="about-section-heading split light">
          <div><span>03 · TIGHTENING</span><h2>不是告诉模型<br />“请不要越界”。</h2></div>
          <p>Prompt 是第一层行为约束，但不是安全边界。真正的收紧来自模型可见面、执行器、内部 API 和业务服务的重复校验。</p>
        </div>
        <div className="tightening-list">
          {tighteningLayers.map((item) => {
            const Icon = item.icon;
            return (
              <article key={item.number}>
                <span className="tightening-number">{item.number}</span>
                <span className="tightening-icon"><Icon size={20} /></span>
                <div><h3>{item.title}</h3><p>{item.description}</p></div>
                <code>{item.proof}</code>
              </article>
            );
          })}
        </div>
        <div className="tightening-summary">
          <span>Prompt</span><ArrowRight size={16} /><span>Schema 可见性</span><ArrowRight size={16} /><span>Executor</span><ArrowRight size={16} /><span>内部 API</span><ArrowRight size={16} /><span>业务鉴权</span><ArrowRight size={16} /><strong>人类决定</strong>
        </div>
      </section>

      <section className="about-section about-implementation" id="about-implementation">
        <div className="about-section-heading split">
          <div><span>04 · IMPLEMENTATION</span><h2>具体到代码，<br />我们做了什么？</h2></div>
          <p>运行方式、Prompt、工具策略和写入规则都只有一个明确来源，避免文档里说一套、运行时执行另一套。</p>
        </div>

        <div className="implementation-grid">
          <article className="implementation-lead">
            <span className="implementation-kicker">RUNTIME</span>
            <h3>Sidecar-only，删除运行时分叉</h3>
            <p>所有产品请求固定经过真实 DeepSeek Harness Sidecar。没有 `HARNESS_MODE`，也没有问候或失败时偷偷切回本地固定回复的路径。</p>
            <div><code>deepseek-v4-flash</code><code>deepseek-v4-pro</code></div>
          </article>
          <article>
            <span className="implementation-kicker">PROMPT</span>
            <h3>Router 与 Domain 分开</h3>
            <p>`P-02` 只负责无工具路由；`P-01` 负责领域总规则；`P-03` 至 `P-07` 为产物和候选人任务提供严格 Schema。</p>
          </article>
          <article>
            <span className="implementation-kicker">POLICY</span>
            <h3>工具策略单一事实源</h3>
            <p>每个任务的 allowed / required 工具集中定义，Bundle、Executor、内部 API 和测试共同使用。</p>
          </article>
          <article>
            <span className="implementation-kicker">PERSISTENCE</span>
            <h3>复杂结果先校验再保存</h3>
            <p>四类产物和候选人证据采用 Caller 持久化：模型零工具输出 JSON，API 校验完整批次后再落库。</p>
          </article>
          <article>
            <span className="implementation-kicker">TRACE</span>
            <h3>答案和过程都能评测</h3>
            <p>Trace 记录 Router 动作、模型请求、可见工具、实际调用、Token、延迟和失败恢复，但不保存密钥或隐藏思维链。</p>
          </article>
        </div>

        <div className="tools-panel">
          <div className="tools-panel-heading">
            <div><Wrench size={22} /><span><strong>七个注册工具</strong><small>注册能力 ≠ 当前任务可见</small></span></div>
            <p>`read_role_state` 只读取服务端已经过滤的状态，它不是权限控制器。真正的身份来自登录会话和当前 Agent Run。</p>
          </div>
          <div className="tools-table" role="table" aria-label="七个自研工具">
            <div className="tools-row tools-head" role="row"><span>工具</span><span>作用</span><span>当前可见范围</span></div>
            {tools.map(([name, purpose, scope]) => (
              <div className="tools-row" role="row" key={name}>
                <code>{name}</code><span>{purpose}</span><small>{scope}</small>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="about-section about-scenarios">
        <div className="about-section-heading">
          <span>05 · THREE REQUESTS</span>
          <h2>同一个输入框，<br />三条完全不同的执行链。</h2>
        </div>
        <div className="scenario-grid">
          {scenarios.map((scenario) => (
            <article className={`scenario-card ${scenario.tone}`} key={scenario.label}>
              <div className="scenario-heading"><MessageCircle size={18} /><h3>{scenario.label}</h3></div>
              <ol>
                {scenario.steps.map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}
              </ol>
              <p>{scenario.result}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="about-final">
        <div>
          <span><Sparkles size={16} /> ROLE CLARIFIER</span>
          <h2>让模型参与判断，<br />但不让模型拥有决定权。</h2>
        </div>
        <div>
          <p>最终得到的不只是一份文案，而是一套可以继续招聘、评估、校准和追溯的岗位共识。</p>
          <a className="about-final-action" href={workspaceUrl}>进入工作台 <ArrowRight size={17} /></a>
        </div>
      </section>

      <footer className="about-footer">
        <span>岗位画像澄清 Agent</span>
        <span>MODEL-ROUTED · SERVER-GOVERNED · HUMAN-APPROVED</span>
      </footer>
    </main>
  );
}
