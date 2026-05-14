import { cx } from '../lib/cx';

const variants = {
  danger: 'border-[#ee604b]/40 text-[#ffd3c9] hover:border-[#f4bd5d]/60 hover:bg-[#ee604b]/10',
  ghost: 'border-white/12 bg-white/[0.045] text-[#e9f4ed] hover:border-[#f4bd5d]/60 hover:bg-white/[0.08]',
  icon: 'h-10 w-10 border-white/12 bg-white/[0.045] p-0 text-[#e9f4ed] hover:border-[#f4bd5d]/60 hover:bg-white/[0.08]',
  primary: 'border-transparent bg-gradient-to-br from-[#43d7a0] to-[#f4bd5d] font-bold text-[#07100f] hover:shadow-[0_0_24px_rgba(244,189,93,0.22)]',
};

export function Button({
  children,
  className,
  iconOnly = false,
  variant = 'ghost',
  ...props
}) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex h-10 items-center justify-center gap-2 rounded-lg border px-3.5 text-sm transition duration-150 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0',
        variants[iconOnly ? 'icon' : variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
