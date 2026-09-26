import { dayKey, midnight } from '../derive';
import type { Dose, DrugTemplate, Regimen } from './types';

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

/** 日数ぶん延長した新しい処方を返す。総回数を増やすだけなので、完了済みでも自動で進行中に戻る。 */
export function extendRegimen(reg: Regimen, days: number, at: number): Regimen {
  return {
    ...reg,
    totalDoses: reg.totalDoses + days * reg.dosesPerDay,
    extensions: [...(reg.extensions ?? []), { at, days }],
  };
}

/** 延長ぶんを差し引いた、登録時の日数。 */
export function originalDays(reg: Regimen): number {
  const extended = (reg.extensions ?? []).reduce((sum, e) => sum + e.days, 0);
  return totalDays(reg) - extended;
}

/**
 * 1日の回数・日数を登録しなおした処方を返す（登録ミスの訂正用）。
 * days は「登録時の日数」なので、延長ぶんは足し直して総回数を保つ。
 */
export function reviseRegimen(reg: Regimen, dosesPerDay: number, days: number): Regimen {
  const extended = (reg.extensions ?? []).reduce((sum, e) => sum + e.days, 0);
  return { ...reg, dosesPerDay, totalDoses: dosesPerDay * (days + extended) };
}

/** 薬の一覧を「その薬名で最後に処方を登録した順」に並べる。未使用の薬は後ろに50音順。 */
export function sortDrugsByRecent(drugs: DrugTemplate[], regimens: Regimen[]): DrugTemplate[] {
  const last = new Map<string, number>();
  for (const r of regimens) last.set(r.drug, Math.max(last.get(r.drug) ?? 0, r.startedAt));
  return drugs.slice().sort((a, b) => {
    const diff = (last.get(b.drug) ?? 0) - (last.get(a.drug) ?? 0);
    return diff !== 0 ? diff : a.drug.localeCompare(b.drug, 'ja');
  });
}
