export const hcProgress = (hc) => {
  if (hc.clarification_task?.status === 'IN_PROGRESS') {
    return { status: '进行中', action: '进入原会话', tone: 'continue' };
  }
  if (hc.clarification_task?.status === 'OPEN') {
    return hc.notification_delivery?.status === 'SENT'
      ? { status: '已提醒', action: '开始澄清', tone: 'reminded' }
      : { status: '待澄清', action: '开始澄清', tone: 'new' };
  }
  if (hc.clarification_status === 'PROFILE_READY') {
    return {
      status: hc.role_stage === 'PROFILE_DRAFT' ? '画像待确认' : '画像已确认',
      action: '查看并继续',
      tone: 'ready',
    };
  }
  if (hc.clarification_status === 'IN_PROGRESS' || hc.role_session_id) {
    return { status: '进行中', action: '进入原会话', tone: 'continue' };
  }
  return { status: '待澄清', action: '开始澄清', tone: 'new' };
};
