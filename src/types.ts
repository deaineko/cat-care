import type { Room, ToggleKind } from './config';
import type { MedBackup } from './med/types';

export type Rec =
  | { id: string; at: number; kind: 'meal' | 'litter'; room: Room; note?: string; alert?: boolean }
  | { id: string; at: number; kind: 'med' | 'memo'; room: null; note?: string; alert?: boolean }
  | { id: string; at: number; kind: ToggleKind; room: Room; toggleValue: boolean };

export type ToggleRec = Extract<Rec, { kind: ToggleKind }>;

export interface ToggleState {
  room: Room;
  kind: ToggleKind;
  value: boolean;
  at: number;
}

export const SCHEMA_VERSION = 2;

export interface BackupEnvelope {
  schemaVersion: number;
  exportedAt: number;
  records: Rec[];
  /** 投薬アプリ（/med/）のデータ。v1 のファイルには存在しない。 */
  med?: MedBackup;
}
