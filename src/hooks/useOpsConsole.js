import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import {
  emptyDailyCultivation,
  emptyJob,
  emptyLogView,
  emptyRoleStates,
  logNameForJob,
  textToArgs,
  trimLogLines,
  withUiId,
} from '../lib/ops';

export function useOpsConsole() {
  const [jobs, setJobs] = useState([]);
  const [scripts, setScripts] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [logView, setLogView] = useState(emptyLogView());
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [dailyCultivation, setDailyCultivation] = useState(emptyDailyCultivation);
  const [roleStates, setRoleStates] = useState(emptyRoleStates);
  const [gameView, setGameView] = useState(null);
  const logRef = useRef(null);
  const selectedIdRef = useRef('');
  const selectedLogNameRef = useRef('');
  const logRequestIdRef = useRef(0);

  const selectedJob = useMemo(
    () => jobs.find((job) => job._uiId === selectedId) || jobs[0] || null,
    [jobs, selectedId],
  );

  function patchJobRuntime(name, runtime) {
    const targetName = String(name || '');
    if (!targetName) return;

    setJobs((items) => items.map((job) => (
      job.name === targetName || job.previousName === targetName
        ? { ...job, runtime: runtime || { running: false } }
        : job
    )));
  }

  function patchJobResults(results) {
    if (!Array.isArray(results) || !results.length) return;
    const statusByName = new Map(
      results
        .filter((result) => result?.name && result.status)
        .map((result) => [result.name, result.status]),
    );
    if (!statusByName.size) return;

    setJobs((items) => items.map((job) => {
      const runtime = statusByName.get(job.name) || statusByName.get(job.previousName);
      return runtime ? { ...job, runtime } : job;
    }));
  }

  async function load(options = {}) {
    const currentSelectedId = options.selectedId ?? selectedIdRef.current;
    const preferredName = options.preferredName ?? selectedLogNameRef.current ?? '';
    const previousName = options.previousName ?? '';
    const [scriptList, jobList, dailyStatus, nextRoleStates] = await Promise.all([
      api('/api/scripts'),
      api('/api/jobs'),
      api('/api/daily-cultivation'),
      api('/api/role-states'),
    ]);
    setScripts(scriptList);
    setDailyCultivation(dailyStatus);
    setRoleStates(nextRoleStates);
    const nextJobs = jobList.map(withUiId);
    setJobs(nextJobs);

    const nextSelected = nextJobs.find((job) => (
      job.name === preferredName
      || job.previousName === preferredName
      || job.name === previousName
      || job._uiId === currentSelectedId
    ));

    if (nextSelected) {
      selectedIdRef.current = nextSelected._uiId;
      selectedLogNameRef.current = logNameForJob(nextSelected);
      setSelectedId(nextSelected._uiId);
    } else if (!currentSelectedId && nextJobs[0]) {
      selectedIdRef.current = nextJobs[0]._uiId;
      selectedLogNameRef.current = logNameForJob(nextJobs[0]);
      setSelectedId(nextJobs[0]._uiId);
    } else if (currentSelectedId && !nextJobs.some((job) => job._uiId === currentSelectedId)) {
      const fallbackId = nextJobs[0]?._uiId || '';
      selectedIdRef.current = fallbackId;
      selectedLogNameRef.current = logNameForJob(nextJobs[0]);
      setSelectedId(fallbackId);
    }
  }

  async function loadLogs(name = logNameForJob(selectedJob)) {
    const targetName = String(name || '');
    const requestId = logRequestIdRef.current + 1;
    logRequestIdRef.current = requestId;

    if (!targetName) {
      setLogView(emptyLogView());
      return;
    }

    setLogView(emptyLogView(targetName, true));
    const nextLogs = trimLogLines(await api(`/api/jobs/${encodeURIComponent(targetName)}/logs?limit=700`));
    if (logRequestIdRef.current === requestId && selectedLogNameRef.current === targetName) {
      setLogView({ name: targetName, text: nextLogs, loading: false });
    }
  }

  async function runAction(action, options = {}) {
    const preferredName = options.preferredName ?? selectedJob?.name ?? '';
    const previousName = options.previousName ?? selectedJob?.previousName ?? '';
    setBusy(true);
    setMessage('');
    try {
      const result = await action();
      if (Array.isArray(result)) {
        patchJobResults(result);
      } else if (preferredName && typeof result?.running === 'boolean') {
        patchJobRuntime(preferredName, result);
      }
      await load({ preferredName, previousName });
      if (preferredName) await loadLogs(preferredName);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  function updateSelected(patch) {
    if (!selectedJob) return;
    setJobs((items) => items.map((job) => (
      job._uiId === selectedJob._uiId ? { ...job, ...patch } : job
    )));
  }

  function addJob() {
    const job = emptyJob(scripts);
    setJobs((items) => [...items, job]);
    selectedIdRef.current = job._uiId;
    selectedLogNameRef.current = logNameForJob(job);
    setSelectedId(job._uiId);
    setLogView(emptyLogView(logNameForJob(job)));
  }

  function removeSelected() {
    if (!selectedJob) return;
    setJobs((items) => items.filter((job) => job._uiId !== selectedJob._uiId));
    selectedIdRef.current = '';
    selectedLogNameRef.current = '';
    setSelectedId('');
    setLogView(emptyLogView());
  }

  function selectJob(job) {
    const logName = logNameForJob(job);
    selectedIdRef.current = job._uiId;
    selectedLogNameRef.current = logName;
    setSelectedId(job._uiId);
    setLogView(emptyLogView(logName, true));
  }

  function serializeJobs() {
    return jobs.map((job) => ({
      name: job.name,
      previousName: job.previousName || job.name,
      script: job.script,
      enabled: job.enabled !== false,
      args: Array.isArray(job.args) ? job.args : textToArgs(job.args),
      env: job.env || {},
      notes: job.notes || '',
      recoveryId: job.recoveryId || '',
    }));
  }

  async function copyRecoveryId() {
    const recoveryId = selectedJob?.recoveryId || '';
    if (!recoveryId) {
      setMessage('当前角色没有续玩编号。');
      return;
    }

    await navigator.clipboard?.writeText(recoveryId);
    setMessage('续玩编号已复制。');
  }

  function openGameView() {
    const recoveryId = selectedJob?.recoveryId || '';
    if (!selectedJob || !recoveryId) {
      setMessage('当前角色没有续玩编号，无法打开游戏窗口。');
      return;
    }

    setGameView({
      name: selectedJob.name,
      recoveryId,
      url: `/game?recoveryId=${encodeURIComponent(recoveryId)}&t=${Date.now()}`,
    });
  }

  function refresh() {
    return runAction(load);
  }

  function startAll() {
    return runAction(() => api('/api/jobs/start-all', { method: 'POST' }));
  }

  function stopAll() {
    return runAction(() => api('/api/jobs/stop-all', { method: 'POST' }));
  }

  function runDailyCultivation() {
    return runAction(() => api('/api/daily-cultivation/run', { method: 'POST', body: JSON.stringify({}) }));
  }

  function refreshRoleStates() {
    return runAction(() => api('/api/role-states/refresh', { method: 'POST', body: JSON.stringify({}) }));
  }

  useEffect(() => {
    load().catch((error) => setMessage(error.message));
  }, []);

  useEffect(() => {
    if (!selectedJob) return;
    selectedIdRef.current = selectedJob._uiId;
    selectedLogNameRef.current = logNameForJob(selectedJob);
    loadLogs(logNameForJob(selectedJob)).catch((error) => setMessage(error.message));
  }, [selectedId]);

  useEffect(() => {
    const events = new EventSource('/api/events');
    events.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === 'log' && payload.name === selectedLogNameRef.current) {
        setLogView((value) => (
          value.name === payload.name
            ? { name: payload.name, text: trimLogLines(`${value.text}${payload.text}`), loading: false }
            : value
        ));
      }
      if (payload.type === 'log_reset' && payload.name === selectedLogNameRef.current) {
        setLogView(emptyLogView(payload.name));
      }
      if (payload.type === 'status') {
        patchJobRuntime(payload.name, payload.status);
      }
      if (payload.type === 'config') {
        load({ preferredName: selectedLogNameRef.current, selectedId: selectedIdRef.current }).catch(() => {});
      }
      if (payload.type === 'daily_cultivation') {
        setDailyCultivation({
          dayKey: payload.dayKey || '',
          updatedAt: payload.updatedAt || '',
          lastRunAt: payload.lastRunAt || '',
          records: payload.records || [],
          runs: payload.runs || [],
        });
      }
      if (payload.type === 'role_states') {
        setRoleStates({
          updatedAt: payload.updatedAt || '',
          lastRefreshAt: payload.lastRefreshAt || '',
          records: payload.records || [],
          refreshes: payload.refreshes || [],
        });
      }
    };
    return () => events.close();
  }, []);

  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logView.name, logView.text]);

  return {
    addJob,
    api,
    busy,
    copyRecoveryId,
    dailyCultivation,
    gameView,
    jobs,
    load,
    logRef,
    logView,
    message,
    openGameView,
    refresh,
    removeSelected,
    refreshRoleStates,
    runAction,
    runDailyCultivation,
    roleStates,
    scripts,
    selectJob,
    selectedJob,
    serializeJobs,
    setGameView,
    startAll,
    stopAll,
    updateSelected,
  };
}
