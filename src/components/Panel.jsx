import { cx } from '../lib/cx';

export function Panel({ children, className }) {
  return (
    <section className={cx('overflow-hidden rounded-lg border border-white/12 bg-[#0d1616]/90 shadow-[0_24px_70px_rgba(0,0,0,0.42)]', className)}>
      {children}
    </section>
  );
}

export function PanelHeader({ actions, children, className }) {
  return (
    <div className={cx('flex min-h-[74px] flex-col items-start justify-between gap-3 border-b border-white/12 bg-gradient-to-r from-[#43d7a0]/10 to-transparent p-4', className)}>
      {children}
      {actions ? <div className="flex w-full flex-wrap items-center gap-2.5">{actions}</div> : null}
    </div>
  );
}

export function Kicker({ children }) {
  return <span className="mb-1.5 block text-xs uppercase tracking-normal text-[#f4bd5d]">{children}</span>;
}
