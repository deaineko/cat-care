import { dayKey, midnight } from '../derive';
import type { Dose, Regimen } from './types';

/** 全N日 = 総回数 ÷ 1日の回数。端数は切り上げ（最終日が半端でも1日と数える）。 */
export function totalDays(reg: Regimen): number {
  return Math.max(1, Math.ceil(reg.totalDoses / reg.dosesPerDay));
}

export function remaining(reg: Regimen, doses: Dose[]): number {
  return Math.max(0, reg.totalDoses - doses.length);
}

export function isFinished(reg: Regimen, doses: Dose[]): boolean {
  return reg.status === 'stopped' || doses.length >= reg.totalDoses;
}

export interface DayRow {
  /** その日の何回目か（1始まり）。 */
  doseIndex: number;
  /** 治療全体の何日目か（1始まり）。 */
  dayIndex: number;
  /** 済みなら実績。未消化なら undefined。 */
  dose?: Dose;
}

/**
 * 指定日に表示する行を組み立てる。
 * 済んだ分は時刻つきで残し、未消化の枠は showOpen のときだけ足す
 * （実施基準では過去日に「未消化の枠」という概念がないため）。
 */
export function dayRows(
  reg: Regimen,
  doses: Dose[],
  ref: Date,
  showOpen: boolean,
): DayRow[] {
  const start = midnight(ref).getTime();
  const key = dayKey(ref.getTime());
  const before = doses.filter((d) => d.at < start).length;
  const onDay = doses.filter((d) => dayKey(d.at) === key).sort((a, b) => a.at - b.at);

  const dayIndex = Math.min(Math.floor(before / reg.dosesPerDay) + 1, totalDays(reg));
  const rows: DayRow[] = onDay.map((dose, i) => ({ doseIndex: i + 1, dayIndex, dose }));

  if (showOpen) {
    const left = Math.max(0, reg.totalDoses - before - onDay.length);
    const open = Math.min(reg.dosesPerDay - onDay.length, left);
    for (let j = 0; j < open; j++) {
      rows.push({ doseIndex: onDay.length + j + 1, dayIndex });
    }
  }
  return rows;
}

export function doseLabel(row: DayRow, reg: Regimen): string {
  return `${row.doseIndex}回目/全${reg.dosesPerDay}回`;
}

export function dayLabel(row: DayRow, reg: Regimen): string {
  return `${row.dayIndex}日目/全${totalDays(reg)}日`;
}

/** 経過グリッド用。消化した回を古い順に並べる。 */
export function progressCells(reg: Regimen, doses: Dose[]): { done: boolean; at?: number }[] {
  const sorted = doses.slice().sort((a, b) => a.at - b.at);
  const cells: { done: boolean; at?: number }[] = [];
  for (let i = 0; i < reg.totalDoses; i++) {
    const d = sorted[i];
    cells.push(d ? { done: true, at: d.at } : { done: false });
  }
  return cells;
}
