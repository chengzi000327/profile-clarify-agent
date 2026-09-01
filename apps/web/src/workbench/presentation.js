export const stagePresentation = {
  CREATED: ['待同步背景', 'active'],
  CONTEXT_SYNCING: ['正在同步背景', 'active'],
  REASON_CLARIFYING: ['招聘原因澄清', 'active'],
  SUCCESS_CLARIFYING: ['成功标准澄清', 'active'],
  PROFILE_DRAFT: ['画像待确认', 'active'],
  PROFILE_CONFIRMED: ['画像已确认', 'confirmed'],
  ASSESSMENT_DRAFT: ['评估方案待确认', 'active'],
  ASSESSMENT_CONFIRMED: ['评估方案已确认', 'confirmed'],
  JD_DRAFT: ['JD 待确认', 'active'],
  JD_CONFIRMED: ['JD 已确认', 'confirmed'],
  HR_BRIEF_DRAFT: ['HR 画像待确认', 'active'],
  HR_BRIEF_CONFIRMED: ['HR 画像已确认', 'confirmed'],
  RECRUITING: ['招聘进行中', 'confirmed'],
  CALIBRATION_OBSERVING: ['校准观察期', 'calibrating'],
  CALIBRATION_HR_REVIEW: ['等待 HR 审核', 'calibrating'],
  CALIBRATION_MANAGER_REVIEW: ['等待经理校准', 'calibrating'],
  READY_TO_PUBLISH: ['发布准备完成', 'confirmed'],
  ARCHIVED: ['已归档', 'confirmed'],
};

export const actorRoleLabel = {
  MANAGER: '用人经理',
  HR: 'HR 招聘负责人',
  ADMIN: '企业管理员 · 最高权限',
};

export const recruitmentTypeLabel = {
  NEW_HEADCOUNT: '新增编制',
  REPLACEMENT: '人员替换',
  ATTRITION_REPLACEMENT: '离职补充',
  PERFORMANCE_REPLACEMENT: '汰换补充',
  ORGANIZATION_ADJUSTMENT: '组织调整',
  OTHER: '其他补充',
};

export function displayInitial(name, role) {
  const value = String(name ?? '').trim();
  if (value) return Array.from(value)[0];
  return role === 'ADMIN' ? '管' : role === 'HR' ? 'HR' : '用';
}

export function toRoleCard(state) {
  const [stage, stageTone] = stagePresentation[state.stage] ?? [state.stage, 'active'];
  const latestProfile = state.latest_artifacts?.ROLE_PROFILE;
  return {
    id: state.id,
    name: state.title,
    team: state.department,
    stage,
    stageTone,
    meta: state.hc_status === 'APPROVED' ? 'HC 已审批' : 'HC 待审批',
    version: latestProfile ? `画像 v${latestProfile.version}` : '未生成画像',
    updatedAt: new Date(state.updated_at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }),
    unread: 0,
    apiState: state,
  };
}

export function roleBasicInfo(state, viewerRole) {
  const hc = state?.hc_context;
  const basics = hc?.job_basics;
  const recruitmentType = basics?.recruitment_type
    ? `${recruitmentTypeLabel[basics.recruitment_type] ?? basics.recruitment_type} · ${basics.headcount} 人`
    : 'HC 审批数据待同步';
  return [
    { label: '所属团队', value: state?.department ?? '待同步', confirmed: Boolean(state?.department) },
    { label: '招聘类型', value: recruitmentType },
    { label: '职级', value: basics?.level ?? '待同步' },
    { label: '汇报对象', value: basics?.reporting_line ?? '待同步' },
    { label: '工作地点', value: basics?.locations?.join(' / ') ?? '待同步' },
    { label: '雇佣类型', value: basics?.employment_type ?? '待同步' },
    { label: '薪酬范围', value: viewerRole === 'manager' ? '按权限可见' : basics?.salary_range ?? '待同步', restricted: viewerRole === 'manager' },
    { label: 'HC 状态', value: hc?.status === 'APPROVED' ? '已审批' : '待同步', confirmed: hc?.status === 'APPROVED' },
  ];
}
