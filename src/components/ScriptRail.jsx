import { KeyRound } from 'lucide-react';
import { ScriptIcon } from './ScriptIcon';
import { defaultScripts, scriptLabel } from '../lib/ops';

export function ScriptRail({ scripts }) {
  const items = scripts.length ? scripts : defaultScripts;
  return (
    <section className="mt-4 flex flex-wrap gap-2.5">
      {items.map((script) => (
        <div
          className="inline-flex items-center gap-2 rounded-lg border border-white/12 bg-white/[0.035] px-3 py-2.5 text-sm text-[#91aa9f]"
          key={script}
        >
          <ScriptIcon script={script} />
          <span>{scriptLabel(script)}</span>
        </div>
      ))}
      <div className="inline-flex items-center gap-2 rounded-lg border border-white/12 bg-white/[0.035] px-3 py-2.5 text-sm text-[#91aa9f]">
        <KeyRound size={16} />
        <span>自动续期</span>
      </div>
    </section>
  );
}
