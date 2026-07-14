import type { Room, ToggleKind } from './config';

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

export const SCHEMA_VERSION = 1;

export interface BackupEnvelope {
  schemaVersion: number;
  exportedAt: number;
  records: Rec[];
}
