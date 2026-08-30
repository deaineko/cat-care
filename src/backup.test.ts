import { describe, it, expect } from 'vitest';
import { validateBackup } from './backup';
import { SCHEMA_VERSION, type Rec } from './types';

const env = (records: Rec[], schemaVersion = SCHEMA_VERSION) =>
  JSON.stringify({ schemaVersion, exportedAt: Date.now(), records });

describe('validateBackup', () => {
  it('正しい封筒は通る', () => {
    const recs: Rec[] = [
      { id: 'a', at: 1, kind: 'meal', room: 'living' },
      { id: 'b', at: 2, kind: 'memo', room: null, note: 'x', alert: true },
      { id: 'c', at: 3, kind: 'window', room: 'study', toggleValue: true },
    ];
    const res = validateBackup(env(recs));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.records.length).toBe(3);
  });

  it('JSON でなければ拒否', () => {
    const res = validateBackup('not json');
    expect(res).toEqual({ ok: false, error: 'JSON として読めませんでした' });
  });

  it('新しい schemaVersion は拒否', () => {
    const res = validateBackup(env([], SCHEMA_VERSION + 1));
    expect(res.ok).toBe(false);
  });

  it('records が無ければ拒否', () => {
    const res = validateBackup(JSON.stringify({ schemaVersion: SCHEMA_VERSION }));
    expect(res.ok).toBe(false);
  });

  it('壊れた記録（window に toggleValue なし）は拒否', () => {
    const bad = JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      exportedAt: 0,
      records: [{ id: 'a', at: 1, kind: 'window', room: 'living' }],
    });
    expect(validateBackup(bad).ok).toBe(false);
  });

  it('未知の room は拒否', () => {
    const bad = JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      exportedAt: 0,
      records: [{ id: 'a', at: 1, kind: 'meal', room: 'kitchen' }],
    });
    expect(validateBackup(bad).ok).toBe(false);
  });
});

const medSample = {
  cats: [{ id: 'c1', name: 'ミケ', room: 'living' }],
  regimens: [
    {
      id: 'r1',
      catId: 'c1',
      drug: 'アモキシシリン',
      dosesPerDay: 2,
      totalDoses: 10,
      startedAt: 1,
      status: 'active',
    },
  ],
  doses: [{ id: 'd1', regimenId: 'r1', at: 2 }],
};

const envMed = (med: unknown) =>
  JSON.stringify({ schemaVersion: SCHEMA_VERSION, exportedAt: 0, records: [], med });

describe('validateBackup：投薬データ（med）', () => {
  it('med つきの封筒は通り、中身がそのまま返る', () => {
    const res = validateBackup(envMed(medSample));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.med?.cats).toHaveLength(1);
      expect(res.med?.regimens[0]!.drug).toBe('アモキシシリン');
      expect(res.med?.doses).toHaveLength(1);
    }
  });

  it('med の無い v1 ファイルもそのまま読める（後方互換）', () => {
    const v1 = JSON.stringify({ schemaVersion: 1, exportedAt: 0, records: [] });
    const res = validateBackup(v1);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.med).toBeUndefined();
  });

  it('med の3配列が揃っていなければ拒否', () => {
    expect(validateBackup(envMed({ cats: [], regimens: [] })).ok).toBe(false);
  });

  it('未知の部屋の猫は拒否', () => {
    const bad = { ...medSample, cats: [{ id: 'c1', name: 'ミケ', room: 'kitchen' }] };
    expect(validateBackup(envMed(bad)).ok).toBe(false);
  });

  it('回数が数値でない処方は拒否', () => {
    const bad = {
      ...medSample,
      regimens: [{ ...medSample.regimens[0], dosesPerDay: '2' }],
    };
    expect(validateBackup(envMed(bad)).ok).toBe(false);
  });

  it('未知の status は拒否', () => {
    const bad = {
      ...medSample,
      regimens: [{ ...medSample.regimens[0], status: 'paused' }],
    };
    expect(validateBackup(envMed(bad)).ok).toBe(false);
  });

  it('regimenId の無い投与記録は拒否', () => {
    const bad = { ...medSample, doses: [{ id: 'd1', at: 2 }] };
    expect(validateBackup(envMed(bad)).ok).toBe(false);
  });
});
