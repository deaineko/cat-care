import './styles.css';
import {
  ROOMS,
  ROOM_LABEL,
  TOGGLE_KINDS,
  KIND_META,
  WEEK,
  genId,
  esc,
  type Room,
  type Kind,
  type ToggleKind,
} from './config';
import type { Rec } from './types';
import {
  midnight,
  addDays,
  fmtTime,
  lastTimeStr,
  latestToggleValue,
  recsForDay,
} from './derive';
import * as db from './db';
import { requestPersist } from './storage';
import { exportBackup, validateBackup } from './backup';
import { registerSW } from 'virtual:pwa-register';

const today = midnight(new Date());

// ---- in-memory mirror of the DB (for synchronous rendering) ----
let records: Rec[] = [];
const toggles: Record<string, boolean> = {};
let offset = 0; // 0 = today

function persist(p: Promise<unknown>): void {
  p.catch((e) => console.error('永続化に失敗', e));
}

// ---- view helpers ----
function selectedMid(): Date {
  return addDays(today, offset);
}
function dateLabel(): string {
  const d = selectedMid();
  const base = `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）`;
  return offset === 0 ? `${base}今日` : base;
}

function iconHtml(name: string, size: number): string {
  return `<img class="icon" src="icons/ui/${name}.svg" alt="" width="${size}" height="${size}">`;
}

function toggleHtml(room: Room, kind: ToggleKind): string {
  const on = toggles[`${room}:${kind}`] ?? false;
  const word = kind === 'window' ? (on ? '開' : '閉') : on ? '入' : '切';
  const meta = KIND_META[kind];
  return `
  <div class="tg" data-toggle="${room}:${kind}" data-on="${on}">
    <div class="tg-label">${iconHtml(meta.icon!, 18)}${meta.label}</div>
    <div class="tg-row">
      <span class="track"><span class="knob"></span></span>
      <span class="tg-word">${word}</span>
    </div>
  </div>`;
}

function roomCardHtml(room: Room): string {
  return `
  <div class="card">
    <p class="card-title">${ROOM_LABEL[room]}</p>
    <div class="grid3">
      ${TOGGLE_KINDS.map((kind) => toggleHtml(room, kind)).join('')}
    </div>
    <div class="grid2 recbtns">
      <button class="btn" data-rec="${room}:meal">${iconHtml(KIND_META.meal.icon!, 26)}ごはん</button>
      <button class="btn" data-rec="${room}:litter">${iconHtml(KIND_META.litter.icon!, 26)}トイレ掃除</button>
    </div>
    <div class="last">🕐 最後のごはん <b>${lastTimeStr(records, room, 'meal', today)}</b> ・ トイレ <b>${lastTimeStr(records, room, 'litter', today)}</b></div>
  </div>`;
}

function rowInner(r: Rec): string {
  const em = KIND_META[r.kind].em;
  let txt: string;
  if (r.kind === 'window') txt = r.toggleValue ? '窓を開けた' : '窓を閉めた';
  else if (r.kind === 'stove') txt = r.toggleValue ? 'ストーブを入れた' : 'ストーブを切った';
  else if (r.kind === 'memo')
    txt = r.alert ? `<span class="mark">${esc(r.note ?? '')}</span>` : esc(r.note ?? '');
  else if (r.kind === 'med')
    txt = r.note
      ? r.alert
        ? `<span class="mark">${esc(r.note)}</span>`
        : esc(r.note)
      : '薬　<span class="hint">（タップで追記）</span>';
  else txt = KIND_META[r.kind].label;
  return `<span class="tm">${fmtTime(r.at)}</span><span class="em">${em}</span><span class="txt">${txt}</span>`;
}

function sectionHtml(label: string, recs: Rec[], editable: boolean): string {
  let inner: string;
  if (recs.length === 0) {
    inner = `<div class="hbox empty">まだ記録なし</div>`;
  } else {
    inner = `<div class="hbox">${recs
      .map((r) => `<div class="hrow"${editable ? ` data-edit="${r.id}"` : ''}>${rowInner(r)}</div>`)
      .join('')}</div>`;
  }
  return `<p class="hsec-label">${label}</p>${inner}`;
}

function historyHtml(): string {
  const mid = selectedMid();
  const editable = offset === 0;
  const dayRecs = recsForDay(records, mid);
  let html = `<p class="history-title">${offset === 0 ? '今日の履歴' : '履歴'}</p>`;
  for (const room of ROOMS) {
    html += sectionHtml(ROOM_LABEL[room], dayRecs.filter((r) => r.room === room), editable);
  }
  html += sectionHtml('全体', dayRecs.filter((r) => r.room === null), editable);
  if (editable && dayRecs.length === 0) {
    html += `<p class="empty-hint">ボタンを押すと、ここに今日の記録が出ます。</p>`;
  }
  return `<div class="history">${html}</div>`;
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
      <div class="hd-title">${iconHtml('icon-app', 28)}猫の世話</div>
      <div class="hd-actions">
        <button class="icon-btn" data-settings aria-label="設定">${iconHtml('icon-gear', 22)}</button>
      </div>
    </div>
    <div class="datenav">
      <button class="nav" data-nav="prev" aria-label="前の日">‹</button>
      <span class="label">${dateLabel()}</span>
      ${right}
    </div>
  </div>`;

  if (past) {
    html += `<div class="banner">🔒 ${dateLabel()} を閲覧中・操作できるのは今日だけ</div>`;
  } else {
    html += `<div class="cards">`;
    for (const room of ROOMS) html += roomCardHtml(room);
    html += `
    <div class="card">
      <p class="card-title">全体</p>
      <div class="grid2 recbtns">
        <button class="btn" data-rec="all:med"><span class="em">💊</span>薬</button>
        <button class="btn" data-memo><span class="em">📝</span>自由メモ</button>
      </div>
    </div></div>`;
  }
  html += historyHtml();
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

// ---- overlay sheet ----
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

function alertToggleHtml(on: boolean): string {
  return `<div class="alert-toggle" data-alert-toggle data-on="${on}">
    <span class="at-em">⚠️</span>
    <span class="at-text">注意（あとで気にかける）</span>
    <span class="at-state">${on ? 'オン' : 'オフ'}</span>
  </div>`;
}
function wireAlertToggle(root: ParentNode): void {
  const at = root.querySelector('[data-alert-toggle]') as HTMLElement | null;
  if (!at) return;
  at.addEventListener('click', () => {
    const on = at.dataset.on !== 'true';
    at.dataset.on = String(on);
    at.querySelector('.at-state')!.textContent = on ? 'オン' : 'オフ';
  });
}

function openMemoSheet(): void {
  const c = document.createElement('div');
  c.innerHTML = `
    <h3>📝 自由メモ</h3>
    <textarea placeholder="気づいたことを書く（例: 〇〇が食欲ない）"></textarea>
    ${alertToggleHtml(false)}
    <div class="sheet-actions">
      <button data-cancel>キャンセル</button>
      <button class="primary" data-save>保存</button>
    </div>`;
  const close = openSheet(c);
  wireAlertToggle(c);
  const ta = c.querySelector('textarea')!;
  c.querySelector('[data-cancel]')!.addEventListener('click', close);
  c.querySelector('[data-save]')!.addEventListener('click', () => {
    const text = ta.value.trim();
    if (!text) {
      close();
      return;
    }
    const on = (c.querySelector('[data-alert-toggle]') as HTMLElement).dataset.on === 'true';
    const rec: Rec = { id: genId(), at: Date.now(), kind: 'memo', room: null, note: text, alert: on };
    records.push(rec);
    close();
    render();
    persist(db.saveRecord(rec));
    showToast('メモを保存', () => {
      removeRecById(rec.id);
      persist(db.deleteRecord(rec));
    });
  });
  setTimeout(() => ta.focus(), 50);
}

function openEditSheet(id: string): void {
  const r = records.find((x) => x.id === id);
  if (!r) return;
  const hasNote = r.kind === 'memo' || r.kind === 'med';
  const t = new Date(r.at);
  const timeVal = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  const c = document.createElement('div');
  c.innerHTML = `
    <h3>${KIND_META[r.kind].em} ${KIND_META[r.kind].label} を編集</h3>
    <label style="font-size:13px;color:var(--text-sub)">時刻</label>
    <input type="time" value="${timeVal}" data-time
      style="width:100%;margin:6px 0 14px;min-height:44px;border:0.5px solid var(--border-2);border-radius:var(--radius-md);background:var(--surface);color:var(--text);font:inherit;padding:0 12px" />
    ${hasNote ? `<textarea placeholder="メモ（誰に何を 等）">${esc(r.note ?? '')}</textarea>${alertToggleHtml(!!r.alert)}` : ''}
    <div class="sheet-actions">
      <button class="danger" data-delete>削除</button>
      <button class="primary" data-save>保存</button>
    </div>`;
  const close = openSheet(c);
  if (hasNote) wireAlertToggle(c);
  c.querySelector('[data-delete]')!.addEventListener('click', () => {
    const removed = removeRecById(id);
    close();
    render();
    if (removed) {
      persist(db.deleteRecord(removed));
      showToast('削除しました', () => {
        records.push(removed);
        if (removed.kind === 'window' || removed.kind === 'stove') {
          toggles[`${removed.room}:${removed.kind}`] = latestToggleValue(
            records,
            removed.room,
            removed.kind,
          );
        }
        persist(db.saveRecord(removed));
      });
    }
  });
  c.querySelector('[data-save]')!.addEventListener('click', () => {
    const time = (c.querySelector('[data-time]') as HTMLInputElement).value.split(':');
    if (time.length === 2) {
      const d = new Date(r.at);
      d.setHours(Number(time[0]), Number(time[1]), 0, 0);
      r.at = d.getTime();
    }
    if (hasNote) {
      const ta = c.querySelector('textarea') as HTMLTextAreaElement;
      const on = (c.querySelector('[data-alert-toggle]') as HTMLElement).dataset.on === 'true';
      r.note = ta.value.trim() || undefined;
      r.alert = on;
    }
    close();
    render();
    persist(db.saveRecord(r));
  });
}

function openSettings(): void {
  const c = document.createElement('div');
  c.innerHTML = `
    <h3>⚙️ 設定</h3>
    <div class="sheet-actions" style="grid-template-columns:1fr">
      <button data-export>書き出し（JSON）</button>
      <button data-import>読み込み（全置換）</button>
      <button data-close style="margin-top:4px">閉じる</button>
    </div>`;
  const close = openSheet(c);
  c.querySelector('[data-export]')!.addEventListener('click', () => {
    exportBackup(records);
  });
  c.querySelector('[data-import]')!.addEventListener('click', () => {
    startImport(close);
  });
  c.querySelector('[data-close]')!.addEventListener('click', close);
}

/** 全置換し、置換前のデータを返す（取り消し用）。 */
async function doReplace(newRecords: Rec[]): Promise<Rec[]> {
  const prev = records.slice();
  await db.replaceAll(newRecords);
  await refreshFromDb();
  return prev;
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
    const cur = records.length;
    const next = res.records.length;
    if (!confirm(`現在 ${cur} 件を、読み込んだ ${next} 件で置き換えます。\nこの操作は元に戻せません。よろしいですか？`)) {
      return;
    }
    try {
      const prev = await doReplace(res.records);
      closeSettings();
      showToast(`${next} 件を読み込みました`, () => {
        void doReplace(prev);
      });
    } catch (e) {
      console.error(e);
      alert('読み込みに失敗しました。現在のデータは保持されています。');
    }
  });
  input.click();
}

// ---- state mutators ----
function removeRecById(id: string): Rec | undefined {
  const i = records.findIndex((x) => x.id === id);
  if (i < 0) return undefined;
  return records.splice(i, 1)[0];
}

// ---- event delegation ----
document.getElementById('app')!.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;

  const tg = target.closest('[data-toggle]') as HTMLElement | null;
  if (tg && offset === 0) {
    const [room, kind] = tg.dataset.toggle!.split(':') as [Room, ToggleKind];
    const key = `${room}:${kind}`;
    const next = !(toggles[key] ?? false);
    toggles[key] = next;
    const rec: Rec = { id: genId(), at: Date.now(), kind, room, toggleValue: next };
    records.push(rec);
    render();
    persist(db.saveRecord(rec));
    const w = kind === 'window' ? (next ? '開けた' : '閉めた') : next ? '入れた' : '切った';
    showToast(`${ROOM_LABEL[room]}の${KIND_META[kind].label}を${w}`, () => {
      removeRecById(rec.id);
      toggles[key] = latestToggleValue(records, room, kind);
      persist(db.deleteRecord(rec));
    });
    return;
  }

  const recBtn = target.closest('[data-rec]') as HTMLElement | null;
  if (recBtn && offset === 0) {
    const [roomRaw, kind] = recBtn.dataset.rec!.split(':') as [string, Kind];
    const room = roomRaw === 'all' ? null : (roomRaw as Room);
    const rec = { id: genId(), at: Date.now(), kind, room } as Rec;
    records.push(rec);
    render();
    persist(db.saveRecord(rec));
    const where = room ? `${ROOM_LABEL[room]}の` : '';
    showToast(`${where}${KIND_META[kind].label}を記録`, () => {
      removeRecById(rec.id);
      persist(db.deleteRecord(rec));
    });
    return;
  }

  if (target.closest('[data-memo]') && offset === 0) return openMemoSheet();
  if (target.closest('[data-settings]')) return openSettings();

  const edit = target.closest('[data-edit]') as HTMLElement | null;
  if (edit) return openEditSheet(edit.dataset.edit!);

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
  records = await db.loadRecords();
  const map = await db.loadToggleMap();
  for (const room of ROOMS) {
    for (const kind of TOGGLE_KINDS) {
      const key = `${room}:${kind}`;
      toggles[key] = map[key] ?? latestToggleValue(records, room, kind);
    }
  }
  render();
}

async function init(): Promise<void> {
  void requestPersist();
  await refreshFromDb();
}

render(); // 初期スケルトン（DB読み込み前）
void init();

// Service Worker：更新を検知したらユーザーに再起動を促す（裏で勝手に入れ替えない）
const updateSW = registerSW({
  onNeedRefresh() {
    showToast('新しい版があります', () => updateSW(true), '更新');
  },
});

// 別タブ・別ウィンドウでの更新を反映（同一端末内の整合）
window.addEventListener('focus', () => {
  void init();
});

if (import.meta.env.DEV) {
  (window as unknown as { __catcare: unknown }).__catcare = {
    getRecords: () => records,
    applyBackupText: async (text: string) => {
      const res = validateBackup(text);
      if (!res.ok) return res;
      await doReplace(res.records);
      return { ok: true, count: res.records.length };
    },
  };
}

export {};
