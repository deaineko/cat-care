import { KINDS, ROOMS } from './config';
import { SCHEMA_VERSION, type Rec, type BackupEnvelope } from './types';
import type { MedBackup } from './med/types';

const KIND_SET = new Set<string>(KINDS);
const ROOM_SET = new Set<string>(ROOMS);

/**
 * 封筒形式 { schemaVersion, exportedAt, records, med } で JSON をダウンロード。
 * お世話と投薬を1ファイルにまとめ、片方だけ書き出す事故を防ぐ。
 */
export function exportBackup(records: Rec[], med?: MedBackup): void {
  const env: BackupEnvelope = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: Date.now(),
    records,
    ...(med ? { med } : {}),
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

export type ValidateResult =
  | { ok: true; records: Rec[]; med?: MedBackup }
  | { ok: false; error: string };

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
  const med = parseMed(env.med);
  if (med === 'invalid') return { ok: false, error: '投薬データが壊れています' };
  return { ok: true, records: env.records as Rec[], ...(med ? { med } : {}) };
}

function str(v: unknown): boolean {
  return typeof v === 'string' && v.length > 0;
}

/** med セクションの検証。未収録（v1 ファイル）は undefined を返して受理する。 */
function parseMed(raw: unknown): MedBackup | undefined | 'invalid' {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object') return 'invalid';
  const m = raw as Record<string, unknown>;
  if (!Array.isArray(m.cats) || !Array.isArray(m.regimens) || !Array.isArray(m.doses)) {
    return 'invalid';
  }
  for (const c of m.cats) {
    const o = c as Record<string, unknown>;
    if (!str(o?.id) || !str(o?.name) || typeof o?.room !== 'string' || !ROOM_SET.has(o.room)) {
      return 'invalid';
    }
  }
  for (const r of m.regimens) {
    const o = r as Record<string, unknown>;
    if (!str(o?.id) || !str(o?.catId) || !str(o?.drug)) return 'invalid';
    if (typeof o.dosesPerDay !== 'number' || o.dosesPerDay < 1) return 'invalid';
    if (typeof o.totalDoses !== 'number' || o.totalDoses < 1) return 'invalid';
    if (typeof o.startedAt !== 'number') return 'invalid';
    if (o.status !== 'active' && o.status !== 'stopped') return 'invalid';
  }
  for (const d of m.doses) {
    const o = d as Record<string, unknown>;
    if (!str(o?.id) || !str(o?.regimenId) || typeof o?.at !== 'number') return 'invalid';
  }
  return m as unknown as MedBackup;
}
