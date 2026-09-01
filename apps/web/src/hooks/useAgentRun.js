import { useCallback, useEffect, useRef, useState } from 'react';

const roleRefreshingArtifacts = new Set([
  'ROLE_PROFILE',
  'ASSESSMENT_SCORECARD',
  'PUBLIC_JD',
]);

export function startAgentRunStream({
  streamAgentRun,
  streamUrl,
  roleId,
  appendEvent,
  setStatus,
  refreshRole,
  refreshConversation,
  reportError,
}) {
  const reportRefreshError = (error) => reportError(error?.message ?? String(error));
  const onEvent = (event) => {
    appendEvent(event);
    if (event.type === 'agent.status') setStatus(event.payload.status);
    if (
      event.type === 'artifact.updated'
      && roleRefreshingArtifacts.has(event.payload.artifact_type)
    ) {
      refreshRole(roleId).catch(reportRefreshError);
    }
    if (event.type === 'run.completed') {
      setStatus('completed');
      Promise.all([refreshRole(roleId), refreshConversation(roleId)]).catch(reportRefreshError);
    }
    if (event.type === 'assistant.completed' || event.type === 'clarification.limit.reached') {
      refreshConversation(roleId).catch(reportRefreshError);
    }
    if (event.type === 'run.failed') {
      setStatus('failed');
      reportError(event.payload.message ?? 'Agent Run 失败');
      refreshConversation(roleId).catch(() => {});
    }
  };
  const onDisconnect = () => setStatus((current) => current === 'running' ? 'reconnecting' : current);
  return streamAgentRun(streamUrl, onEvent, onDisconnect);
}

export function useAgentRun(streamAgentRun) {
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState('idle');
  const stopRef = useRef(null);

  const stop = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
  }, []);

  const reset = useCallback(() => {
    stop();
    setEvents([]);
    setStatus('idle');
  }, [stop]);

  const connect = useCallback((runInfo, options) => {
    stop();
    setEvents([]);
    setStatus('running');
    stopRef.current = startAgentRunStream({
      streamAgentRun,
      streamUrl: runInfo.stream_url,
      appendEvent: (event) => setEvents((current) => [...current, event]),
      setStatus,
      ...options,
    });
  }, [stop, streamAgentRun]);

  useEffect(() => stop, [stop]);

  return {
    events,
    status,
    setStatus,
    connect,
    stop,
    reset,
  };
}
