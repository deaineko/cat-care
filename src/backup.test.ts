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
