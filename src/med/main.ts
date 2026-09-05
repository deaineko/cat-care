import '../styles.css';
import { ROOMS, ROOM_LABEL, WEEK, genId, esc, type Room } from '../config';
import { midnight, addDays, fmtTime, dayKey } from '../derive';
import { dayRows, dayLabel, doseLabel, isFinished, progressCells, remaining, totalDays, type DayRow } from './calc';
import type { Cat, Dose, Regimen } from './types';
import * as med from './db';
import * as careDb from '../db';
import { exportBackup, validateBackup } from '../backup';
import { requestPersist } from '../storage';
import { registerSW } from 'virtual:pwa-register';

const today = midnight(new Date());

let cats: Cat[] = [];
let regimens: Regimen[] = [];
let doses: Dose[] = [];
let offset = 0;

function persist(p: Promise<unknown>): void {
  p.catch((e) => console.error('永続化に失敗', e));
}

// ---- lookups ----
function dosesOf(regId: string): Dose[] {
  return doses.filter((d) => d.regimenId === regId);
}
function catOf(catId: string): Cat | undefined {
  return cats.find((c) => c.id === catId);
}
function catName(catId: string): string {
  return catOf(catId)?.name ?? '（削除された猫）';
}
function liveRegimens(): Regimen[] {
  return regimens.filter((r) => !isFinished(r, dosesOf(r.id)));
}
/** 2匹以上に同時登録した処方だけをグループとして扱う。 */
function groupSize(groupId: string): number {
  return regimens.filter((r) => r.groupId === groupId).length;
}

// ---- view helpers ----
function selectedMid(): Date {
  return addDays(today, offset);
}
function dateLabel(): string {
  const d = selectedMid();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const sub = `（${WEEK[d.getDay()]}）${offset === 0 ? '今日' : ''}`;
  return `${d.getFullYear()}/${mm}/${dd}<span class="label-sub">${sub}</span>`;
}
function fmtDay(ts: number): string {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}/${mm}/${dd}(${WEEK[d.getDay()]})`;
}
function iconHtml(name: string, size: number): string {
  return `<img class="icon" src="../icons/ui/${name}.svg" alt="" width="${size}" height="${size}">`;
}

function rowHtml(reg: Regimen, row: DayRow): string {
  const done = !!row.dose;
  const attr = done ? `data-dose="${row.dose!.id}"` : `data-take="${reg.id}"`;
  const time = done ? `<span class="mrow-tm">${fmtTime(row.dose!.at)}</span>` : '';
  const dosage = reg.dose ? `<span class="mrow-dose">${esc(reg.dose)}</span>` : '';
  return `
  <div class="mrow" ${attr} data-done="${done}">
    <span class="mchk">${done ? '✓' : ''}</span>
    <span class="mrow-body">
      <span class="mrow-main"><b>${esc(catName(reg.catId))}</b> ${esc(reg.drug)}</span>
      <span class="mrow-prog">${doseLabel(row, reg)}　${dayLabel(row, reg)}${dosage}</span>
    </span>
    ${time}
  </div>`;
}

function groupRowHtml(groupId: string): string {
  const members = regimens.filter((r) => r.groupId === groupId);
  const ref = selectedMid();
  const showOpen = offset === 0;
  let done = 0;
  for (const r of members) {
    const ds = dosesOf(r.id);
    const rows = dayRows(r, ds, ref, showOpen && !isFinished(r, ds));
    // 今日は「その日の枠を消化しきったか」、過去日は「その日に記録があるか」で数える
    done += (showOpen ? rows.every((x) => x.dose) : rows.some((x) => x.dose)) ? 1 : 0;
  }
  const drug = members[0]!.drug;
  const all = done === members.length;
  return `
  <div class="mrow mrow-group" data-group="${groupId}" data-done="${all}">
    <span class="mchk">${all ? '✓' : ''}</span>
    <span class="mrow-body">
      <span class="mrow-main"><b>${esc(drug)}</b></span>
      <span class="mrow-prog">${showOpen ? '済' : '記録'} ${done}/${members.length}匹</span>
    </span>
    <span class="mrow-chev">›</span>
  </div>`;
}

function todayHtml(): string {
  const ref = selectedMid();
  const showOpen = offset === 0;

  const groupIds: string[] = [];
  const individual: { reg: Regimen; rows: DayRow[] }[] = [];

  for (const reg of regimens) {
    const ds = dosesOf(reg.id);
    const live = !isFinished(reg, ds);
    // 完了した処方でも、その日に記録があれば履歴として出す
    const rows = dayRows(reg, ds, ref, showOpen && live);
    if (reg.groupId && groupSize(reg.groupId) >= 2) {
      // 今日は進行中なら常に出す。過去日はその日に記録があるときだけ。
      const show = showOpen ? live || rows.length > 0 : rows.length > 0;
      if (show && !groupIds.includes(reg.groupId)) groupIds.push(reg.groupId);
      continue;
    }
    if (rows.length > 0) individual.push({ reg, rows });
  }

  let html = '';
  if (groupIds.length > 0) {
    html += `<p class="msec">まとめて投薬</p>`;
    html += groupIds.map(groupRowHtml).join('');
  }

  for (const room of ROOMS) {
    const items = individual
      .filter(({ reg }) => catOf(reg.catId)?.room === room)
      .sort((a, b) => catName(a.reg.catId).localeCompare(catName(b.reg.catId), 'ja'));
    if (items.length === 0) continue;
    html += `<p class="msec">${ROOM_LABEL[room]}</p>`;
    for (const { reg, rows } of items) html += rows.map((row) => rowHtml(reg, row)).join('');
  }

  if (html === '') {
    html = offset === 0
      ? `<p class="empty-hint">今日やることはありません。<br>処方を登録すると、ここに並びます。</p>`
      : `<p class="empty-hint">この日の記録はありません。</p>`;
  }
  return html;
}

function ongoingHtml(): string {
  const live = liveRegimens().sort((a, b) => a.startedAt - b.startedAt);
  const doneCount = regimens.length - live.length;
  let html = `<p class="msec">進行中の処方</p>`;
  if (live.length === 0) {
    html += `<p class="empty-hint">進行中の処方はありません。</p>`;
  } else {
    const seenGroups = new Set<string>();
    for (const reg of live) {
      // まとめて登録した処方は、今日のリストと同じく1行に畳む
      if (reg.groupId && groupSize(reg.groupId) >= 2) {
        if (seenGroups.has(reg.groupId)) continue;
        seenGroups.add(reg.groupId);
        const members = regimens.filter((r) => r.groupId === reg.groupId);
        const going = members.filter((r) => !isFinished(r, dosesOf(r.id))).length;
        html += `
      <div class="mrow mrow-flat" data-group="${reg.groupId}">
        <span class="mrow-body">
          <span class="mrow-main">${esc(reg.drug)}（${members.length}匹）</span>
          <span class="mrow-prog">${going}匹が進行中・1日${reg.dosesPerDay}回 × 全${totalDays(reg)}日</span>
        </span>
        <span class="mrow-chev">›</span>
      </div>`;
        continue;
      }
      const left = remaining(reg, dosesOf(reg.id));
      html += `
      <div class="mrow mrow-flat" data-reg="${reg.id}">
        <span class="mrow-body">
          <span class="mrow-main">${esc(catName(reg.catId))} / ${esc(reg.drug)}</span>
          <span class="mrow-prog">残り${left}回（全${reg.totalDoses}回・全${totalDays(reg)}日）</span>
        </span>
        <span class="mrow-chev">›</span>
      </div>`;
    }
  }
  if (doneCount > 0) {
    html += `<button class="linkbtn" data-archive>終わった処方（${doneCount}件）を見る</button>`;
  }
  return html;
}

function render(): void {
  const app = document.getElementById('app')!;
  const past = offset !== 0;
  const right = past
    ? `<button class="today-back" data-nav="today">今日へ戻る</button>`
    : `<button class="nav" data-nav="next" disabled aria-label="次の日">›</button>`;

  let html = `
  <div class="hd">
    <div class="hd-top">
      <div class="hd-title">${iconHtml('icon-app-med', 80)}<span class="hd-title-text"><span>くすり</span></span></div>
      <div class="hd-actions">
        <button class="icon-btn" data-settings aria-label="設定">${iconHtml('icon-gear-02', 48)}</button>
      </div>
    </div>
    <div class="datenav">
      <span class="label">${dateLabel()}</span>
      <div class="datenav-nav">
        <button class="nav" data-nav="prev" aria-label="前の日">‹</button>
        ${right}
      </div>
    </div>
  </div>`;

  html += `<div class="mwrap">`;
  html += todayHtml();
  if (past) {
    // 過去日は閲覧と後追い記録だけ。処方の登録・一覧は「今日」の関心事なので出さない
    html += `<button class="linkbtn" data-backfill>＋ この日に追記する</button>`;
  } else {
    html += `<div class="msep"></div>`;
    html += ongoingHtml();
    html += `<div class="mactions">
      <button class="btn primary-btn" data-add>＋ 処方を登録</button>
    </div>`;
  }
  html += `</div>`;
  app.innerHTML = html;
}

// ---- toast ----
let toastEl: HTMLDivElement | null = null;
let toastTimer = 0;
function showToast(msg: string, action: () => void, actionLabel = '↩ 取り消し'): void {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    document.body.appendChild(toastEl);
  }
  toastEl.innerHTML = `<span>✓ ${esc(msg)}</span><button data-action>${esc(actionLabel)}</button>`;
  toastEl.classList.add('show');
  toastEl.querySelector('[data-action]')!.addEventListener('click', () => {
    action();
    hideToast();
    render();
  });
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(hideToast, 4000);
}
function hideToast(): void {
  toastEl?.classList.remove('show');
}

// ---- sheet ----
function openSheet(content: HTMLElement): () => void {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.appendChild(content);
  overlay.appendChild(sheet);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.body.appendChild(overlay);
  return close;
}

// ---- dose の記録・取消 ----
function takeDose(regId: string, at: number): void {
  const dose: Dose = { id: genId(), regimenId: regId, at };
  doses.push(dose);
  render();
  persist(med.saveDose(dose));
  const reg = regimens.find((r) => r.id === regId)!;
  showToast(`${catName(reg.catId)}に${reg.drug}を記録`, () => {
    doses = doses.filter((d) => d.id !== dose.id);
    persist(med.deleteDose(dose.id));
  });
}

function openDoseSheet(doseId: string): void {
  const dose = doses.find((d) => d.id === doseId);
  if (!dose) return;
  const reg = regimens.find((r) => r.id === dose.regimenId)!;
  const t = new Date(dose.at);
  const timeVal = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  const c = document.createElement('div');
  c.innerHTML = `
    <h3>${esc(catName(reg.catId))} / ${esc(reg.drug)}</h3>
    <label class="flabel">飲ませた時刻</label>
    <input type="time" class="finput" value="${timeVal}" data-time />
    <div class="sheet-actions">
      <button class="danger" data-delete>記録を取り消す</button>
      <button class="primary" data-save>保存</button>
    </div>`;
  const close = openSheet(c);
  c.querySelector('[data-delete]')!.addEventListener('click', () => {
    doses = doses.filter((d) => d.id !== dose.id);
    close();
    render();
    persist(med.deleteDose(dose.id));
    showToast('記録を取り消しました', () => {
      doses.push(dose);
      persist(med.saveDose(dose));
    });
  });
  c.querySelector('[data-save]')!.addEventListener('click', () => {
    const parts = (c.querySelector('[data-time]') as HTMLInputElement).value.split(':');
    if (parts.length === 2) {
      const d = new Date(dose.at);
      d.setHours(Number(parts[0]), Number(parts[1]), 0, 0);
      dose.at = d.getTime();
    }
    close();
    render();
    persist(med.saveDose(dose));
  });
}

// ---- 一斉投薬グループ ----
function openGroupSheet(groupId: string): void {
  const ref = selectedMid();
  const render_ = (): void => {
    const members = regimens.filter((r) => r.groupId === groupId);
    const drug = members[0]?.drug ?? '';
    let list = '';
    for (const room of ROOMS) {
      const inRoom = members
        .filter((r) => catOf(r.catId)?.room === room)
        .sort((a, b) => catName(a.catId).localeCompare(catName(b.catId), 'ja'));
      if (inRoom.length === 0) continue;
      list += `<p class="msec">${ROOM_LABEL[room]}</p>`;
      for (const r of inRoom) {
        const rows = dayRows(r, dosesOf(r.id), ref, offset === 0);
        const doneRow = rows.find((x) => x.dose);
        const pending = rows.filter((x) => !x.dose).length > 0;
        list += `
        <div class="mrow" data-gtake="${r.id}" data-done="${!pending}">
          <span class="mchk">${!pending ? '✓' : ''}</span>
          <span class="mrow-body"><span class="mrow-main">${esc(catName(r.catId))}</span></span>
          ${doneRow ? `<span class="mrow-tm">${fmtTime(doneRow.dose!.at)}</span>` : ''}
          <button class="xbtn" data-gdetail="${r.id}" aria-label="この子の処方の詳細">›</button>
        </div>`;
      }
    }
    c.innerHTML = `
      <h3>${esc(drug)}</h3>
      <div class="glist">${list}</div>
      <div class="sheet-actions" style="grid-template-columns:1fr">
        <button data-close>閉じる</button>
      </div>`;
    c.querySelector('[data-close]')!.addEventListener('click', () => {
      close();
      render();
    });
  };
  const c = document.createElement('div');
  const close = openSheet(c);
  render_();
  c.addEventListener('click', (e) => {
    const detail = (e.target as HTMLElement).closest('[data-gdetail]') as HTMLElement | null;
    if (detail) {
      close();
      render();
      openRegimenSheet(detail.dataset.gdetail!);
      return;
    }
    const el = (e.target as HTMLElement).closest('[data-gtake]') as HTMLElement | null;
    if (!el) return;
    const regId = el.dataset.gtake!;
    const rows = dayRows(regimens.find((r) => r.id === regId)!, dosesOf(regId), ref, offset === 0);
    const pending = rows.find((x) => !x.dose);
    if (pending) {
      const at = offset === 0 ? Date.now() : noonOf(ref);
      const dose: Dose = { id: genId(), regimenId: regId, at };
      doses.push(dose);
      persist(med.saveDose(dose));
    } else {
      const last = rows.filter((x) => x.dose).pop();
      if (last?.dose) {
        const id = last.dose.id;
        doses = doses.filter((d) => d.id !== id);
        persist(med.deleteDose(id));
      }
    }
    render_();
  });
}

function noonOf(ref: Date): number {
  const d = new Date(ref);
  d.setHours(12, 0, 0, 0);
  return d.getTime();
}

// ---- 処方の詳細 ----
function openRegimenSheet(regId: string): void {
  const reg = regimens.find((r) => r.id === regId);
  if (!reg) return;
  const ds = dosesOf(reg.id);
  const cells = progressCells(reg, ds);
  const grid = cells
    .map((cell) => `<span class="pcell" data-on="${cell.done}" title="${cell.at ? esc(fmtTime(cell.at)) : ''}"></span>`)
    .join('');
  const members = reg.groupId ? groupSize(reg.groupId) : 1;
  const c = document.createElement('div');
  c.innerHTML = `
    <h3>${esc(catName(reg.catId))} / ${esc(reg.drug)}</h3>
    ${reg.dose ? `<p class="fmeta">用量：${esc(reg.dose)}</p>` : ''}
    ${reg.note ? `<p class="fmeta">メモ：${esc(reg.note)}</p>` : ''}
    ${members >= 2 ? `<p class="fmeta">${members}匹にまとめて登録した処方です</p>` : ''}
    <p class="fmeta">1日${reg.dosesPerDay}回 × 全${totalDays(reg)}日 ＝ 全${reg.totalDoses}回</p>
    <p class="fmeta"><b>${ds.length}回 消化／残り ${remaining(reg, ds)}回</b></p>
    <div class="pgrid">${grid}</div>
    <div class="sheet-actions">
      <button class="danger" data-delete>削除</button>
      ${isFinished(reg, ds) ? '' : `<button data-stop>中止する</button>`}
    </div>
    <div class="sheet-actions" style="grid-template-columns:1fr">
      <button data-close>閉じる</button>
    </div>`;
  const close = openSheet(c);
  c.querySelector('[data-close]')!.addEventListener('click', close);
  c.querySelector('[data-stop]')?.addEventListener('click', () => {
    reg.status = 'stopped';
    close();
    render();
    persist(med.saveRegimen(reg));
    showToast('処方を中止しました', () => {
      reg.status = 'active';
      persist(med.saveRegimen(reg));
    });
  });
  c.querySelector('[data-delete]')!.addEventListener('click', () => {
    if (!confirm(`「${catName(reg.catId)} / ${reg.drug}」を、${ds.length}件の記録ごと削除します。\nこの操作は元に戻せません。`)) return;
    regimens = regimens.filter((r) => r.id !== reg.id);
    doses = doses.filter((d) => d.regimenId !== reg.id);
    close();
    render();
    persist(med.deleteRegimen(reg.id));
  });
}

function openArchiveSheet(): void {
  const done = regimens
    .filter((r) => isFinished(r, dosesOf(r.id)))
    .sort((a, b) => b.startedAt - a.startedAt);
  const c = document.createElement('div');
  c.innerHTML = `
    <h3>終わった処方</h3>
    <div class="glist">
      ${done
        .map((r) => {
          const state = r.status === 'stopped' ? '中止' : '完了';
          const ds = dosesOf(r.id);
          // 終了日は持たない設計なので、最後の実績日を完了日として出す（実績ゼロの中止は開始日）
          const endAt = ds.length ? Math.max(...ds.map((d) => d.at)) : r.startedAt;
          return `<div class="mrow mrow-flat" data-reg="${r.id}">
            <span class="mrow-body">
              <span class="mrow-main">${esc(catName(r.catId))} / ${esc(r.drug)}</span>
              <span class="mrow-prog">${state}・${ds.length}/${r.totalDoses}回<span class="mrow-date">${fmtDay(endAt)}</span></span>
            </span>
            <span class="mrow-chev">›</span>
          </div>`;
        })
        .join('')}
    </div>
    <div class="sheet-actions" style="grid-template-columns:1fr">
      <button data-close>閉じる</button>
    </div>`;
  const close = openSheet(c);
  c.querySelector('[data-close]')!.addEventListener('click', close);
  c.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest('[data-reg]') as HTMLElement | null;
    if (!el) return;
    close();
    openRegimenSheet(el.dataset.reg!);
  });
}

// ---- 猫マスタ ----
function openCatsSheet(): void {
  const c = document.createElement('div');
  const paint = (): void => {
    let list = '';
    for (const room of ROOMS) {
      const inRoom = cats
        .filter((x) => x.room === room)
        .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
      list += `<p class="msec">${ROOM_LABEL[room]}（${inRoom.length}匹）</p>`;
      if (inRoom.length === 0) {
        list += `<p class="empty-hint">まだいません</p>`;
      } else {
        list += inRoom
          .map(
            (x) => `<div class="mrow mrow-flat">
              <span class="mrow-body"><span class="mrow-main">${esc(x.name)}</span></span>
              <button class="xbtn" data-delcat="${x.id}" aria-label="削除">✕</button>
            </div>`,
          )
          .join('');
      }
    }
    c.innerHTML = `
      <h3>猫の登録</h3>
      <div class="glist">${list}</div>
      <label class="flabel">名前を追加</label>
      <div class="addrow">
        <input class="finput" data-newname placeholder="例：ミケ" />
        <select class="finput" data-newroom>
          ${ROOMS.map((r) => `<option value="${r}">${ROOM_LABEL[r]}</option>`).join('')}
        </select>
        <button class="primary" data-addcat>追加</button>
      </div>
      <div class="sheet-actions" style="grid-template-columns:1fr">
        <button data-close>閉じる</button>
      </div>`;
    c.querySelector('[data-close]')!.addEventListener('click', () => {
      close();
      render();
    });
    c.querySelector('[data-addcat]')!.addEventListener('click', () => {
      const input = c.querySelector('[data-newname]') as HTMLInputElement;
      const name = input.value.trim();
      if (!name) return;
      const room = (c.querySelector('[data-newroom]') as HTMLSelectElement).value as Room;
      const cat: Cat = { id: genId(), name, room };
      cats.push(cat);
      persist(med.saveCat(cat));
      paint();
    });
  };
  const close = openSheet(c);
  paint();
  c.addEventListener('click', (e) => {
    const del = (e.target as HTMLElement).closest('[data-delcat]') as HTMLElement | null;
    if (!del) return;
    const id = del.dataset.delcat!;
    const cat = catOf(id);
    const used = regimens.some((r) => r.catId === id);
    if (used) {
      alert(`${cat?.name ?? 'この猫'} には処方が登録されているため削除できません。\n先に処方を削除してください。`);
      return;
    }
    cats = cats.filter((x) => x.id !== id);
    persist(med.deleteCat(id));
    paint();
  });
}

// ---- 処方の登録 ----
function openAddSheet(): void {
  if (cats.length === 0) {
    alert('先に猫を登録してください。\n設定 →「猫の登録」から追加できます。');
    openCatsSheet();
    return;
  }
  const selected = new Set<string>();
  let activeRoom: Room = ROOMS[0];
  const knownDrugs = Array.from(new Set(regimens.map((r) => r.drug))).sort();

  const c = document.createElement('div');
  const paintCats = (): void => {
    const box = c.querySelector('[data-catbox]')!;
    const inRoom = cats
      .filter((x) => x.room === activeRoom)
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    box.innerHTML = inRoom.length
      ? inRoom
          .map(
            (x) => `<button class="catchip" data-pick="${x.id}" data-on="${selected.has(x.id)}">${esc(x.name)}</button>`,
          )
          .join('')
      : `<p class="empty-hint">この部屋には猫がいません</p>`;
    const names = Array.from(selected).map(catName);
    c.querySelector('[data-selinfo]')!.textContent = names.length
      ? `選択中：${names.join('、')}（${names.length}匹）`
      : '選択中：なし';
    c.querySelectorAll('[data-roomtab]').forEach((el) => {
      (el as HTMLElement).dataset.on = String((el as HTMLElement).dataset.roomtab === activeRoom);
    });
  };

  c.innerHTML = `
    <h3>処方を登録</h3>
    <label class="flabel">どの猫に</label>
    <div class="roomtabs">
      ${ROOMS.map((r) => `<button class="roomtab" data-roomtab="${r}" data-on="${r === activeRoom}">${ROOM_LABEL[r]}</button>`).join('')}
    </div>
    <div class="catbox" data-catbox></div>
    <p class="selinfo" data-selinfo>選択中：なし</p>

    <label class="flabel">薬の名前</label>
    <input class="finput" data-drug list="druglist" placeholder="例：アモキシシリン" />
    <datalist id="druglist">${knownDrugs.map((d) => `<option value="${esc(d)}"></option>`).join('')}</datalist>

    <label class="flabel">用量（任意）</label>
    <input class="finput" data-dosage placeholder="例：1/2錠、0.5ml" />

    <div class="numrow">
      <div>
        <label class="flabel">1日の回数</label>
        <input class="finput" type="number" data-per min="1" max="6" value="2" inputmode="numeric" />
      </div>
      <div>
        <label class="flabel">日数</label>
        <input class="finput" type="number" data-days min="1" max="90" value="5" inputmode="numeric" />
      </div>
    </div>
    <p class="fmeta" data-total></p>

    <label class="flabel">メモ（任意）</label>
    <textarea data-note placeholder="例：食後、ちゅ〜るに混ぜる"></textarea>

    <div class="sheet-actions">
      <button data-cancel>キャンセル</button>
      <button class="primary" data-save>登録</button>
    </div>`;

  const close = openSheet(c);
  paintCats();

  const perEl = c.querySelector('[data-per]') as HTMLInputElement;
  const daysEl = c.querySelector('[data-days]') as HTMLInputElement;
  const totalEl = c.querySelector('[data-total]')!;
  const paintTotal = (): void => {
    const per = Math.max(1, Number(perEl.value) || 1);
    const days = Math.max(1, Number(daysEl.value) || 1);
    totalEl.textContent = `合計 ${per * days} 回ぶん（1日${per}回 × ${days}日）`;
  };
  perEl.addEventListener('input', paintTotal);
  daysEl.addEventListener('input', paintTotal);
  paintTotal();

  c.addEventListener('click', (e) => {
    const tab = (e.target as HTMLElement).closest('[data-roomtab]') as HTMLElement | null;
    if (tab) {
      activeRoom = tab.dataset.roomtab as Room;
      paintCats();
      return;
    }
    const pick = (e.target as HTMLElement).closest('[data-pick]') as HTMLElement | null;
    if (pick) {
      const id = pick.dataset.pick!;
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      paintCats();
    }
  });

  c.querySelector('[data-cancel]')!.addEventListener('click', close);
  c.querySelector('[data-save]')!.addEventListener('click', () => {
    const drug = (c.querySelector('[data-drug]') as HTMLInputElement).value.trim();
    if (selected.size === 0) {
      alert('猫を1匹以上選んでください。');
      return;
    }
    if (!drug) {
      alert('薬の名前を入力してください。');
      return;
    }
    const per = Math.max(1, Number(perEl.value) || 1);
    const days = Math.max(1, Number(daysEl.value) || 1);
    const dosage = (c.querySelector('[data-dosage]') as HTMLInputElement).value.trim();
    const note = (c.querySelector('[data-note]') as HTMLTextAreaElement).value.trim();
    const groupId = selected.size >= 2 ? genId() : undefined;
    const created: Regimen[] = Array.from(selected).map((catId) => ({
      id: genId(),
      catId,
      drug,
      dose: dosage || undefined,
      note: note || undefined,
      dosesPerDay: per,
      totalDoses: per * days,
      startedAt: Date.now(),
      status: 'active',
      groupId,
    }));
    regimens.push(...created);
    close();
    render();
    for (const reg of created) persist(med.saveRegimen(reg));
    showToast(`${created.length}件の処方を登録`, () => {
      const ids = new Set(created.map((r) => r.id));
      regimens = regimens.filter((r) => !ids.has(r.id));
      for (const id of ids) persist(med.deleteRegimen(id));
    });
  });
}

// ---- 過去日への追記 ----
function openBackfillSheet(): void {
  const ref = selectedMid();
  const live = liveRegimens();
  if (live.length === 0) {
    alert('進行中の処方がありません。');
    return;
  }
  const c = document.createElement('div');
  c.innerHTML = `
    <h3>${ref.getMonth() + 1}/${ref.getDate()} に追記</h3>
    <label class="flabel">どの処方</label>
    <select class="finput" data-reg>
      ${live
        .map((r) => `<option value="${r.id}">${esc(catName(r.catId))} / ${esc(r.drug)}（残り${remaining(r, dosesOf(r.id))}回）</option>`)
        .join('')}
    </select>
    <label class="flabel">飲ませた時刻</label>
    <input class="finput" type="time" value="12:00" data-time />
    <div class="sheet-actions">
      <button data-cancel>キャンセル</button>
      <button class="primary" data-save>追記する</button>
    </div>`;
  const close = openSheet(c);
  c.querySelector('[data-cancel]')!.addEventListener('click', close);
  c.querySelector('[data-save]')!.addEventListener('click', () => {
    const regId = (c.querySelector('[data-reg]') as HTMLSelectElement).value;
    const parts = (c.querySelector('[data-time]') as HTMLInputElement).value.split(':');
    const d = new Date(ref);
    d.setHours(Number(parts[0]) || 12, Number(parts[1]) || 0, 0, 0);
    const dose: Dose = { id: genId(), regimenId: regId, at: d.getTime() };
    doses.push(dose);
    close();
    render();
    persist(med.saveDose(dose));
    showToast('追記しました', () => {
      doses = doses.filter((x) => x.id !== dose.id);
      persist(med.deleteDose(dose.id));
    });
  });
}

// ---- 設定・バックアップ ----
function openSettings(): void {
  const c = document.createElement('div');
  c.innerHTML = `
    <h3>⚙️ 設定</h3>
    <div class="sheet-actions" style="grid-template-columns:1fr">
      <button data-cats>猫の登録・編集（${cats.length}匹）</button>
      <button data-export>書き出し（JSON）</button>
      <button data-import>読み込み（全置換）</button>
      <button data-back>お世話アプリへ</button>
      <button data-close style="margin-top:4px">閉じる</button>
    </div>
    <p class="fmeta">書き出しには、お世話アプリの記録も一緒に入ります。</p>`;
  const close = openSheet(c);
  c.querySelector('[data-close]')!.addEventListener('click', close);
  c.querySelector('[data-cats]')!.addEventListener('click', () => {
    close();
    openCatsSheet();
  });
  c.querySelector('[data-back]')!.addEventListener('click', () => {
    location.href = '../';
  });
  c.querySelector('[data-export]')!.addEventListener('click', () => {
    void (async () => {
      const records = await careDb.loadRecords();
      exportBackup(records, { cats, regimens, doses });
    })();
  });
  c.querySelector('[data-import]')!.addEventListener('click', () => {
    startImport(close);
  });
}

function startImport(closeSettings: () => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    const res = validateBackup(await file.text());
    if (!res.ok) {
      alert(`読み込めませんでした：${res.error}\n現在のデータはそのままです。`);
      return;
    }
    const nextMed = res.med ?? { cats: [], regimens: [], doses: [] };
    if (
      !confirm(
        `お世話の記録 ${res.records.length}件 と 投薬の記録 ${nextMed.doses.length}件 で、いまのデータを置き換えます。\nこの操作は元に戻せません。よろしいですか？`,
      )
    ) {
      return;
    }
    try {
      await careDb.replaceAll(res.records);
      await med.replaceAll(nextMed);
      await refreshFromDb();
      closeSettings();
      showToast('読み込みました', () => {}, '閉じる');
    } catch (e) {
      console.error(e);
      alert('読み込みに失敗しました。');
    }
  });
  input.click();
}

// ---- event delegation ----
document.getElementById('app')!.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;

  const take = target.closest('[data-take]') as HTMLElement | null;
  if (take) return takeDose(take.dataset.take!, Date.now());

  const dose = target.closest('[data-dose]') as HTMLElement | null;
  if (dose) return openDoseSheet(dose.dataset.dose!);

  const group = target.closest('[data-group]') as HTMLElement | null;
  if (group) return openGroupSheet(group.dataset.group!);

  const reg = target.closest('[data-reg]') as HTMLElement | null;
  if (reg) return openRegimenSheet(reg.dataset.reg!);

  if (target.closest('[data-add]')) return openAddSheet();
  if (target.closest('[data-archive]')) return openArchiveSheet();
  if (target.closest('[data-backfill]')) return openBackfillSheet();
  if (target.closest('[data-settings]')) return openSettings();

  const nav = target.closest('[data-nav]') as HTMLElement | null;
  if (nav) {
    const dir = nav.dataset.nav;
    if (dir === 'prev') offset -= 1;
    else if (dir === 'next' && offset < 0) offset += 1;
    else if (dir === 'today') offset = 0;
    hideToast();
    render();
  }
});

// ---- startup ----
async function refreshFromDb(): Promise<void> {
  const all = await med.loadAll();
  cats = all.cats;
  regimens = all.regimens;
  doses = all.doses;
  render();
}

async function init(): Promise<void> {
  void requestPersist();
  await refreshFromDb();
}

render();
void init();

const updateSW = registerSW({
  onNeedRefresh() {
    showToast('新しい版があります', () => updateSW(true), '更新');
  },
});

window.addEventListener('focus', () => {
  void init();
});

if (import.meta.env.DEV) {
  (window as unknown as { __catmed: unknown }).__catmed = {
    state: () => ({ cats, regimens, doses }),
    seedCat: async (name: string, room: Room) => {
      const cat: Cat = { id: genId(), name, room };
      cats.push(cat);
      await med.saveCat(cat);
      render();
      return cat;
    },
    setOffset: (n: number) => {
      offset = n;
      render();
    },
    dayKeyOf: (ts: number) => dayKey(ts),
  };
}

export {};
