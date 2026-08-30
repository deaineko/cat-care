import { describe, it, expect } from 'vitest';
import { dayRows, dayLabel, doseLabel, isFinished, progressCells, remaining, totalDays } from './calc';
import type { Dose, Regimen } from './types';

/** 1日2回 × 5日 = 全10回 の抗生剤。 */
const reg: Regimen = {
  id: 'r1',
  catId: 'c1',
  drug: '抗生剤',
  dosesPerDay: 2,
  totalDoses: 10,
  startedAt: new Date(2026, 7, 28).getTime(),
  status: 'active',
};

const at = (day: number, h: number, m = 0) => new Date(2026, 7, day, h, m).getTime();
const dose = (id: string, ts: number): Dose => ({ id, regimenId: 'r1', at: ts });
const day30 = new Date(2026, 7, 30);

describe('totalDays', () => {
  it('総回数 ÷ 1日の回数', () => {
    expect(totalDays(reg)).toBe(5);
  });
  it('端数は切り上げ（最終日が1回だけでも1日と数える）', () => {
    expect(totalDays({ ...reg, totalDoses: 9 })).toBe(5);
  });
});

describe('dayRows：今日の行', () => {
  it('未消化なら1日の回数分の行が出る', () => {
    const rows = dayRows(reg, [], day30, true);
    expect(rows.map((r) => r.doseIndex)).toEqual([1, 2]);
    expect(rows.every((r) => r.dose === undefined)).toBe(true);
  });

  it('1回済ませると、済み行が時刻つきで残り2回目が未消化で続く', () => {
    const rows = dayRows(reg, [dose('d1', at(30, 7, 20))], day30, true);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.dose?.at).toBe(at(30, 7, 20));
    expect(rows[1]!.dose).toBeUndefined();
    expect(doseLabel(rows[0]!, reg)).toBe('1回目/全2回');
    expect(doseLabel(rows[1]!, reg)).toBe('2回目/全2回');
  });
});

describe('dayRows：欠測（実施基準）', () => {
  it('前日に1回しか飲めていないと、翌日もまだ1日目のまま', () => {
    const rows = dayRows(reg, [dose('d1', at(29, 8))], day30, true);
    expect(dayLabel(rows[0]!, reg)).toBe('1日目/全5日');
  });

  it('前日までに2回消化していれば2日目に進む', () => {
    const doses = [dose('d1', at(29, 8)), dose('d2', at(29, 20))];
    const rows = dayRows(reg, doses, day30, true);
    expect(dayLabel(rows[0]!, reg)).toBe('2日目/全5日');
  });

  it('日をまたいでも暦日ではなく消化回数で進む', () => {
    // 8/28 に2回だけ飲み、8/29 は完全に飛ばした
    const doses = [dose('d1', at(28, 8)), dose('d2', at(28, 20))];
    const rows = dayRows(reg, doses, day30, true);
    expect(dayLabel(rows[0]!, reg)).toBe('2日目/全5日');
  });
});

describe('dayRows：端数（総回数で頭打ち）', () => {
  it('残り1回なら1日2回の薬でも未消化の枠は1つだけ', () => {
    const doses = Array.from({ length: 9 }, (_, i) => dose(`d${i}`, at(28, 8) + i * 3600_000));
    const rows = dayRows(reg, doses, day30, true);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.doseIndex).toBe(1);
  });

  it('飲み切っていれば未消化の枠は出ない', () => {
    const doses = Array.from({ length: 10 }, (_, i) => dose(`d${i}`, at(28, 8) + i * 3600_000));
    expect(dayRows(reg, doses, day30, true)).toHaveLength(0);
  });
});

describe('dayRows：過去日は済みのみ', () => {
  it('showOpen が false なら未消化の枠を足さない', () => {
    const rows = dayRows(reg, [dose('d1', at(29, 8))], new Date(2026, 7, 29), false);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.dose).toBeDefined();
  });

  it('その日に記録がなければ空', () => {
    expect(dayRows(reg, [dose('d1', at(29, 8))], day30, false)).toHaveLength(0);
  });
});

describe('remaining / isFinished', () => {
  it('残りは総回数から消化数を引いた数', () => {
    expect(remaining(reg, [dose('d1', at(28, 8))])).toBe(9);
  });
  it('飲み切ったら完了', () => {
    const doses = Array.from({ length: 10 }, (_, i) => dose(`d${i}`, at(28, 8) + i * 3600_000));
    expect(isFinished(reg, doses)).toBe(true);
  });
  it('中止した処方は残りがあっても完了扱い', () => {
    expect(isFinished({ ...reg, status: 'stopped' }, [])).toBe(true);
  });
});

describe('progressCells', () => {
  it('総回数ぶんのマスを作り、消化済みだけ done になる', () => {
    const cells = progressCells(reg, [dose('d1', at(28, 8)), dose('d2', at(28, 20))]);
    expect(cells).toHaveLength(10);
    expect(cells.filter((c) => c.done)).toHaveLength(2);
    expect(cells[0]!.at).toBe(at(28, 8));
  });
});
