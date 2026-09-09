'use strict';

/* ---------- tiny id / date helpers ---------- */

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function getMonday(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  date.setDate(date.getDate() + diff);
  return date;
}
function pad2(n) {
  return String(n).padStart(2, '0');
}
function weekIdFor(date) {
  const m = getMonday(date);
  return `${m.getFullYear()}-${pad2(m.getMonth() + 1)}-${pad2(m.getDate())}`;
}
function weekLabelFor(weekId) {
  const d = new Date(weekId + 'T00:00:00');
  return 'Week of ' + d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function addWeeks(weekId, n) {
  const d = new Date(weekId + 'T00:00:00');
  d.setDate(d.getDate() + n * 7);
  return weekIdFor(d);
}

/* ---------- IndexedDB layer ---------- */

const DB_NAME = 'plant-health-tracker';
const DB_VERSION = 1;
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('fields')) {
        db.createObjectStore('fields', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('plants')) {
        const s = db.createObjectStore('plants', { keyPath: 'id' });
        s.createIndex('byField', 'fieldId');
      }
      if (!db.objectStoreNames.contains('scores')) {
        const s = db.createObjectStore('scores', { keyPath: 'id' });
        s.createIndex('byPlant', 'plantId');
        s.createIndex('byFieldWeek', ['fieldId', 'weekId']);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function idbGetAll(store) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}
function idbGetAllByIndex(store, index, query) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).index(index).getAll(query);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}
function idbPut(store, value) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
  }));
}
function idbDelete(store, key) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}
function idbClear(store) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}
function idbBulkPut(store, values) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    values.forEach((v) => os.put(v));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

/* ---------- app state ---------- */

const state = {
  screen: 'fields',
  field: null,          // current field record
  mode: 'plant',         // 'plant' | 'score'
  weekId: weekIdFor(new Date()),
  plantMap: new Map(),    // "r,c" -> plantId
  scoreMap: new Map(),    // plantId -> {score, note}
  selectedPlantId: null,
  view: { scale: 1, x: 0, y: 0 },
};

let lastDeleted = null; // for undo toast: {plant, scores:[]}
let toastTimer = null;

/* ---------- DOM refs ---------- */

const $ = (sel) => document.querySelector(sel);
const screenFields = $('#screen-fields');
const screenField = $('#screen-field');
const fieldList = $('#field-list');
const fieldListEmpty = $('#field-list-empty');
const fieldTitle = $('#field-title');
const canvas = $('#grid-canvas');
const ctx = canvas.getContext('2d');
const canvasWrap = $('#canvas-wrap');
const emptyGridHint = $('#empty-grid-hint');
const weekLabelEl = $('#week-label');
const weekDateInput = $('#week-date-input');
const toastEl = $('#toast');

/* ---------- palette lookup (from CSS custom properties) ---------- */

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
let PALETTE = {};
function loadPalette() {
  PALETTE = {
    surface: cssVar('--surface-1'),
    gridline: cssVar('--gridline'),
    baseline: cssVar('--baseline'),
    textPrimary: cssVar('--text-primary'),
    unscored: cssVar('--unscored'),
    scores: [null, cssVar('--score-1'), cssVar('--score-2'), cssVar('--score-3'), cssVar('--score-4'), cssVar('--score-5')],
  };
}

/* ---------- toast ---------- */

function showToast(message, actionLabel, actionFn, duration = 4000) {
  clearTimeout(toastTimer);
  toastEl.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = message;
  toastEl.appendChild(span);
  if (actionLabel) {
    const btn = document.createElement('button');
    btn.textContent = actionLabel;
    btn.onclick = () => { hideToast(); actionFn && actionFn(); };
    toastEl.appendChild(btn);
  }
  toastEl.classList.remove('hidden');
  toastTimer = setTimeout(hideToast, duration);
}
function hideToast() {
  toastEl.classList.add('hidden');
  clearTimeout(toastTimer);
}

/* ---------- screen navigation ---------- */

function showScreen(name) {
  state.screen = name;
  screenFields.classList.toggle('hidden', name !== 'fields');
  screenField.classList.toggle('hidden', name !== 'field');
}

/* ---------- fields list ---------- */

async function renderFieldList() {
  const fields = await idbGetAll('fields');
  fields.sort((a, b) => b.createdAt - a.createdAt);
  fieldList.innerHTML = '';
  fieldListEmpty.classList.toggle('hidden', fields.length > 0);
  for (const f of fields) {
    const li = document.createElement('li');
    const plants = await idbGetAllByIndex('plants', 'byField', f.id);
    li.innerHTML = `<span class="field-name"></span><span class="field-meta"></span>`;
    li.querySelector('.field-name').textContent = f.name;
    li.querySelector('.field-meta').textContent = `${f.rows} × ${f.cols} grid · ${plants.length} plants`;
    li.onclick = () => openField(f);
    fieldList.appendChild(li);
  }
}

async function createField(name, rows, cols) {
  const field = { id: uid(), name, rows, cols, createdAt: Date.now() };
  await idbPut('fields', field);
  return field;
}

/* ---------- open a field ---------- */

async function openField(field) {
  state.field = field;
  state.mode = 'plant';
  state.weekId = weekIdFor(new Date());
  state.selectedPlantId = null;
  fieldTitle.textContent = field.name;
  document.querySelectorAll('#mode-toggle button').forEach((b) => b.classList.toggle('active', b.dataset.mode === 'plant'));

  showScreen('field');
  resizeCanvas();

  await loadPlantsForField();
  await loadScoresForCurrentWeek();
  fitView();
  updateWeekLabel();
  draw();
}

async function loadPlantsForField() {
  const plants = await idbGetAllByIndex('plants', 'byField', state.field.id);
  state.plantMap = new Map();
  for (const p of plants) state.plantMap.set(`${p.row},${p.col}`, p.id);
}

async function loadScoresForCurrentWeek() {
  const scores = await idbGetAllByIndex('scores', 'byFieldWeek', [state.field.id, state.weekId]);
  state.scoreMap = new Map();
  for (const s of scores) state.scoreMap.set(s.plantId, { score: s.score, note: s.note });
}

function updateWeekLabel() {
  weekLabelEl.textContent = weekLabelFor(state.weekId);
  weekDateInput.value = state.weekId;
}

/* ---------- canvas sizing ---------- */

const BASE_CELL = 28;
let dpr = Math.max(1, window.devicePixelRatio || 1);

function resizeCanvas() {
  const rect = canvasWrap.getBoundingClientRect();
  dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  draw();
}
window.addEventListener('resize', resizeCanvas);

function fitView() {
  const rect = canvasWrap.getBoundingClientRect();
  if (!state.field || rect.width === 0) { state.view = { scale: 1, x: 0, y: 0 }; return; }
  const gridW = state.field.cols * BASE_CELL;
  const gridH = state.field.rows * BASE_CELL;
  const scale = Math.min((rect.width - 24) / gridW, (rect.height - 24) / gridH, 3);
  const clampedScale = Math.max(0.05, scale);
  const cellSize = BASE_CELL * clampedScale;
  const x = (rect.width - state.field.cols * cellSize) / 2;
  const y = (rect.height - state.field.rows * cellSize) / 2;
  state.view = { scale: clampedScale, x, y };
}

/* ---------- drawing ---------- */

function draw() {
  if (!state.field) return;
  const rectW = canvas.width, rectH = canvas.height;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rectW / dpr, rectH / dpr);
  ctx.fillStyle = PALETTE.surface;
  ctx.fillRect(0, 0, rectW / dpr, rectH / dpr);

  const { scale, x, y } = state.view;
  const cellSize = BASE_CELL * scale;
  const rect = canvasWrap.getBoundingClientRect();

  const colStart = Math.max(0, Math.floor((0 - x) / cellSize));
  const colEnd = Math.min(state.field.cols - 1, Math.ceil((rect.width - x) / cellSize));
  const rowStart = Math.max(0, Math.floor((0 - y) / cellSize));
  const rowEnd = Math.min(state.field.rows - 1, Math.ceil((rect.height - y) / cellSize));

  const showGrid = cellSize > 6;
  const gap = Math.min(2, cellSize * 0.08);

  for (let row = rowStart; row <= rowEnd; row++) {
    for (let col = colStart; col <= colEnd; col++) {
      const key = row + ',' + col;
      const plantId = state.plantMap.get(key);
      const px = x + col * cellSize;
      const py = y + row * cellSize;

      let fill = null;
      if (plantId) {
        const sc = state.scoreMap.get(plantId);
        fill = sc ? PALETTE.scores[sc.score] : PALETTE.unscored;
      }
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fillRect(px + gap, py + gap, cellSize - gap * 2, cellSize - gap * 2);
      }
      if (showGrid) {
        ctx.strokeStyle = PALETTE.gridline;
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(px) + 0.5, Math.round(py) + 0.5, cellSize, cellSize);
      }
      if (plantId && plantId === state.selectedPlantId) {
        ctx.strokeStyle = PALETTE.textPrimary;
        ctx.lineWidth = 2;
        ctx.strokeRect(px + 1, py + 1, cellSize - 2, cellSize - 2);
      }
    }
  }

  emptyGridHint.classList.toggle('hidden', state.plantMap.size > 0);
}

/* ---------- pointer interaction: pan / pinch-zoom / tap ---------- */

const pointers = new Map();
let pinchStart = null; // {dist, midX, midY, scale, x, y}
let dragLast = null;
let tapCandidate = null; // {x, y, t, pointerId}

function screenToCell(sx, sy) {
  const { scale, x, y } = state.view;
  const cellSize = BASE_CELL * scale;
  const col = Math.floor((sx - x) / cellSize);
  const row = Math.floor((sy - y) / cellSize);
  return { row, col };
}

function clampScale(s) {
  return Math.min(6, Math.max(0.03, s));
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const rect = canvas.getBoundingClientRect();
  const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  pointers.set(e.pointerId, p);

  if (pointers.size === 1) {
    dragLast = p;
    tapCandidate = { x: p.x, y: p.y, t: Date.now(), pointerId: e.pointerId };
  } else if (pointers.size === 2) {
    tapCandidate = null;
    const pts = [...pointers.values()];
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    pinchStart = { dist, mid, scale: state.view.scale, x: state.view.x, y: state.view.y };
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  const rect = canvas.getBoundingClientRect();
  const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  pointers.set(e.pointerId, p);

  if (pointers.size === 1 && dragLast) {
    const dx = p.x - dragLast.x, dy = p.y - dragLast.y;
    if (tapCandidate && Math.hypot(p.x - tapCandidate.x, p.y - tapCandidate.y) > 8) tapCandidate = null;
    state.view.x += dx;
    state.view.y += dy;
    dragLast = p;
    draw();
  } else if (pointers.size === 2 && pinchStart) {
    const pts = [...pointers.values()];
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    const newScale = clampScale(pinchStart.scale * (dist / Math.max(1, pinchStart.dist)));
    const factor = newScale / pinchStart.scale;
    state.view.scale = newScale;
    state.view.x = mid.x - (pinchStart.mid.x - pinchStart.x) * factor;
    state.view.y = mid.y - (pinchStart.mid.y - pinchStart.y) * factor;
    draw();
  }
});

function endPointer(e) {
  const wasSingle = pointers.size === 1 && pointers.has(e.pointerId);
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchStart = null;
  if (wasSingle && tapCandidate && tapCandidate.pointerId === e.pointerId) {
    if (Date.now() - tapCandidate.t < 500) {
      const { row, col } = screenToCell(tapCandidate.x, tapCandidate.y);
      handleCellTap(row, col);
    }
    tapCandidate = null;
  }
  dragLast = pointers.size === 1 ? [...pointers.values()][0] : null;
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', (e) => { if (pointers.size <= 1) endPointer(e); });

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  const factor = Math.exp(-e.deltaY * 0.001);
  const newScale = clampScale(state.view.scale * factor);
  const realFactor = newScale / state.view.scale;
  state.view.x = sx - (sx - state.view.x) * realFactor;
  state.view.y = sy - (sy - state.view.y) * realFactor;
  state.view.scale = newScale;
  draw();
}, { passive: false });

/* ---------- cell tap handling ---------- */

async function handleCellTap(row, col) {
  if (!state.field) return;
  if (row < 0 || col < 0 || row >= state.field.rows || col >= state.field.cols) return;
  const key = row + ',' + col;
  const plantId = state.plantMap.get(key);

  if (state.mode === 'plant') {
    if (plantId) {
      await removePlant(plantId, row, col);
    } else {
      await addPlant(row, col);
    }
  } else {
    if (!plantId) {
      showToast('No plant here — switch to Plant mode to add one');
      return;
    }
    openScoreSheet(plantId, row, col);
  }
}

async function addPlant(row, col) {
  const plant = { id: uid(), fieldId: state.field.id, row, col, createdAt: Date.now() };
  await idbPut('plants', plant);
  state.plantMap.set(row + ',' + col, plant.id);
  draw();
}

async function removePlant(plantId, row, col) {
  const scores = await idbGetAllByIndex('scores', 'byPlant', plantId);
  const plant = { id: plantId, fieldId: state.field.id, row, col };
  lastDeleted = { plant, scores };

  await idbDelete('plants', plantId);
  for (const s of scores) await idbDelete('scores', s.id);
  state.plantMap.delete(row + ',' + col);
  state.scoreMap.delete(plantId);
  draw();

  showToast(`Removed plant (${row}, ${col})`, 'Undo', undoRemovePlant);
}

async function undoRemovePlant() {
  if (!lastDeleted) return;
  const { plant, scores } = lastDeleted;
  await idbPut('plants', plant);
  for (const s of scores) await idbPut('scores', s);
  state.plantMap.set(plant.row + ',' + plant.col, plant.id);
  const current = scores.find((s) => s.weekId === state.weekId);
  if (current) state.scoreMap.set(plant.id, { score: current.score, note: current.note });
  lastDeleted = null;
  draw();
}

/* ---------- score sheet ---------- */

const sheetScore = $('#sheet-score');
const scoreSheetTitle = $('#score-sheet-title');
const scorePrevWeek = $('#score-prev-week');
const scoreNote = $('#score-note');
const scoreButtons = $('#score-buttons');
const btnClearScore = $('#btn-clear-score');
const btnAdvanceDir = $('#btn-advance-dir');
const advanceDirIcon = $('#advance-dir-icon');

let sheetCtx = null; // {plantId, row, col, selected}

/* auto-advance to the next plant after saving a score */
const ADVANCE_DIRS = ['right', 'down', 'left', 'up'];
const ADVANCE_DIR_ICON = { right: '→', down: '↓', left: '←', up: '↑' };
const ADVANCE_DIR_STEP = { right: [0, 1], down: [1, 0], left: [0, -1], up: [-1, 0] };
state.advanceDir = localStorage.getItem('pht-advance-dir') || 'right';

function updateAdvanceDirIcon() {
  advanceDirIcon.textContent = ADVANCE_DIR_ICON[state.advanceDir];
  btnAdvanceDir.setAttribute('aria-label', `Auto-advance direction after saving: ${state.advanceDir}`);
}
updateAdvanceDirIcon();

btnAdvanceDir.addEventListener('click', () => {
  const i = ADVANCE_DIRS.indexOf(state.advanceDir);
  state.advanceDir = ADVANCE_DIRS[(i + 1) % ADVANCE_DIRS.length];
  localStorage.setItem('pht-advance-dir', state.advanceDir);
  updateAdvanceDirIcon();
});

function findNextPlant(row, col, dir) {
  const [dr, dc] = ADVANCE_DIR_STEP[dir];
  let r = row + dr, c = col + dc;
  while (r >= 0 && c >= 0 && r < state.field.rows && c < state.field.cols) {
    const plantId = state.plantMap.get(r + ',' + c);
    if (plantId) return { plantId, row: r, col: c };
    r += dr; c += dc;
  }
  return null;
}

async function openScoreSheet(plantId, row, col) {
  const existing = state.scoreMap.get(plantId);
  sheetCtx = { plantId, row, col, selected: existing ? existing.score : null };
  state.selectedPlantId = plantId;
  draw();

  scoreSheetTitle.textContent = `Plant (${row}, ${col})`;
  scoreNote.value = existing ? (existing.note || '') : '';
  btnClearScore.classList.toggle('hidden', !existing);
  updateScoreButtonSelection();

  const prevWeekId = addWeeks(state.weekId, -1);
  const prevScoreRecord = await getScoreRecord(plantId, prevWeekId);
  if (prevScoreRecord) {
    scorePrevWeek.textContent = `Last week: ${prevScoreRecord.score}/5${prevScoreRecord.note ? ' — ' + prevScoreRecord.note : ''}`;
  } else {
    scorePrevWeek.textContent = 'No data last week';
  }

  sheetScore.classList.remove('hidden');
}

function getScoreRecord(plantId, weekId) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const req = db.transaction('scores', 'readonly').objectStore('scores').get(`${plantId}__${weekId}`);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  }));
}

function updateScoreButtonSelection() {
  scoreButtons.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('selected', Number(b.dataset.score) === sheetCtx.selected);
  });
}

scoreButtons.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-score]');
  if (!btn || !sheetCtx) return;
  sheetCtx.selected = Number(btn.dataset.score);
  updateScoreButtonSelection();
  await saveScore();
});

async function saveScore() {
  const record = {
    id: `${sheetCtx.plantId}__${state.weekId}`,
    plantId: sheetCtx.plantId,
    fieldId: state.field.id,
    weekId: state.weekId,
    score: sheetCtx.selected,
    note: scoreNote.value.trim(),
    updatedAt: Date.now(),
  };
  await idbPut('scores', record);
  state.scoreMap.set(sheetCtx.plantId, { score: record.score, note: record.note });

  const next = findNextPlant(sheetCtx.row, sheetCtx.col, state.advanceDir);
  if (next) {
    await openScoreSheet(next.plantId, next.row, next.col);
  } else {
    closeScoreSheet();
  }
}

function closeScoreSheet() {
  sheetScore.classList.add('hidden');
  state.selectedPlantId = null;
  sheetCtx = null;
  draw();
}

$('#btn-cancel-score').addEventListener('click', closeScoreSheet);

$('#btn-clear-score').addEventListener('click', async () => {
  if (!sheetCtx) return;
  await idbDelete('scores', `${sheetCtx.plantId}__${state.weekId}`);
  state.scoreMap.delete(sheetCtx.plantId);
  closeScoreSheet();
});

/* ---------- mode toggle + week nav ---------- */

$('#mode-toggle').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-mode]');
  if (!btn) return;
  state.mode = btn.dataset.mode;
  document.querySelectorAll('#mode-toggle button').forEach((b) => b.classList.toggle('active', b === btn));
});

$('#week-prev').addEventListener('click', async () => {
  state.weekId = addWeeks(state.weekId, -1);
  updateWeekLabel();
  await loadScoresForCurrentWeek();
  draw();
});
$('#week-next').addEventListener('click', async () => {
  state.weekId = addWeeks(state.weekId, 1);
  updateWeekLabel();
  await loadScoresForCurrentWeek();
  draw();
});

weekDateInput.addEventListener('change', async () => {
  if (!weekDateInput.value) return;
  const [y, m, d] = weekDateInput.value.split('-').map(Number);
  state.weekId = weekIdFor(new Date(y, m - 1, d));
  updateWeekLabel();
  await loadScoresForCurrentWeek();
  draw();
});

$('#week-label-wrap').addEventListener('click', () => {
  if (typeof weekDateInput.showPicker === 'function') {
    try { weekDateInput.showPicker(); return; } catch (e) { /* fall through */ }
  }
  weekDateInput.focus();
  weekDateInput.click();
});

/* ---------- new field modal ---------- */

const modalNewField = $('#modal-new-field');
$('#btn-new-field').addEventListener('click', () => {
  $('#field-name').value = '';
  $('#field-rows').value = '20';
  $('#field-cols').value = '20';
  modalNewField.classList.remove('hidden');
});
$('#btn-cancel-field').addEventListener('click', () => modalNewField.classList.add('hidden'));
$('#btn-create-field').addEventListener('click', async () => {
  const name = $('#field-name').value.trim() || 'Untitled field';
  const rows = Math.min(500, Math.max(1, parseInt($('#field-rows').value, 10) || 1));
  const cols = Math.min(500, Math.max(1, parseInt($('#field-cols').value, 10) || 1));
  const field = await createField(name, rows, cols);
  modalNewField.classList.add('hidden');
  await renderFieldList();
  openField(field);
});

/* ---------- back button ---------- */

$('#btn-back').addEventListener('click', async () => {
  showScreen('fields');
  await renderFieldList();
});

/* ---------- menu popover ---------- */

const menuPopover = $('#menu-popover');
$('#btn-menu').addEventListener('click', () => menuPopover.classList.remove('hidden'));
$('#menu-close').addEventListener('click', () => menuPopover.classList.add('hidden'));

$('#menu-rename-field').addEventListener('click', async () => {
  menuPopover.classList.add('hidden');
  const name = prompt('Field name', state.field.name);
  if (!name) return;
  state.field.name = name.trim();
  await idbPut('fields', state.field);
  fieldTitle.textContent = state.field.name;
});

$('#menu-delete-field').addEventListener('click', async () => {
  menuPopover.classList.add('hidden');
  if (!confirm(`Delete "${state.field.name}" and all its plants and scores? This cannot be undone.`)) return;
  const plants = await idbGetAllByIndex('plants', 'byField', state.field.id);
  for (const p of plants) {
    const scores = await idbGetAllByIndex('scores', 'byPlant', p.id);
    for (const s of scores) await idbDelete('scores', s.id);
    await idbDelete('plants', p.id);
  }
  await idbDelete('fields', state.field.id);
  showScreen('fields');
  await renderFieldList();
});

$('#menu-export-json').addEventListener('click', async () => {
  menuPopover.classList.add('hidden');
  const plants = await idbGetAllByIndex('plants', 'byField', state.field.id);
  const plantIds = new Set(plants.map((p) => p.id));
  const allScores = await idbGetAll('scores');
  const scores = allScores.filter((s) => plantIds.has(s.plantId));
  const payload = { field: state.field, plants, scores, exportedAt: new Date().toISOString() };
  downloadFile(`${slugify(state.field.name)}-export.json`, JSON.stringify(payload, null, 2), 'application/json');
});

$('#menu-export-csv').addEventListener('click', async () => {
  menuPopover.classList.add('hidden');
  const plants = await idbGetAllByIndex('plants', 'byField', state.field.id);
  const plantById = new Map(plants.map((p) => [p.id, p]));
  const allScores = await idbGetAll('scores');
  const scores = allScores.filter((s) => plantById.has(s.plantId));
  scores.sort((a, b) => a.weekId.localeCompare(b.weekId) || a.plantId.localeCompare(b.plantId));
  const rows = [['field', 'row', 'col', 'week', 'score', 'note']];
  for (const s of scores) {
    const p = plantById.get(s.plantId);
    rows.push([state.field.name, p.row, p.col, s.weekId, s.score, (s.note || '').replace(/\n/g, ' ')]);
  }
  const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
  downloadFile(`${slugify(state.field.name)}-scores.csv`, csv, 'text/csv');
});

$('#menu-import-json').addEventListener('click', () => {
  menuPopover.classList.add('hidden');
  $('#import-file').click();
});

$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!confirm('This will replace ALL fields, plants, and scores currently stored on this device. Continue?')) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    await idbClear('fields');
    await idbClear('plants');
    await idbClear('scores');
    if (data.field) await idbBulkPut('fields', [data.field]);
    if (data.fields) await idbBulkPut('fields', data.fields);
    if (data.plants) await idbBulkPut('plants', data.plants);
    if (data.scores) await idbBulkPut('scores', data.scores);
    showToast('Import complete');
    showScreen('fields');
    await renderFieldList();
  } catch (err) {
    alert('Import failed: ' + err.message);
  }
});

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function slugify(s) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'field';
}
function csvEscape(v) {
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/* close overlays by tapping backdrop */
document.querySelectorAll('.overlay').forEach((ov) => {
  ov.addEventListener('click', (e) => {
    if (e.target === ov) ov.classList.add('hidden');
    if (ov === sheetScore && e.target === ov) { state.selectedPlantId = null; sheetCtx = null; draw(); }
  });
});

/* ---------- init ---------- */

async function init() {
  loadPalette();
  resizeCanvas();
  await renderFieldList();
  showScreen('fields');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
