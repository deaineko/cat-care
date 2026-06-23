import { KINDS, ROOMS } from './config';
import { SCHEMA_VERSION, type Rec, type BackupEnvelope } from './types';

const KIND_SET = new Set<string>(KINDS);
const ROOM_SET = new Set<string>(ROOMS);

/** 封筒形式 { schemaVersion, exportedAt, records } で JSON をダウンロード。 */
export function exportBackup(records: Rec[]): void {
  const env: BackupEnvelope = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: Date.now(),
    records,
  };
  const blob = new Blob([JSON.stringify(env, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  a.href = url;
  a.download = `cat-care-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export type ValidateResult = { ok: true; records: Rec[] } | { ok: false; error: string };

function validRecord(r: Record<string, unknown>): boolean {
  if (typeof r.id !== 'string' || typeof r.at !== 'number') return false;
  if (typeof r.kind !== 'string' || !KIND_SET.has(r.kind)) return false;
  if (r.kind === 'window' || r.kind === 'stove') {
    return typeof r.toggleValue === 'boolean' && typeof r.room === 'string' && ROOM_SET.has(r.room);
  }
  if (r.kind === 'med' || r.kind === 'memo') return r.room === null;
  // meal / litter
  return typeof r.room === 'string' && ROOM_SET.has(r.room);
}

/** 読み込んだテキストを検証。NG なら現データは触らせない（呼び出し側で中断）。 */
export function validateBackup(text: string): ValidateResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'JSON として読めませんでした' };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, error: '形式が不正です' };
  }
  const env = parsed as Record<string, unknown>;
  if (typeof env.schemaVersion !== 'number') {
    return { ok: false, error: 'schemaVersion がありません' };
  }
  if (env.schemaVersion > SCHEMA_VERSION) {
    return { ok: false, error: `新しい形式 (v${env.schemaVersion}) です。アプリを更新してください` };
  }
  if (!Array.isArray(env.records)) {
    return { ok: false, error: 'records がありません' };
  }
  for (const item of env.records) {
    if (typeof item !== 'object' || item === null || !validRecord(item as Record<string, unknown>)) {
      return { ok: false, error: '壊れた記録が含まれています' };
    }
  }
  return { ok: true, records: env.records as Rec[] };
}
