const request = async (path, options = {}) => {
  const response = await fetch(path, {
    credentials: 'include',
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `请求失败（${response.status}）`);
  }
  return payload;
};

export const hcIntakeApi = {
  listApproved() {
    return request('/api/v1/intake/hc-approvals');
  },
  start(approvalId) {
    return request(`/api/v1/intake/hc-approvals/${encodeURIComponent(approvalId)}`, {
      method: 'POST',
    });
  },
};
