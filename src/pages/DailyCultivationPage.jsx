import { CalendarClock, Sparkles } from 'lucide-react';
import { Button } from '../components/Button';
import { Kicker, Panel, PanelHeader } from '../components/Panel';
import { cx } from '../lib/cx';
import { dailyStatusText, formatDayKey } from '../lib/ops';

export function DailyCultivationPage({
  busy,
  dailyCultivation,
  onRunDaily,
  roles = [],
}) {
  const records = mergeDailyRecordsWithRoles(dailyCultivation.records || [], roles);
  const completedCount = records.filter((record) => record.status === 'success').length;
  const maxBonus = records.reduce((value, record) => Math.max(value, Number(record.cultivationBonusPercent || 0)), 0);

  return (
    <section className="mt-6 grid gap-4">
      <Panel className="bg-gradient-to-r from-[#f4bd5d]/10 via-[#0d1616]/92 to-[#0d1616]/92">
        <PanelHeader
          className="md:flex-row md:items-start"
          actions={(
            <div className="flex w-full flex-wrap items-center gap-2.5 md:w-auto">
              <span className="mr-auto text-sm text-[#91aa9f] md:mr-0">今日 {formatDayKey(dailyCultivation.dayKey)}</span>
              <Button variant="primary" disabled={busy} onClick={onRunDaily}>
                <Sparkles size={16} />
                立即执行
              </Button>
            </div>
          )}
        >
          <div>
            <Kicker>Daily</Kicker>
            <h2 className="flex items-center gap-2 text-2xl font-bold">
              <CalendarClock className="text-[#f4bd5d]" size={22} />
              每日修炼
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#91aa9f]">
              每个角色每天只补一次普通修炼，用来稳定叠加修炼加成。这里负责手动触发和观察各角色的加成状态。
            </p>
          </div>
        </PanelHeader>

        <div className="grid gap-3 p-4 sm:grid-cols-3">
          <Metric label="已完成" value={`${completedCount}/${records.length}`} />
          <Metric label="最高加成" value={`+${maxBonus}%`} />
          <Metric label="上次运行" value={dailyCultivation.lastRunAt ? new Date(dailyCultivation.lastRunAt).toLocaleString() : '-'} />
        </div>
      </Panel>

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(210px,1fr))]">
        {records.length ? records.map((record) => (
          <DailyAccountCard key={record.key || record.name} record={record} />
        )) : (
          <Panel className="p-5 text-sm text-[#91aa9f]">暂无角色</Panel>
        )}
      </div>
    </section>
  );
}

function mergeDailyRecordsWithRoles(records, roles) {
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
      });
      continue;
    }

    merged.push({
      key: role._uiId || name,
      name,
      script: role.script,
      enabled: role.enabled !== false,
      status: role.recoveryId ? 'never' : 'missing_recovery',
      cultivationBonusPercent: 0,
      cultivationStreak: 0,
      cultivationRate: null,
      lastCultivationDay: '',
      error: role.recoveryId ? '' : '需要先填写续玩编号，才可以参与每日修炼。',
    });
  }

  return [...merged, ...remaining.values()];
}

function Metric({ label, value }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.035] p-3">
      <span className="text-xs text-[#91aa9f]">{label}</span>
      <strong className="mt-1 block overflow-hidden text-ellipsis whitespace-nowrap text-xl text-[#e9f4ed]">{value}</strong>
    </div>
  );
}

function DailyAccountCard({ record }) {
  const bonus = Number(record.cultivationBonusPercent || 0);
  const streak = Number(record.cultivationStreak || 0);
  return (
    <article className={cx(
      'grid min-h-[150px] gap-2.5 rounded-lg border bg-white/[0.035] p-3',
      record.status === 'success' && 'border-[#43d7a0]/40',
      record.status === 'failed' && 'border-[#ee604b]/45',
      record.status === 'running' && 'border-[#f4bd5d]/55',
      !['success', 'failed', 'running'].includes(record.status) && 'border-white/12',
    )}
    >
      <div className="flex items-center justify-between gap-2">
        <strong className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm">{record.name || record.playerName || '未知角色'}</strong>
        <span className="shrink-0 text-xs text-[#91aa9f]">{dailyStatusText(record.status)}</span>
      </div>
      <div className="flex items-center gap-2">
        <Sparkles className="text-[#f4bd5d]" size={16} />
        <span className="text-xl font-extrabold text-[#f4bd5d]">经验 +{bonus}%</span>
        <small className="text-[#91aa9f]">{streak} 天</small>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <span
          className="block h-full rounded-full bg-gradient-to-r from-[#43d7a0] to-[#f4bd5d]"
          style={{ width: `${Math.min(100, bonus * 2)}%` }}
        />
      </div>
      <div className="flex justify-between gap-2 text-xs text-[#91aa9f]">
        <span>修炼日 {formatDayKey(record.lastCultivationDay)}</span>
        <span>倍率 {record.cultivationRate ?? '-'}</span>
      </div>
      {record.error ? <p className="m-0 text-xs leading-5 text-[#ffd3c9]">{record.error}</p> : null}
    </article>
  );
}
