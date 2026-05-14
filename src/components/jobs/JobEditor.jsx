import { Copy, ExternalLink, Play, Save, Square, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { argsToText, envToText, scriptLabel, textToArgs, textToEnv } from '../../lib/ops';
import { Button } from '../Button';
import { Kicker, Panel, PanelHeader } from '../Panel';

const inputClass = 'h-10 w-full rounded-lg border border-white/12 bg-black/25 px-3 text-sm text-[#e9f4ed] outline-none transition focus:border-[#43d7a0]/70';
const textareaClass = 'min-h-[84px] w-full resize-y rounded-lg border border-white/12 bg-black/25 p-3 text-sm text-[#e9f4ed] outline-none transition focus:border-[#43d7a0]/70';
const labelClass = 'grid gap-1.5 text-xs text-[#91aa9f]';

export function JobEditor({
  busy,
  copyRecoveryId,
  onOpenGame,
  onRemove,
  onRunAction,
  scripts,
  selectedJob,
  serializeJobs,
  updateSelected,
}) {
  return (
    <Panel>
      <PanelHeader
        actions={(
          <>
            <Button
              className="flex-1"
              disabled={!selectedJob || busy || selectedJob.runtime?.running}
              onClick={() => onRunAction(() => api(`/api/jobs/${encodeURIComponent(selectedJob.name)}/start`, { method: 'POST' }))}
            >
              <Play size={16} />
              启动
            </Button>
            <Button
              className="flex-1"
              variant="danger"
              disabled={!selectedJob || busy || !selectedJob.runtime?.running}
              onClick={() => onRunAction(() => api(`/api/jobs/${encodeURIComponent(selectedJob.name)}/stop`, { method: 'POST' }))}
            >
              <Square size={16} />
              停止
            </Button>
            <Button className="flex-1" disabled={!selectedJob || !selectedJob.recoveryId} onClick={onOpenGame}>
              <ExternalLink size={16} />
              游戏
            </Button>
          </>
        )}
      >
        <div>
          <Kicker>Control</Kicker>
          <h2 className="text-lg font-bold">{selectedJob ? selectedJob.name : '未选择角色'}</h2>
        </div>
      </PanelHeader>

      {selectedJob ? (
        <div className="grid gap-3.5 p-4">
          <label className={labelClass}>
            <span>角色名</span>
            <input className={inputClass} value={selectedJob.name} onChange={(event) => updateSelected({ name: event.target.value })} />
          </label>
          <label className={labelClass}>
            <span>脚本策略</span>
            <select className={inputClass} value={selectedJob.script} onChange={(event) => updateSelected({ script: event.target.value })}>
              {scripts.map((script) => <option key={script} value={script}>{scriptLabel(script)}</option>)}
            </select>
          </label>
          <label className={labelClass}>
            <span>参数</span>
            <input className={inputClass} value={argsToText(selectedJob.args)} onChange={(event) => updateSelected({ args: textToArgs(event.target.value) })} placeholder="--once --verbose" />
          </label>
          <label className={labelClass}>
            <span>续玩编号</span>
            <div className="grid grid-cols-[minmax(0,1fr)_40px] gap-2">
              <input className={inputClass} value={selectedJob.recoveryId || ''} onChange={(event) => updateSelected({ recoveryId: event.target.value })} placeholder="填写 UUID" />
              <Button iconOnly onClick={copyRecoveryId} title="复制续玩编号" disabled={!selectedJob.recoveryId}>
                <Copy size={16} />
              </Button>
            </div>
          </label>
          <label className={labelClass}>
            <span>环境变量</span>
            <textarea className={textareaClass} value={envToText(selectedJob.env)} onChange={(event) => updateSelected({ env: textToEnv(event.target.value) })} placeholder="XIUXIAN_EXPLORE_WAIT_MS=61000" />
          </label>
          <label className={labelClass}>
            <span>备注</span>
            <textarea className={textareaClass} value={selectedJob.notes || ''} onChange={(event) => updateSelected({ notes: event.target.value })} />
          </label>
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="mr-auto inline-flex items-center gap-2 text-xs text-[#91aa9f]">
              <input className="h-4 w-4 accent-[#43d7a0]" type="checkbox" checked={selectedJob.enabled !== false} onChange={(event) => updateSelected({ enabled: event.target.checked })} />
              <span>启用</span>
            </label>
            <Button onClick={onRemove}>
              <Trash2 size={16} />
              删除
            </Button>
            <Button
              variant="primary"
              onClick={() => onRunAction(
                () => api('/api/jobs', { method: 'PUT', body: JSON.stringify({ jobs: serializeJobs() }) }),
                { preferredName: selectedJob.name, previousName: selectedJob.previousName },
              )}
            >
              <Save size={16} />
              保存配置
            </Button>
          </div>
        </div>
      ) : (
        <div className="m-4 rounded-lg border border-dashed border-white/12 p-8 text-sm text-[#91aa9f]">没有角色</div>
      )}
    </Panel>
  );
}
