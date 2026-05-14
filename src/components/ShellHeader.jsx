import { motion } from 'framer-motion';
import { CircleStop, Power, RefreshCw } from 'lucide-react';
import { Button } from './Button';
import { cx } from '../lib/cx';

const tabs = [
  { id: 'roles', label: '角色一览' },
  { id: 'dashboard', label: '角色控制' },
  { id: 'daily', label: '每日修炼' },
];

export function ShellHeader({ busy, onNavigate, onRefresh, onStartAll, onStopAll, page }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-6">
      <div>
        <motion.p
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-1.5 text-xs uppercase tracking-normal text-[#f4bd5d]"
        >
          Xiuxian Operations
        </motion.p>
        <div className="flex flex-wrap items-center gap-3.5">
          <motion.h1
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="font-serif-cn text-[38px] font-bold leading-tight"
          >
            修仙脚本控制台
          </motion.h1>
          <span className="inline-flex h-10 items-center rounded-lg border border-[#f4bd5d]/50 bg-gradient-to-br from-[#f4bd5d] to-[#43d7a0] px-3.5 font-condensed text-2xl font-black text-[#07100f] shadow-[0_0_26px_rgba(244,189,93,0.18)]">
            v0.7.1
          </span>
        </div>
        <nav className="mt-4 flex flex-wrap gap-2" aria-label="页面导航">
          {tabs.map((tab) => (
            <button
              type="button"
              key={tab.id}
              onClick={() => onNavigate(tab.id)}
              className={cx(
                'h-9 rounded-lg border px-4 text-sm transition',
                page === tab.id
                  ? 'border-[#43d7a0]/65 bg-[#43d7a0]/12 text-[#e9f4ed]'
                  : 'border-white/10 bg-white/[0.035] text-[#91aa9f] hover:border-[#f4bd5d]/50 hover:text-[#e9f4ed]',
              )}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <Button onClick={onRefresh} disabled={busy}>
          <RefreshCw size={16} />
          刷新
        </Button>
        <Button variant="danger" onClick={onStopAll} disabled={busy}>
          <CircleStop size={16} />
          全部停止
        </Button>
        <Button variant="primary" onClick={onStartAll} disabled={busy}>
          <Power size={16} />
          启动启用角色
        </Button>
      </div>
    </header>
  );
}
