import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { motion } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  CircleStop,
  Copy,
  ExternalLink,
  FileText,
  Flame,
  KeyRound,
  Leaf,
  ListPlus,
  Play,
  Power,
  Radio,
  RefreshCw,
  Save,
  ScrollText,
  Shield,
  Square,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import './styles.css';

const LOG_LINE_LIMIT = 700;

const makeUiId = () => (
  globalThis.crypto?.randomUUID?.() || `ui-${Date.now()}-${Math.random().toString(36).slice(2)}`
);

const stableJobId = (job) => `job:${job.name || makeUiId()}`;

const withUiId = (job) => ({
  ...job,
  _uiId: job._uiId || stableJobId(job),
  previousName: job.previousName || job.name,
});

const emptyJob = (scripts) => ({
  _uiId: makeUiId(),
  name: `job-${Math.floor(Date.now() % 100000)}`,
  script: scripts[0] || 'auto-danger.js',
  enabled: true,
  args: [],
  env: {},
  notes: '',
  recoveryId: '',
  recoveryIdMasked: '',
  hasRecoveryId: false,
  tokenMasked: '',
  hasToken: false,
  runtime: { running: false },
});

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || response.statusText);
  }
  const type = response.headers.get('content-type') || '';
  return type.includes('application/json') ? response.json() : response.text();
}

function envToText(env) {
  return Object.entries(env || {}).map(([key, value]) => `${key}=${value}`).join('\n');
}

function textToEnv(text) {
  const env = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return env;
}

function argsToText(args) {
  return Array.isArray(args) ? args.join(' ') : String(args || '');
}

function textToArgs(text) {
  return String(text || '').split(/\s+/).map((item) => item.trim()).filter(Boolean);
}

function trimLogLines(text, limit = LOG_LINE_LIMIT) {
  const lines = String(text || '').split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - limit)).join('\n');
}

function statusText(job) {
  if (job?.runtime?.running) return `运行中 · pid ${job.runtime.pid}`;
  if (job?.enabled === false) return '已停用';
  return '待命';
}

function scriptLabel(script) {
  return {
    'auto-priority.js': '综合优先',
    'auto-danger.js': '凶地探索',
    'auto-fudi.js': '福地探索',
    'auto-forage.js': '采药捕兽',
    'auto-xiulian.js': '修炼闭关',
  }[script] || script;
}

function scriptSigil(script) {
  return {
    'auto-priority.js': '策',
    'auto-danger.js': '凶',
    'auto-fudi.js': '福',
    'auto-forage.js': '采',
    'auto-xiulian.js': '修',
  }[script] || '令';
}

function ScriptIcon({ script }) {
  const icons = {
    'auto-priority.js': Shield,
    'auto-danger.js': Flame,
    'auto-fudi.js': Activity,
    'auto-forage.js': Leaf,
    'auto-xiulian.js': FileText,
  };
  const Icon = icons[script] || FileText;
  return <Icon size={16} />;
}

function App() {
  const [jobs, setJobs] = useState([]);
  const [scripts, setScripts] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [logs, setLogs] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [gameView, setGameView] = useState(null);
  const logRef = useRef(null);

  const selectedJob = useMemo(
    () => jobs.find((job) => job._uiId === selectedId) || jobs[0] || null,
    [jobs, selectedId],
  );

  async function load(options = {}) {
    const preferredName = options.preferredName ?? selectedJob?.name ?? '';
    const previousName = options.previousName ?? selectedJob?.previousName ?? '';
    const [scriptList, jobList] = await Promise.all([
      api('/api/scripts'),
      api('/api/jobs'),
    ]);
    setScripts(scriptList);
    const nextJobs = jobList.map(withUiId);
    setJobs(nextJobs);

    const nextSelected = nextJobs.find((job) => (
      job.name === preferredName
      || job.previousName === preferredName
      || job.name === previousName
      || job._uiId === selectedId
    ));

    if (nextSelected) setSelectedId(nextSelected._uiId);
    else if (!selectedId && nextJobs[0]) setSelectedId(nextJobs[0]._uiId);
    else if (selectedId && !nextJobs.some((job) => job._uiId === selectedId)) setSelectedId(nextJobs[0]?._uiId || '');
  }

  async function loadLogs(name = selectedJob?.name) {
    if (!name) {
      setLogs('');
      return;
    }
    setLogs(trimLogLines(await api(`/api/jobs/${encodeURIComponent(name)}/logs?limit=700`)));
  }

  async function runAction(action, options = {}) {
    const preferredName = options.preferredName ?? selectedJob?.name ?? '';
    const previousName = options.previousName ?? selectedJob?.previousName ?? '';
    setBusy(true);
    setMessage('');
    try {
      await action();
      await load({ preferredName, previousName });
      await loadLogs(preferredName);
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
    setSelectedId(job._uiId);
  }

  function removeSelected() {
    if (!selectedJob) return;
    setJobs((items) => items.filter((job) => job._uiId !== selectedJob._uiId));
    setSelectedId('');
  }

  function serializeJobs() {
    return jobs.map((job) => {
      const payload = {
        name: job.name,
        previousName: job.previousName || job.name,
        script: job.script,
        enabled: job.enabled !== false,
        args: Array.isArray(job.args) ? job.args : textToArgs(job.args),
        env: job.env || {},
        notes: job.notes || '',
        recoveryId: job.recoveryId || '',
      };
      return payload;
    });
  }

  async function copyRecoveryId() {
    const recoveryId = selectedJob?.recoveryId || '';
    if (!recoveryId) {
      setMessage('当前任务没有续玩编号。');
      return;
    }

    await navigator.clipboard?.writeText(recoveryId);
    setMessage('续玩编号已复制。');
  }

  function openGameView() {
    const recoveryId = selectedJob?.recoveryId || '';
    if (!selectedJob || !recoveryId) {
      setMessage('当前任务没有续玩编号，无法打开游戏窗口。');
      return;
    }

    setGameView({
      name: selectedJob.name,
      recoveryId,
      url: `/game?recoveryId=${encodeURIComponent(recoveryId)}&t=${Date.now()}`,
    });
  }

  useEffect(() => {
    load().catch((error) => setMessage(error.message));
  }, []);

  useEffect(() => {
    if (!selectedJob) return;
    loadLogs(selectedJob.name).catch(() => {});
  }, [selectedJob?._uiId]);

  useEffect(() => {
    const events = new EventSource('/api/events');
    events.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === 'log' && payload.name === selectedJob?.name) {
        setLogs((value) => trimLogLines(`${value}${payload.text}`));
      }
      if (payload.type === 'log_reset' && payload.name === selectedJob?.name) {
        setLogs('');
      }
      if (payload.type === 'status' || payload.type === 'config') {
        load({ preferredName: selectedJob?.name }).catch(() => {});
      }
    };
    return () => events.close();
  }, [selectedJob?.name]);

  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs, selectedJob?.name]);

  const runningCount = jobs.filter((job) => job.runtime?.running).length;
  const enabledCount = jobs.filter((job) => job.enabled !== false).length;

  return (
    <main className="ops-shell">
      <section className="topbar">
        <div>
          <motion.p initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="eyebrow">
            Xiuxian Operations
          </motion.p>
          <motion.h1 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            修仙脚本控制台
          </motion.h1>
        </div>
        <div className="top-actions">
          <button type="button" className="ghost-btn" onClick={() => runAction(load)} disabled={busy}>
            <RefreshCw size={16} />
            刷新
          </button>
          <button type="button" className="danger-btn" onClick={() => runAction(() => api('/api/jobs/stop-all', { method: 'POST' }))} disabled={busy}>
            <CircleStop size={16} />
            全部停止
          </button>
          <button type="button" className="primary-btn" onClick={() => runAction(() => api('/api/jobs/start-all', { method: 'POST' }))} disabled={busy}>
            <Power size={16} />
            启动启用项
          </button>
        </div>
      </section>

      <section className="metrics-grid">
        <div className="metric">
          <Radio size={18} />
          <span>运行</span>
          <strong>{runningCount}</strong>
        </div>
        <div className="metric">
          <Shield size={18} />
          <span>启用</span>
          <strong>{enabledCount}</strong>
        </div>
        <div className="metric">
          <ScrollText size={18} />
          <span>任务</span>
          <strong>{jobs.length}</strong>
        </div>
        <div className="metric warn">
          <AlertTriangle size={18} />
          <span>提示</span>
          <strong>{message ? '!' : 'OK'}</strong>
        </div>
      </section>

      {message ? <div className="message">{message}</div> : null}

      <section className="workspace">
        <aside className="jobs-pane">
          <div className="pane-head">
            <div>
              <span className="section-kicker">Jobs</span>
              <h2>任务编队</h2>
            </div>
            <button type="button" className="icon-btn" onClick={addJob} title="新增任务">
              <ListPlus size={18} />
            </button>
          </div>

          <div className="job-list">
            {jobs.map((job) => (
              <button
                type="button"
                key={job._uiId}
                className={`job-row ${job._uiId === selectedJob?._uiId ? 'selected' : ''} ${job.runtime?.running ? 'running' : ''}`}
                onClick={() => setSelectedId(job._uiId)}
              >
                <span className="job-sigil">{scriptSigil(job.script)}</span>
                <span className="job-copy">
                  <strong>{job.name}</strong>
                  <small>{scriptLabel(job.script)} · {statusText(job)}</small>
                </span>
                <span className="pulse-dot" />
              </button>
            ))}
          </div>
        </aside>

        <section className="detail-pane">
          <div className="pane-head">
            <div>
              <span className="section-kicker">Control</span>
              <h2>{selectedJob ? selectedJob.name : '未选择任务'}</h2>
            </div>
            <div className="control-strip">
              <button
                type="button"
                className="ghost-btn"
                disabled={!selectedJob || busy || selectedJob.runtime?.running}
                onClick={() => runAction(() => api(`/api/jobs/${encodeURIComponent(selectedJob.name)}/start`, { method: 'POST' }))}
              >
                <Play size={16} />
                启动
              </button>
              <button
                type="button"
                className="danger-btn"
                disabled={!selectedJob || busy || !selectedJob.runtime?.running}
                onClick={() => runAction(() => api(`/api/jobs/${encodeURIComponent(selectedJob.name)}/stop`, { method: 'POST' }))}
              >
                <Square size={16} />
                停止
              </button>
              <button
                type="button"
                className="ghost-btn"
                disabled={!selectedJob || !selectedJob.recoveryId}
                onClick={openGameView}
              >
                <ExternalLink size={16} />
                游戏
              </button>
            </div>
          </div>

          {selectedJob ? (
            <div className="editor-grid">
              <label>
                <span>任务名</span>
                <input value={selectedJob.name} onChange={(event) => updateSelected({ name: event.target.value })} />
              </label>
              <label>
                <span>脚本</span>
                <select value={selectedJob.script} onChange={(event) => updateSelected({ script: event.target.value })}>
                  {scripts.map((script) => <option key={script} value={script}>{scriptLabel(script)}</option>)}
                </select>
              </label>
              <label>
                <span>参数</span>
                <input value={argsToText(selectedJob.args)} onChange={(event) => updateSelected({ args: textToArgs(event.target.value) })} placeholder="--once --verbose" />
              </label>
              <label>
                <span>续玩编号</span>
                <div className="input-action">
                  <input value={selectedJob.recoveryId || ''} onChange={(event) => updateSelected({ recoveryId: event.target.value })} placeholder="填写 UUID" />
                  <button type="button" className="icon-btn" onClick={copyRecoveryId} title="复制续玩编号" disabled={!selectedJob.recoveryId}>
                    <Copy size={16} />
                  </button>
                </div>
              </label>
              <label className="wide">
                <span>环境变量</span>
                <textarea value={envToText(selectedJob.env)} onChange={(event) => updateSelected({ env: textToEnv(event.target.value) })} placeholder="XIUXIAN_EXPLORE_WAIT_MS=61000" />
              </label>
              <label className="wide">
                <span>备注</span>
                <textarea value={selectedJob.notes || ''} onChange={(event) => updateSelected({ notes: event.target.value })} />
              </label>
              <div className="editor-actions wide">
                <label className="toggle-line">
                  <input type="checkbox" checked={selectedJob.enabled !== false} onChange={(event) => updateSelected({ enabled: event.target.checked })} />
                  <span>启用</span>
                </label>
                <button type="button" className="ghost-btn" onClick={removeSelected}>
                  <Trash2 size={16} />
                  删除
                </button>
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => runAction(
                    () => api('/api/jobs', { method: 'PUT', body: JSON.stringify({ jobs: serializeJobs() }) }),
                    { preferredName: selectedJob.name, previousName: selectedJob.previousName },
                  )}
                >
                  <Save size={16} />
                  保存配置
                </button>
              </div>
            </div>
          ) : (
            <div className="empty-state">没有任务</div>
          )}
        </section>

        <section className="logs-pane">
          <div className="pane-head">
            <div>
              <span className="section-kicker">Signal</span>
              <h2>运行日志</h2>
            </div>
            <div className="log-actions">
              <button
                type="button"
                className="icon-btn"
                title="清空当前日志"
                disabled={!selectedJob || busy}
                onClick={() => runAction(
                  () => api(`/api/jobs/${encodeURIComponent(selectedJob.name)}/logs/clear`, { method: 'POST' }),
                  { preferredName: selectedJob.name },
                )}
              >
                <Trash2 size={16} />
              </button>
              <Terminal size={19} />
            </div>
          </div>
          <pre ref={logRef}>{logs || '暂无日志'}</pre>
        </section>
      </section>

      {gameView ? (
        <section className="webview-panel">
          <div className="pane-head">
            <div>
              <span className="section-kicker">WebView</span>
              <h2>{gameView.name}</h2>
            </div>
            <div className="control-strip">
              <button type="button" className="ghost-btn" onClick={() => window.open(gameView.url, '_blank', 'noopener,noreferrer')}>
                <ExternalLink size={16} />
                新窗口
              </button>
              <button type="button" className="icon-btn" onClick={() => setGameView(null)} title="关闭游戏窗口">
                <X size={18} />
              </button>
            </div>
          </div>
          <iframe title={`游戏窗口 ${gameView.name}`} src={gameView.url} />
        </section>
      ) : null}

      <section className="script-rail">
        {(scripts.length ? scripts : ['auto-priority.js', 'auto-danger.js', 'auto-fudi.js', 'auto-forage.js', 'auto-xiulian.js']).map((script) => (
          <div className="script-chip" key={script}>
            <ScriptIcon script={script} />
            <span>{scriptLabel(script)}</span>
          </div>
        ))}
        <div className="script-chip">
          <KeyRound size={16} />
          <span>自动续期</span>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
