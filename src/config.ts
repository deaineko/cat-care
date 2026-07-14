export const ROOMS = ['living', 'study', 'upstairs'] as const;
export type Room = (typeof ROOMS)[number];
export const ROOM_LABEL: Record<Room, string> = {
  living: 'リビング',
  study: '書斎',
  upstairs: '2階',
};

export const KINDS = ['meal', 'litter', 'med', 'memo', 'window', 'stove', 'fan'] as const;
export type Kind = (typeof KINDS)[number];
export type ToggleKind = 'window' | 'stove' | 'fan';
export const TOGGLE_KINDS: ToggleKind[] = ['window', 'stove', 'fan'];

export const KIND_META: Record<Kind, { em: string; label: string; icon?: string }> = {
  meal: { em: '🍚', label: 'ごはん', icon: 'icon-meal' },
  litter: { em: '🚽', label: 'トイレ掃除', icon: 'icon-toilet' },
  med: { em: '💊', label: '薬' },
  memo: { em: '📝', label: '自由メモ' },
  window: { em: '🪟', label: '窓', icon: 'icon-window' },
  stove: { em: '🔥', label: 'ストーブ', icon: 'icon-stove' },
  fan: { em: '🌀', label: '扇風機', icon: 'icon-fan' },
};

export const WEEK = ['日', '月', '火', '水', '木', '金', '土'] as const;

export function genId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );
}
