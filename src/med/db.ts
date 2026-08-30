import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Cat, Dose, Regimen, MedBackup } from './types';

interface CatMedDB extends DBSchema {
  cats: { key: string; value: Cat };
  regimens: { key: string; value: Regimen };
  doses: { key: string; value: Dose; indexes: { 'by-regimen': string } };
}

let dbp: Promise<IDBPDatabase<CatMedDB>> | null = null;
function db(): Promise<IDBPDatabase<CatMedDB>> {
  if (!dbp) {
    dbp = openDB<CatMedDB>('cat-med', 1, {
      upgrade(d) {
        d.createObjectStore('cats', { keyPath: 'id' });
        d.createObjectStore('regimens', { keyPath: 'id' });
        const doses = d.createObjectStore('doses', { keyPath: 'id' });
        doses.createIndex('by-regimen', 'regimenId');
      },
    });
  }
  return dbp;
}

export async function loadAll(): Promise<MedBackup> {
  const d = await db();
  const [cats, regimens, doses] = await Promise.all([
    d.getAll('cats'),
    d.getAll('regimens'),
    d.getAll('doses'),
  ]);
  return { cats, regimens, doses };
}

export async function saveCat(cat: Cat): Promise<void> {
  await (await db()).put('cats', cat);
}
export async function deleteCat(id: string): Promise<void> {
  await (await db()).delete('cats', id);
}

export async function saveRegimen(reg: Regimen): Promise<void> {
  await (await db()).put('regimens', reg);
}

/** 処方と、それにぶら下がる投与記録をまとめて消す。 */
export async function deleteRegimen(id: string): Promise<void> {
  const tx = (await db()).transaction(['regimens', 'doses'], 'readwrite');
  await tx.objectStore('regimens').delete(id);
  const idx = tx.objectStore('doses').index('by-regimen');
  for (const dose of await idx.getAll(id)) {
    await tx.objectStore('doses').delete(dose.id);
  }
  await tx.done;
}

export async function saveDose(dose: Dose): Promise<void> {
  await (await db()).put('doses', dose);
}
export async function deleteDose(id: string): Promise<void> {
  await (await db()).delete('doses', id);
}

/** 全データを置き換える（バックアップ復元）。単一トランザクションなので原子的。 */
export async function replaceAll(next: MedBackup): Promise<void> {
  const tx = (await db()).transaction(['cats', 'regimens', 'doses'], 'readwrite');
  await tx.objectStore('cats').clear();
  await tx.objectStore('regimens').clear();
  await tx.objectStore('doses').clear();
  for (const c of next.cats) await tx.objectStore('cats').put(c);
  for (const r of next.regimens) await tx.objectStore('regimens').put(r);
  for (const d of next.doses) await tx.objectStore('doses').put(d);
  await tx.done;
}
