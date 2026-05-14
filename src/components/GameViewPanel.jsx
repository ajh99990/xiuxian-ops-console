import { ExternalLink, X } from 'lucide-react';
import { Button } from './Button';
import { Kicker, Panel, PanelHeader } from './Panel';

export function GameViewPanel({ gameView, onClose }) {
  if (!gameView) return null;
  return (
    <Panel className="mt-4 bg-[#08100f]/95">
      <PanelHeader
        className="flex-row items-start"
        actions={(
          <div className="ml-auto flex gap-2">
            <Button onClick={() => window.open(gameView.url, '_blank', 'noopener,noreferrer')}>
              <ExternalLink size={16} />
              新窗口
            </Button>
            <Button iconOnly onClick={onClose} title="关闭游戏窗口">
              <X size={18} />
            </Button>
          </div>
        )}
      >
        <div>
          <Kicker>WebView</Kicker>
          <h2 className="text-lg font-bold">{gameView.name}</h2>
        </div>
      </PanelHeader>
      <iframe
        title={`游戏窗口 ${gameView.name}`}
        src={gameView.url}
        className="block h-[min(820px,calc(100vh-150px))] min-h-[640px] w-full border-0 bg-[#08100f]"
      />
    </Panel>
  );
}
