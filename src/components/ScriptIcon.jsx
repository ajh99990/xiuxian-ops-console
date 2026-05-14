import { Activity, FileText, Flame, Leaf, Shield } from 'lucide-react';

export function ScriptIcon({ script, size = 16 }) {
  const icons = {
    'auto-priority.js': Shield,
    'auto-danger.js': Flame,
    'auto-fudi.js': Activity,
    'auto-forage.js': Leaf,
    'auto-xiulian.js': FileText,
  };
  const Icon = icons[script] || FileText;
  return <Icon size={size} />;
}
