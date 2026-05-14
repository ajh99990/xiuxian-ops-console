import { ListPlus } from 'lucide-react';
import { Button } from '../Button';
import { Kicker, Panel, PanelHeader } from '../Panel';
import { cx } from '../../lib/cx';
import { scriptLabel, scriptSigil, statusText } from '../../lib/ops';

export function JobList({
  enabledCount,
  jobs,
  onAdd,
  onSelect,
  runningCount,
  selectedJob,
}) {
  return (
    <Panel>
      <PanelHeader
        actions={(
          <Button className="w-full" onClick={onAdd}>
            <ListPlus size={16} />
            新增角色
          </Button>
        )}
      >
        <div>
          <Kicker>Roles</Kicker>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-bold">角色列表</h2>
            <div className="flex flex-wrap items-center gap-1.5 text-xs" aria-label="角色统计">
              <Summary label="运行" value={runningCount} />
              <Summary label="启用" value={enabledCount} />
              <Summary label="角色" value={jobs.length} />
            </div>
          </div>
        </div>
      </PanelHeader>

      <div className="grid gap-2 p-3">
        {jobs.map((job) => {
          const selected = job._uiId === selectedJob?._uiId;
          const running = Boolean(job.runtime?.running);

          return (
            <button
              type="button"
              key={job._uiId}
              className={cx(
                'grid min-h-[68px] w-full grid-cols-[44px_1fr_12px] items-center gap-2.5 rounded-lg border text-left text-[#e9f4ed] transition hover:border-[#f4bd5d]/35',
                selected ? 'border-[#43d7a0]/60 bg-[#43d7a0]/10' : 'border-transparent bg-white/[0.035]',
              )}
              onClick={() => onSelect(job)}
            >
            <span className="ml-2 grid h-[34px] w-[34px] place-items-center rounded-lg border border-white/12 font-serif-cn font-extrabold text-[#f4bd5d]">
              {scriptSigil(job.script)}
            </span>
            <span className="min-w-0">
              <strong className="block overflow-hidden text-ellipsis whitespace-nowrap text-sm">{job.name}</strong>
              <small className="mt-1 block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-[#91aa9f]">
                {scriptLabel(job.script)} · {statusText(job)}
              </small>
            </span>
            <span className={cx(
              'h-2 w-2 rounded-full',
              running ? 'bg-[#43d7a0] shadow-[0_0_16px_rgba(67,215,160,0.9)]' : 'bg-[#55645f]',
            )}
            />
          </button>
          );
        })}
      </div>
    </Panel>
  );
}

function Summary({ label, value }) {
  return (
    <span className="inline-flex min-h-6 items-baseline gap-1 rounded-md border border-white/10 bg-white/[0.035] px-2 py-0.5 text-[#91aa9f]">
      {label}
      <strong className="font-[inherit] text-[#f4bd5d]">{value}</strong>
    </span>
  );
}
