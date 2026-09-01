import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';

const frontendRoot = fileURLToPath(new URL('../../..', import.meta.url));
const vite = await createServer({
  root: frontendRoot,
  appType: 'custom',
  configFile: false,
  logLevel: 'silent',
  plugins: [react()],
  server: { middlewareMode: true },
});
const [{ default: ProfileView }, { default: WorkbenchShell }] = await Promise.all([
  vite.ssrLoadModule('/src/components/profile/ProfileView.jsx'),
  vite.ssrLoadModule('/src/components/workbench/WorkbenchShell.jsx'),
]);
test.after(() => vite.close());

const roleDetail = {
  state: {
    id: 'role-1',
    title: '企业产品经理',
    department: '企业服务产品部',
    latest_artifacts: {},
    hc_context: {
      request_id: 'HC-001',
      status: 'APPROVED',
      job_basics: {
        recruitment_type: 'NEW_HEADCOUNT',
        headcount: 1,
        level: 'P7',
        reporting_line: '产品负责人',
        locations: ['上海'],
        employment_type: '全职',
        salary_range: '40k–60k',
      },
    },
  },
};

const noop = () => {};
const profileProps = (viewerRole, actualActorRole, detail = roleDetail) => ({
  viewerRole,
  actualActorRole,
  roleDetail: detail,
  loading: false,
  error: '',
  onRetry: noop,
  onOpenEvidence: noop,
  onArtifactAction: noop,
  agentStatus: 'idle',
});

function renderProfile(viewerRole, actualActorRole = viewerRole === 'hr' ? 'HR' : 'MANAGER') {
  return renderToStaticMarkup(React.createElement(
    ProfileView,
    profileProps(viewerRole, actualActorRole),
  ));
}

function renderShell(actorRole) {
  const actor = { role: actorRole, display_name: actorRole === 'ADMIN' ? '管理员' : '用人经理' };
  return renderToStaticMarkup(React.createElement(WorkbenchShell, {
    identity: {
      actor,
      conversationActor: actor,
      effectiveActorRole: actorRole === 'ADMIN' ? 'MANAGER' : actorRole,
      viewerRole: 'manager',
      adminTestRole: 'MANAGER',
    },
    workspace: {
      activeRole: {
        id: 'role-1',
        name: '企业产品经理',
        team: '企业服务产品部',
        stage: '画像待确认',
        stageTone: 'active',
        meta: 'HC 已审批',
        version: '未生成画像',
        updatedAt: '9/1',
      },
      activeView: 'admin-trace',
      requestError: '',
      roleDetail,
      roleDetailLoading: false,
      roleDetailError: '',
      evidence: null,
      agentEvents: [],
      agentStatus: 'idle',
      messages: [],
      clarificationPolicy: null,
    },
    actions: {
      openHcLanding: noop,
      handleAdminTestRoleChange: noop,
      setActiveView: noop,
      handleLogout: noop,
      setRequestError: noop,
      setEvidenceId: noop,
      sendMessage: noop,
      extendClarification: noop,
      setRoleDetailReloadKey: noop,
      handleArtifactAction: noop,
    },
  }));
}

test('经理保留岗位说明和人才画像动作，但看不到 HR 招聘画像', () => {
  const html = renderProfile('manager');
  assert.match(html, />岗位说明</);
  assert.match(html, />目标人才画像</);
  assert.match(html, /生成岗位说明/);
  assert.match(html, /按权限可见/);
  assert.doesNotMatch(html, />招聘画像</);
});

test('HR 保留招聘画像入口和薪酬信息，只读其他岗位产物', () => {
  const html = renderProfile('hr');
  assert.match(html, />招聘画像</);
  assert.match(html, /40k–60k/);
  assert.match(html, /生成招聘画像/);
  assert.match(html, />岗位说明</);
  assert.match(html, />目标人才画像</);
});

test('只有真实管理员身份显示并渲染 Trace 控制台', () => {
  const adminHtml = renderShell('ADMIN');
  const managerHtml = renderShell('MANAGER');
  assert.match(adminHtml, /Agent Trace 控制台/);
  assert.match(adminHtml, /企业管理员最高权限/);
  assert.doesNotMatch(managerHtml, /Agent Trace 控制台/);
  assert.doesNotMatch(managerHtml, /企业管理员最高权限/);
});

test('历史岗位画像仍能渲染定义明细和证据引用', () => {
  const historicalRoleDetail = {
    state: {
      ...roleDetail.state,
      latest_artifacts: {
        ROLE_PROFILE: {
          id: 'artifact-legacy',
          version: 3,
          status: 'CONFIRMED',
          content: {
            schema_version: '2',
            stage: 'JOB_DESCRIPTION_CONFIRMED',
            job_description: {
              hiring_background: {
                business_change: '企业服务转向标准产品经营',
                organization_gap: '缺少产品化责任主体',
                hiring_conclusion: '新增企业产品经理',
                evidence_refs: ['E-01'],
              },
              job_purpose: {
                statement: '推动企业产品标准化经营',
                evidence_refs: ['E-01'],
              },
              key_accountabilities: [{
                id: 'KRA-01',
                name: '产品边界',
                responsibility: '识别共性并定义产品边界',
                core_outputs: ['标准产品方案'],
                success_outcome_refs: ['O-01'],
                evidence_refs: ['E-01'],
              }],
              success_criteria: [],
              work_scenarios: [],
              boundaries: {},
            },
          },
        },
      },
    },
  };
  const html = renderToStaticMarkup(React.createElement(
    ProfileView,
    profileProps('manager', 'MANAGER', historicalRoleDetail),
  ));
  assert.match(html, /推动企业产品标准化经营/);
  assert.match(html, /持续承担的责任/);
  assert.match(html, /识别共性并定义产品边界/);
  assert.match(html, /E-01/);
});
