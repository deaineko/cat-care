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
  /** 延長の履歴。totalDoses は延長ぶんを含んだ現在値で、これは表示用。計算には使わない。 */
  extensions?: Extension[];
}

export interface Extension {
  at: number;
  days: number;
}

export interface Dose {
  id: string;
  regimenId: string;
  at: number;
}

/**
 * 薬の一覧（ひな形）。処方登録時に値を写し取るだけで、Regimen からは参照しない。
 * 薬名で一意（1薬＝1ひな形）。
 */
export interface DrugTemplate {
  id: string;
  drug: string;
  dose?: string;
  note?: string;
  dosesPerDay: number;
  days: number;
}

export const MED_SCHEMA_VERSION = 1;

export interface MedBackup {
  cats: Cat[];
  regimens: Regimen[];
  doses: Dose[];
  /** 薬の一覧。これより前に書き出したファイルには存在しない。 */
  drugs?: DrugTemplate[];
}
