import type { Room } from '../config';

export interface Cat {
  id: string;
  name: string;
  room: Room;
  archived?: boolean;
}

/**
 * 処方。終了日は持たず「総回数 totalDoses」で管理する（実施基準）。
 * 飲ませ忘れた分だけ後ろにずれ、薬を飲み切ったところで完了になる。
 */
export interface Regimen {
  id: string;
  catId: string;
  drug: string;
  dose?: string;
  note?: string;
  dosesPerDay: number;
  totalDoses: number;
  startedAt: number;
  status: 'active' | 'stopped';
  /** 同じ薬を複数の猫にまとめて登録したときの識別子（表示を畳む用途のみ）。 */
  groupId?: string;
}

export interface Dose {
  id: string;
  regimenId: string;
  at: number;
}

export const MED_SCHEMA_VERSION = 1;

export interface MedBackup {
  cats: Cat[];
  regimens: Regimen[];
  doses: Dose[];
}
