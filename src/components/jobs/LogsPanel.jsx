import { Terminal, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { Button } from '../Button';
import { Kicker, Panel, PanelHeader } from '../Panel';

export function LogsPanel({ busy, logRef, logView, onRunAction, selectedJob }) {
  return (
    <Panel>
      <PanelHeader
        actions={(
          <>
            <Button
              className="flex-1"
              disabled={!selectedJob || busy}
              onClick={() => onRunAction(
                () => api(`/api/jobs/${encodeURIComponent(selectedJob.name)}/logs/clear`, { method: 'POST' }),
                { preferredName: selectedJob.name },
              )}
            >
              <Trash2 size={16} />
              清空日志
            </Button>
            <Terminal className="text-[#43d7a0]" size={19} />
          </>
        )}
      >
        <div>
          <Kicker>Signal</Kicker>
          <h2 className="text-lg font-bold">运行日志</h2>
        </div>
      </PanelHeader>
      <pre
        ref={logRef}
        key={logView.name}
        className="log-scanlines h-[556px] overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-[1.65] text-[#b9f8da]"
      >
        {logView.loading ? '加载日志中...' : (logView.text || '暂无日志')}
      </pre>
    </Panel>
  );
}
