const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
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
    );
  }
  return payload;
}

export const api = {
  login(userId) {
    return request('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    });
  },
  logout() {
    return request('/api/v1/auth/logout', { method: 'POST' });
  },
  me() {
    return request('/api/v1/auth/me');
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
  createRoleSession(input) {
    return request('/api/v1/role-sessions', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  syncContext(id, expectedRevision) {
    return request(`/api/v1/role-sessions/${id}/context:sync`, {
      method: 'POST',
      body: JSON.stringify({ expected_revision: expectedRevision }),
    });
  },
  sendMessage(id, content, expectedRevision) {
    return request(`/api/v1/role-sessions/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, expected_revision: expectedRevision }),
    });
  },
  extendClarification(id, reason) {
    return request(`/api/v1/role-sessions/${id}/clarification:extend`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
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
  generateArtifact(id, type) {
    return request(`/api/v1/role-sessions/${id}/artifacts/${type}/generate`, {
      method: 'POST',
    });
  },
  confirmArtifact(id, artifactId, contentHash, expectedRevision) {
    return request(`/api/v1/role-sessions/${id}/artifacts/${artifactId}:confirm`, {
      method: 'POST',
      body: JSON.stringify({
        content_hash: contentHash,
        expected_revision: expectedRevision,
      }),
    });
  },
  streamAgentRun(streamUrl, onEvent, onDisconnect) {
    const source = new EventSource(`${API_BASE}${streamUrl}`, { withCredentials: true });
    const names = [
      'run.started',
      'agent.status',
      'message.accepted',
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
