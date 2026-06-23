import { describe, it, expect } from 'vitest';
import { latestToggleValue, lastTimeStr, dayKey, compareDesc } from './derive';
import type { Rec } from './types';

const at = (h: number, m: number, day = 23) => new Date(2026, 5, day, h, m).getTime();

describe('latestToggleValue', () => {
  it('記録なしは false（閉/切）', () => {
    expect(latestToggleValue([], 'living', 'window')).toBe(false);
  });
  it('最新の at の値を返す', () => {
    const recs: Rec[] = [
      { id: 'a', at: at(9, 0), kind: 'window', room: 'living', toggleValue: true },
      { id: 'b', at: at(13, 0), kind: 'window', room: 'living', toggleValue: false },
    ];
    expect(latestToggleValue(recs, 'living', 'window')).toBe(false);
  });
  it('部屋・種別が違う記録は無視', () => {
    const recs: Rec[] = [
      { id: 'a', at: at(13, 0), kind: 'window', room: 'study', toggleValue: true },
      { id: 'b', at: at(8, 0), kind: 'stove', room: 'living', toggleValue: true },
    ];
    expect(latestToggleValue(recs, 'living', 'window')).toBe(false);
  });
  it('同 at は id 降順で安定（タイブレーク）', () => {
    const recs: Rec[] = [
      { id: 'a', at: at(10, 0), kind: 'stove', room: 'living', toggleValue: false },
      { id: 'z', at: at(10, 0), kind: 'stove', room: 'living', toggleValue: true },
    ];
    expect(latestToggleValue(recs, 'living', 'stove')).toBe(true);
  });
});

describe('lastTimeStr', () => {
  it('当日の最新時刻を返す', () => {
    const recs: Rec[] = [
      { id: 'a', at: at(6, 40), kind: 'meal', room: 'living' },
      { id: 'b', at: at(14, 32), kind: 'meal', room: 'living' },
    ];
    expect(lastTimeStr(recs, 'living', 'meal', new Date(2026, 5, 23))).toBe('14:32');
  });
  it('別の日の記録は数えない', () => {
    const recs: Rec[] = [{ id: 'a', at: at(9, 0, 20), kind: 'meal', room: 'living' }];
    expect(lastTimeStr(recs, 'living', 'meal', new Date(2026, 5, 23))).toBe('—');
  });
});

describe('dayKey はローカルTZで算出', () => {
  it('深夜の記録は当日キー', () => {
    expect(dayKey(at(0, 30))).toBe('2026-6-23');
  });
});

describe('compareDesc', () => {
  it('at 降順', () => {
    const a: Rec = { id: 'a', at: at(9, 0), kind: 'memo', room: null };
    const b: Rec = { id: 'b', at: at(10, 0), kind: 'memo', room: null };
    expect([a, b].sort(compareDesc)[0]!.id).toBe('b');
  });
});
