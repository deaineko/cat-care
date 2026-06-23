import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from 'idb';
import { ROOMS, TOGGLE_KINDS, type Room, type ToggleKind } from './config';
import { compareDesc } from './derive';
import type { Rec, ToggleRec, ToggleState } from './types';

interface CatCareDB extends DBSchema {
  records: {
    key: string;
    value: Rec;
    indexes: {
      'by-at': number;
      'by-room-kind-at': [Room, ToggleKind, number];
    };
  };
  toggleStates: {
    key: [Room, ToggleKind];
    value: ToggleState;
  };
}

let dbp: Promise<IDBPDatabase<CatCareDB>> | null = null;
function db(): Promise<IDBPDatabase<CatCareDB>> {
  if (!dbp) {
    dbp = openDB<CatCareDB>('cat-care', 1, {
      upgrade(d) {
        const rec = d.createObjectStore('records', { keyPath: 'id' });
        rec.createIndex('by-at', 'at');
        rec.createIndex('by-room-kind-at', ['room', 'kind', 'at']);
        d.createObjectStore('toggleStates', { keyPath: ['room', 'kind'] });
      },
    });
  }
  return dbp;
}

export async function loadRecords(): Promise<Rec[]> {
  return (await db()).getAll('records');
}

export async function loadToggleMap(): Promise<Record<string, boolean>> {
  const all = await (await db()).getAll('toggleStates');
  const map: Record<string, boolean> = {};
  for (const t of all) map[`${t.room}:${t.kind}`] = t.value;
  return map;
}

type RW = IDBPTransaction<CatCareDB, ('records' | 'toggleStates')[], 'readwrite'>;

/** records 内の (room, kind) の最新値を toggleStates に反映（同一 tx 内）。 */
async function recomputeToggle(tx: RW, room: Room, kind: ToggleKind): Promise<void> {
  const idx = tx.objectStore('records').index('by-room-kind-at');
  const range = IDBKeyRange.bound([room, kind, 0], [room, kind, 8.64e15]);
  const cursor = await idx.openCursor(range, 'prev');
  const states = tx.objectStore('toggleStates');
  if (cursor && cursor.value.kind === kind) {
    await states.put({ room, kind, value: cursor.value.toggleValue, at: cursor.value.at });
  } else {
    await states.delete([room, kind]);
  }
}

/** 新規・編集の両方（put 上書き）。window/stove は toggleStates も同時更新。 */
export async function saveRecord(rec: Rec): Promise<void> {
  const tx = (await db()).transaction(['records', 'toggleStates'], 'readwrite');
  await tx.objectStore('records').put(rec);
  if (rec.kind === 'window' || rec.kind === 'stove') {
    await recomputeToggle(tx, rec.room, rec.kind);
  }
  await tx.done;
}

export async function deleteRecord(rec: Rec): Promise<void> {
  const tx = (await db()).transaction(['records', 'toggleStates'], 'readwrite');
  await tx.objectStore('records').delete(rec.id);
  if (rec.kind === 'window' || rec.kind === 'stove') {
    await recomputeToggle(tx, rec.room, rec.kind);
  }
  await tx.done;
}

/**
 * 全データを置き換える（バックアップ復元）。単一トランザクションなので、
 * 途中で失敗すれば自動でアボート＝元のデータは変わらない（IndexedDB の原子性）。
 */
export async function replaceAll(newRecords: Rec[]): Promise<void> {
  const tx = (await db()).transaction(['records', 'toggleStates'], 'readwrite');
  const recStore = tx.objectStore('records');
  const togStore = tx.objectStore('toggleStates');
  await recStore.clear();
  await togStore.clear();
  for (const r of newRecords) await recStore.put(r);
  for (const room of ROOMS) {
    for (const kind of TOGGLE_KINDS) {
      let best: ToggleRec | null = null;
      for (const r of newRecords) {
        if (r.kind === kind && r.room === room && (!best || compareDesc(r, best) < 0)) best = r;
      }
      if (best) await togStore.put({ room, kind, value: best.toggleValue, at: best.at });
    }
  }
  await tx.done;
}
