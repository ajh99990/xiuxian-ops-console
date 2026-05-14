import { useMemo, useState } from 'react';
import {
  Activity,
  Clock3,
  Gem,
  HeartPulse,
  Info,
  RefreshCw,
  Sparkles,
  Swords,
  X,
} from 'lucide-react';
import { Button } from '../components/Button';
import { Kicker, Panel, PanelHeader } from '../components/Panel';
import { cx } from '../lib/cx';
import { scriptLabel } from '../lib/ops';

export function RoleOverviewPage({
  busy,
  onRefresh,
  roles = [],
  roleStates,
}) {
  const [detailRecord, setDetailRecord] = useState(null);
  const records = useMemo(
    () => mergeRoleStatesWithRoles(roleStates.records || [], roles),
    [roleStates.records, roles],
  );
  const syncedCount = records.filter((record) => record.status === 'success').length;
  const runningCount = records.filter((record) => record.runtime?.running).length;

  return (
    <section className="mt-6 grid gap-4">
      <Panel className="bg-gradient-to-r from-[#43d7a0]/10 via-[#0d1616]/92 to-[#0d1616]/92">
        <PanelHeader
          className="md:flex-row md:items-start"
          actions={(
            <div className="flex w-full flex-wrap items-center gap-2.5 md:w-auto">
              <span className="mr-auto text-sm text-[#91aa9f] md:mr-0">
                最近同步 {formatDateTime(roleStates.lastRefreshAt || roleStates.updatedAt)}
              </span>
              <Button variant="primary" disabled={busy} onClick={onRefresh}>
                <RefreshCw size={16} />
                手动同步
              </Button>
            </div>
          )}
        >
          <div>
            <Kicker>Roles</Kicker>
            <h2 className="flex items-center gap-2 text-2xl font-bold">
              <Activity className="text-[#43d7a0]" size={22} />
              角色一览
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#91aa9f]">
              后台每 5 分钟同步一次角色状态。运行中的脚本也会在动作返回角色数据时顺手上报快照。
            </p>
          </div>
        </PanelHeader>

        <div className="grid gap-3 p-4 sm:grid-cols-3">
          <Metric label="角色" value={records.length} />
          <Metric label="已同步" value={`${syncedCount}/${records.length}`} />
          <Metric label="运行中" value={runningCount} />
        </div>
      </Panel>

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
        {records.length ? records.map((record) => (
          <RoleCard
            key={record.key || record.name}
            onDetail={() => setDetailRecord(record)}
            record={record}
          />
        )) : (
          <Panel className="p-5 text-sm text-[#91aa9f]">暂无角色</Panel>
        )}
      </div>

      {detailRecord ? (
        <RoleDetailModal record={detailRecord} onClose={() => setDetailRecord(null)} />
      ) : null}
    </section>
  );
}

function mergeRoleStatesWithRoles(records, roles) {
  const remaining = new Map(records.map((record) => [record.name, record]));
  const merged = [];

  for (const role of roles) {
    const name = role.name || role.previousName || '';
    if (!name) continue;
    const record = remaining.get(name) || remaining.get(role.previousName);
    if (record) {
      remaining.delete(record.name);
      merged.push({
        ...record,
        key: record.key || role._uiId || name,
        name,
        script: role.script || record.script,
        enabled: role.enabled !== false,
        runtime: role.runtime || record.runtime,
      });
      continue;
    }

    merged.push({
      key: role._uiId || name,
      name,
      script: role.script,
      enabled: role.enabled !== false,
      runtime: role.runtime || { running: false },
      hasRecoveryId: Boolean(role.recoveryId),
      status: role.recoveryId ? 'never' : 'missing_recovery',
      summary: {},
      error: role.recoveryId ? '' : '需要先填写续玩编号，才可以同步角色状态。',
    });
  }

  return [...merged, ...remaining.values()];
}

function RoleCard({ onDetail, record }) {
  const summary = record.summary || {};
  return (
    <article className={cx(
      'grid min-h-[250px] gap-3 rounded-lg border bg-white/[0.035] p-3',
      record.status === 'success' && 'border-[#43d7a0]/35',
      record.status === 'failed' && 'border-[#ee604b]/45',
      record.status === 'refreshing' && 'border-[#f4bd5d]/55',
      !['success', 'failed', 'refreshing'].includes(record.status) && 'border-white/12',
    )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <strong className="block overflow-hidden text-ellipsis whitespace-nowrap text-base">{record.name || '未知角色'}</strong>
          <span className="mt-1 block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-[#91aa9f]">
            {scriptLabel(record.script)} · {record.runtime?.running ? `运行中 pid ${record.runtime.pid}` : statusText(record.status)}
          </span>
        </div>
        <span className={cx(
          'mt-1 h-2.5 w-2.5 shrink-0 rounded-full',
          record.runtime?.running ? 'bg-[#43d7a0] shadow-[0_0_18px_rgba(67,215,160,0.9)]' : 'bg-[#55645f]',
        )}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Fact icon={Sparkles} label="境界" value={realmText(summary)} />
        <Fact icon={Gem} label="灵根" value={summary.spiritualRoot || '-'} />
        <Fact icon={Gem} label="灵石" value={formatNumber(summary.spiritStones)} />
        <Fact icon={Swords} label="战力" value={formatNumber(summary.combatPower)} />
        <Fact icon={HeartPulse} label="剩余寿元" value={lifespanText(summary)} />
        <Fact icon={Activity} label="修为" value={progressText(summary.exp, summary.expToNext)} />
      </div>

      <div className="flex items-center justify-between gap-2 text-xs text-[#91aa9f]">
        <span>同步 {formatDateTime(record.syncedAt || record.failureAt || record.updatedAt)}</span>
        <Button className="h-8 px-2.5 text-xs" onClick={onDetail}>
          <Info size={14} />
          详情
        </Button>
      </div>
      {record.error ? <p className="m-0 text-xs leading-5 text-[#ffd3c9]">{record.error}</p> : null}
    </article>
  );
}

function Fact({ icon: Icon, label, value }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/15 p-2.5">
      <span className="flex items-center gap-1.5 text-[11px] text-[#91aa9f]">
        <Icon size={13} />
        {label}
      </span>
      <strong className="mt-1 block overflow-hidden text-ellipsis whitespace-nowrap text-sm text-[#e9f4ed]">{value ?? '-'}</strong>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.035] p-3">
      <span className="text-xs text-[#91aa9f]">{label}</span>
      <strong className="mt-1 block text-xl text-[#e9f4ed]">{value}</strong>
    </div>
  );
}

function RoleDetailModal({ onClose, record }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-5">
      <div className="max-h-[86vh] w-[min(860px,calc(100vw-32px))] overflow-hidden rounded-lg border border-white/12 bg-[#0d1616] shadow-[0_24px_70px_rgba(0,0,0,0.6)]">
        <div className="flex items-start justify-between gap-4 border-b border-white/12 p-4">
          <div>
            <Kicker>Role Detail</Kicker>
            <h3 className="text-xl font-bold">{record.name || '未知角色'}</h3>
          </div>
          <Button iconOnly onClick={onClose} title="关闭详情">
            <X size={18} />
          </Button>
        </div>
        <div className="grid max-h-[70vh] gap-3 overflow-auto p-4 md:grid-cols-[260px_1fr]">
          <div className="grid content-start gap-2">
            <Fact icon={Sparkles} label="境界" value={realmText(record.summary || {})} />
            <Fact icon={Gem} label="灵根" value={record.summary?.spiritualRoot || '-'} />
            <Fact icon={Gem} label="灵石" value={formatNumber(record.summary?.spiritStones)} />
            <Fact icon={Swords} label="战力" value={formatNumber(record.summary?.combatPower)} />
            <Fact icon={HeartPulse} label="剩余寿元" value={lifespanText(record.summary || {})} />
            <Fact icon={Clock3} label="同步来源" value={record.source || '-'} />
          </div>
          <pre className="m-0 overflow-auto rounded-lg border border-white/10 bg-black/25 p-3 text-xs leading-5 text-[#b9f8da]">
            {JSON.stringify(record.raw || record, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}

function realmText(summary) {
  const realm = summary.realmLabel || summary.realmId || '-';
  return summary.realmStage !== null && summary.realmStage !== undefined ? `${realm} ${summary.realmStage}层` : realm;
}

function lifespanText(summary) {
  if (summary.lifespanRemaining === null || summary.lifespanRemaining === undefined) return '-';
  const remaining = `${formatNumber(summary.lifespanRemaining)} 年`;
  return summary.lifespanMax ? `剩 ${remaining} / 上限 ${formatNumber(summary.lifespanMax)} 年` : `剩 ${remaining}`;
}

function progressText(exp, expToNext) {
  if (exp === null || exp === undefined) return '-';
  return expToNext ? `${formatNumber(exp)}/${formatNumber(expToNext)}` : formatNumber(exp);
}

function statusText(status) {
  return {
    failed: '同步失败',
    missing_recovery: '缺续玩编号',
    never: '未同步',
    refreshing: '同步中',
    success: '已同步',
  }[status] || status || '未同步';
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  return number.toLocaleString('zh-CN');
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN', { hour12: false });
}
