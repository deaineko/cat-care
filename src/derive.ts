import type { Room, ToggleKind } from './config';
import { ROOMS, TOGGLE_KINDS } from './config';
import type { Rec } from './types';

export function midnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** ローカルタイムゾーンの日付キー（UTCで切らない）。 */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
export function sameDay(ts: number, ref: Date): boolean {
  return dayKey(ts) === dayKey(ref.getTime());
}

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** at 降順、同 at は id 降順で安定化（タイブレーク）。 */
export function compareDesc(a: Rec, b: Rec): number {
  if (b.at !== a.at) return b.at - a.at;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** records から (room, kind) の「今の値」を導出。記録なしは false（閉/切）。 */
export function latestToggleValue(records: Rec[], room: Room, kind: ToggleKind): boolean {
  let best: Rec | null = null;
  for (const r of records) {
    if (r.kind !== kind || r.room !== room) continue;
    if (!best || compareDesc(r, best) < 0) best = r;
  }
  return best && best.kind === kind ? best.toggleValue : false;
}

/** 全トグルの現在値マップ（`${room}:${kind}` キー）。toggleStates 破損時の再構築に使う。 */
export function buildToggleMap(records: Rec[]): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const room of ROOMS) {
    for (const kind of TOGGLE_KINDS) {
      map[`${room}:${kind}`] = latestToggleValue(records, room, kind);
    }
  }
  return map;
}

/** 指定日の (room, kind) の最終時刻文字列。なければ '—'。 */
export function lastTimeStr(
  records: Rec[],
  room: Room,
  kind: 'meal' | 'litter',
  ref: Date,
): string {
  let best: Rec | null = null;
  for (const r of records) {
    if (r.kind !== kind || r.room !== room || !sameDay(r.at, ref)) continue;
    if (!best || compareDesc(r, best) < 0) best = r;
  }
  return best ? fmtTime(best.at) : '—';
}

export function recsForDay(records: Rec[], ref: Date): Rec[] {
  return records.filter((r) => sameDay(r.at, ref)).sort(compareDesc);
}
