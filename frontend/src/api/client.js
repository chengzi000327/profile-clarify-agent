const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export class ApiError extends Error {
  constructor(code, message, status, details) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      payload?.error?.code ?? 'REQUEST_FAILED',
      payload?.error?.message ?? `请求失败（${response.status}）`,
      response.status,
      payload?.error?.details,
    );
  }
  return payload;
}

export const api = {
  login(credentials) {
    return request('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
  },
  logout() {
    return request('/api/v1/auth/logout', { method: 'POST' });
  },
  me() {
    return request('/api/v1/auth/me');
  },
  listHcApprovals() {
    return request('/api/v1/hc-approvals');
  },
  openHcWorkspace(requestId) {
    return request(`/api/v1/hc-approvals/${encodeURIComponent(requestId)}/workspace`, {
      method: 'POST',
    });
  },
  listRoleSessions() {
    return request('/api/v1/role-sessions');
  },
  getRoleSession(id) {
    return request(`/api/v1/role-sessions/${id}`);
  },
  getMessages(id, afterSequence = 0) {
    return request(`/api/v1/role-sessions/${id}/messages?after_sequence=${afterSequence}`);
  },
  startIntake(content, testRole) {
    return request('/api/v1/intake/messages', {
      method: 'POST',
      body: JSON.stringify({ content, ...(testRole ? { test_role: testRole } : {}) }),
    });
  },
  syncContext(id, expectedRevision) {
    return request(`/api/v1/role-sessions/${id}/context:sync`, {
      method: 'POST',
      body: JSON.stringify({ expected_revision: expectedRevision }),
    });
  },
  sendMessage(id, content, expectedRevision, testRole) {
    return request(`/api/v1/role-sessions/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        content,
        expected_revision: expectedRevision,
        ...(testRole ? { test_role: testRole } : {}),
      }),
    });
  },
  extendClarification(id, reason) {
    return request(`/api/v1/role-sessions/${id}/clarification:extend`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },
  decideFact(id, factId, payload) {
    return request(`/api/v1/role-sessions/${id}/facts/${encodeURIComponent(factId)}:decide`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  listAdminRuns(filters = {}) {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => Boolean(value)),
    );
    return request(`/api/v1/admin/agent-runs${query.size ? `?${query}` : ''}`);
  },
  getAdminTrace(runId) {
    return request(`/api/v1/admin/agent-runs/${runId}/trace`);
  },
  getTraceAudits() {
    return request('/api/v1/admin/trace-audits');
  },
  updateAgentPolicy(initialBudget, extensionSize) {
    return request('/api/v1/admin/agent-policy', {
      method: 'PUT',
      body: JSON.stringify({ initial_budget: initialBudget, extension_size: extensionSize }),
    });
  },
  generateArtifact(id, type, testRole) {
    return request(`/api/v1/role-sessions/${id}/artifacts/${type}/generate`, {
      method: 'POST',
      body: JSON.stringify(testRole ? { test_role: testRole } : {}),
    });
  },
  confirmArtifact(id, artifactId, contentHash, expectedRevision, testRole) {
    return request(`/api/v1/role-sessions/${id}/artifacts/${artifactId}:confirm`, {
      method: 'POST',
      body: JSON.stringify({
        content_hash: contentHash,
        expected_revision: expectedRevision,
        ...(testRole ? { test_role: testRole } : {}),
      }),
    });
  },
  streamAgentRun(streamUrl, onEvent, onDisconnect) {
    const source = new EventSource(`${API_BASE}${streamUrl}`, { withCredentials: true });
    const names = [
      'run.started',
      'agent.status',
      'message.accepted',
      'context.snapshot',
      'context.retrieval_failed',
      'assistant.delta',
      'assistant.completed',
      'tool.started',
      'tool.completed',
      'question.ready',
      'clarification.round.opened',
      'clarification.round.completed',
      'clarification.limit.reached',
      'artifact.updated',
      'run.completed',
      'run.failed',
    ];
    for (const name of names) {
      source.addEventListener(name, (event) => {
        const payload = JSON.parse(event.data);
        onEvent(payload);
        if (name === 'run.completed' || name === 'run.failed') source.close();
      });
    }
    source.onerror = () => onDisconnect?.();
    return () => source.close();
  },
};

export { API_BASE };
