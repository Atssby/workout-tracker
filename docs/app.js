// ============================================================
// DATA LAYER — LocalStorage
// ============================================================

const KEYS = {
  entries: 'wt_entries',
  exercises: 'wt_exercises',
  defaultUnit: 'wt_unit',
  gymTime: 'wt_gym_time', // { date: { in, out } }
};

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}

function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// --- エントリ ---------------------------------------------------------------
// 削除は物理削除ではなく tombstone（deleted:true）で表す。
// 物理削除だと、同期時に「相手が持っていて自分が持っていない」＝「まだ受け取っていない」
// なのか「消した」なのか区別できず、削除した記録が他端末から復活してしまうため。
// getEntries() は tombstone を除いた配列を返すので、既存の呼び出し側は変更不要。
function getEntriesRaw() { return load(KEYS.entries, []); }
function getEntries() { return getEntriesRaw().filter(e => !e.deleted); }

// 引数は「表示用（tombstone を含まない）」配列。既存の tombstone は保持して書き戻す。
function saveEntries(e) {
  const keep = new Set(e.map(x => x.id));
  const tombstones = getEntriesRaw().filter(x => x.deleted && !keep.has(x.id));
  save(KEYS.entries, tombstones.length ? [...e, ...tombstones] : e);
  scheduleFsSync();
}

// tombstone を含む生の配列をそのまま書く（同期のマージ結果を書き戻す用）
function saveEntriesRaw(e) { save(KEYS.entries, e); }

function nowIso() { return new Date().toISOString(); }

// 変更時刻を打つ。マージはこの値で新旧を判定する
function stampEntry(entry) { return { ...entry, updatedAt: nowIso() }; }

// 指定IDのエントリを tombstone 化して保存
function deleteEntryById(id) {
  const raw = getEntriesRaw().map(e =>
    e.id === id ? { id: e.id, deleted: true, updatedAt: nowIso() } : e
  );
  save(KEYS.entries, raw);
  scheduleFsSync();
}

function getExercises() { return load(KEYS.exercises, []); }
function saveExercises(e) { save(KEYS.exercises, e); scheduleFsSync(); }

function getDefaultUnit() { return load(KEYS.defaultUnit, 'kg'); }
function saveDefaultUnit(u) { save(KEYS.defaultUnit, u); scheduleFsSync(); }

function getGymTimes() { return load(KEYS.gymTime, {}); }
function saveGymTimes(t) { save(KEYS.gymTime, t); scheduleFsSync(); }

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nowTime() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getMonth() + 1}/${d.getDate()}（${days[d.getDay()]}）`;
}

// ============================================================
// 単位（kg / lbs）
// ============================================================
// セットは記録時の単位のまま保存する（過去データを書き換えない）。
// 合計・最大・グラフなど「複数セットをまたぐ計算」は必ず kg に揃えてから行う。
// 揃えないと 2.5lbs(=1.1kg) と 5.0kg が同じ軸に「2.5」と「5.0」で並ぶ。

const LBS_TO_KG = 0.45359237;
const MAX_SETS = 10;   // 記録追加・編集・今日ページで共通（以前は5／5／無制限とバラバラだった）

// テンプレートリテラルで innerHTML を組む箇所に、ユーザー入力・保存値を差し込むときは必ずこれを通す。
// 属性値（value="..." など）にも使うので、引用符も実体参照にしている。
function escapeHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function toKg(weight, unit) {
  const w = parseFloat(weight);          // インポート由来は文字列なのでここで吸収する
  if (!isFinite(w)) return 0;
  return unit === 'lbs' ? w * LBS_TO_KG : w;
}

function fromKg(kg, unit) {
  return unit === 'lbs' ? kg / LBS_TO_KG : kg;
}

// 集計値の表示用フォーマット（内部kg → 表示単位）
function formatKg(kg, unit) {
  const v = fromKg(kg, unit);
  return (Math.round(v * 10) / 10).toLocaleString('ja-JP', { maximumFractionDigits: 1 });
}

// エントリ内で単位が混在しているか（混在時は画面に注意マークを出す）
function hasMixedUnits(sets) {
  return new Set((sets || []).map(s => s.unit || 'kg')).size > 1;
}

// エントリの総ボリューム・最大重量（どちらも kg）
function entryVolumeKg(sets) {
  return (sets || []).reduce((sum, s) => sum + toKg(s.weight, s.unit) * (parseInt(s.reps) || 0), 0);
}
function entryMaxKg(sets) {
  return (sets || []).reduce((mx, s) => Math.max(mx, toKg(s.weight, s.unit)), 0);
}

// ============================================================
// MUSCLE COLOR MAP
// ============================================================

/* activeBg = ドット・枠線などの装飾用（文字を乗せない）
   sel      = 選択中の背景。白文字で 4.5:1 以上になるまで暗くしてある
   onDark   = 未選択時の文字色（暗いテーマ）。tint背景に対して 4.5:1 以上
   onLight  = 未選択時の文字色（明るいテーマ）。同上
   ※ 数値は WCAG 2.2 SC 1.4.3（通常文字 4.5:1）で実測して決定 */
const MUSCLE_COLORS = {
  //                                                                           ダーク用テキスト  ライト用テキスト（濃色）
  '胸':  { activeBg: '#dc2626', border: '#dc2626', sel: '#dc2626', onDark: '#e14545', onLight: '#bf1f1f', tagBg: 'rgba(220,38,38,0.18)', tagBorder: '#dc2626', tagText: '#fca5a5', tagTextLight: '#991b1b' },
  '背中': { activeBg: '#2563eb', border: '#2563eb', sel: '#2563eb', onDark: '#467aee', onLight: '#1556e5', tagBg: 'rgba(37,99,235,0.18)',  tagBorder: '#2563eb', tagText: '#93c5fd', tagTextLight: '#1e40af' },
  '脚':  { activeBg: '#16a34a', border: '#16a34a', sel: '#12863d', onDark: '#16a34a', onLight: '#107435', tagBg: 'rgba(22,163,74,0.18)',  tagBorder: '#16a34a', tagText: '#86efac', tagTextLight: '#14532d' },
  '肩':  { activeBg: '#ca8a04', border: '#ca8a04', sel: '#9d6b03', onDark: '#ca8a04', onLight: '#8a5e03', tagBg: 'rgba(202,138,4,0.18)',  tagBorder: '#ca8a04', tagText: '#fde68a', tagTextLight: '#78350f' },
  '腕':  { activeBg: '#9333ea', border: '#9333ea', sel: '#9333ea', onDark: '#a556ee', onLight: '#8921e8', tagBg: 'rgba(147,51,234,0.18)', tagBorder: '#9333ea', tagText: '#d8b4fe', tagTextLight: '#581c87' },
  '腹':  { activeBg: '#0d9488', border: '#0d9488', sel: '#0c8479', onDark: '#0d9488', onLight: '#0a7269', tagBg: 'rgba(13,148,136,0.18)', tagBorder: '#0d9488', tagText: '#5eead4', tagTextLight: '#134e4a' },
};

// 明るいテーマかどうか（テーマ依存の色を選ぶときに使う）
function isLightTheme() {
  return document.body.classList.contains('light-mode') ||
         document.documentElement.getAttribute('data-theme') === 'light';
}

// グラフの描画色。以前はダーク前提で決め打ちしていたため、ライトモードでは
// 罫線が白背景に白（1.00:1）、軸ラベルが 1.85:1 で読めなくなっていた。
function chartPalette() {
  const light = isLightTheme();
  return {
    grid:  light ? 'rgba(15,23,42,0.16)' : 'rgba(255,255,255,0.16)',
    label: light ? '#475569'             : '#9ca3af',   // どちらも背景に対し 4.5:1 以上
    band:  light ? 'rgba(15,23,42,0.06)' : 'rgba(148,163,184,0.10)',
  };
}

// 未選択の部位ボタン／ピルの文字色
function muscleIdleText(c) {
  return isLightTheme() ? c.onLight : c.onDark;
}

function muscleTagHtml(muscle) {
  if (!muscle) return '';
  const c = MUSCLE_COLORS[muscle];
  if (c) {
    const isLight = document.body.classList.contains('light-mode');
    const textColor = isLight ? c.tagTextLight : c.tagText;
    return `<span class="inline-block text-xs font-semibold px-2 py-0.5 rounded-full ml-1" style="background:${c.tagBg};border:1px solid ${c.tagBorder};color:${textColor}">${escapeHtml(muscle)}</span>`;
  }
  return `<span class="inline-block text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-900 text-indigo-300 ml-1">${escapeHtml(muscle)}</span>`;
}

// ============================================================
// STATE
// ============================================================

let currentTab = 'today';
let currentUnit = getDefaultUnit();
let sets = [{ weight: '', reps: '' }];
let graphMode = 'weight'; // 'weight' | 'volume'
let graphChart = null;
let graphMuscleFilter = ''; // '' = すべて
let currentMuscleGroup = '';
let editingEntryId = null;
let editSets = [];
let editUnit = 'kg';
let editUnitTouched = false;
let editMuscleGroup = '';
let historyViewMode = 'list';
let calendarYear = new Date().getFullYear();
let calendarMonth = new Date().getMonth(); // 0-indexed
let calendarSelectedDate = null;
let historyMuscleFilter   = '';   // '' = すべて
let historyExerciseFilter = '';   // exercise id, '' = すべて
let todaySelectedMuscle   = '';   // 今日ページで選択中の部位

// ============================================================
// TAB NAVIGATION
// ============================================================

const tabTitles = {
  today: '今日',
  add: '記録追加',
  history: '履歴',
  graph: 'グラフ',
  help: '使い方',
};

function switchTab(tab) {
  closeNumpad();
  currentTab = tab;
  document.getElementById('page-title').textContent = tabTitles[tab];

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + tab).classList.add('active');
  document.getElementById('content').scrollTop = 0;  // ページ間でスクロール位置を持ち越さない

  document.querySelectorAll('.tab-btn').forEach(btn => {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle('text-indigo-400', active);
    btn.classList.toggle('text-gray-400', !active);
  });

  if (tab === 'today') renderToday();
  if (tab === 'history') renderHistory();
  if (tab === 'graph') renderGraphPage();
  if (tab === 'add') initAddForm();
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// ============================================================
// TODAY PAGE
// ============================================================

function renderToday() {
  const today = todayStr();
  const gymTimes = getGymTimes();
  const todayTime = gymTimes[today] || {};

  document.getElementById('display-gym-in').textContent = todayTime.in || '--:--';
  document.getElementById('display-gym-out').textContent = todayTime.out || '--:--';
  if (todayTime.in) document.getElementById('gym-in-input').value = todayTime.in;
  if (todayTime.out) document.getElementById('gym-out-input').value = todayTime.out;

  renderTodaySummary();
  renderTodayMuscleBtns();
  // 部位が選択済みなら維持（タブ切り替え後も保持）
  if (todaySelectedMuscle) renderTodaySuggestions(todaySelectedMuscle);
}

// 保存済み件数サマリーバーを更新
function renderTodaySummary() {
  const today = todayStr();
  const entries = getEntries().filter(e => e.date === today);
  const summary = document.getElementById('today-summary');
  const empty   = document.getElementById('today-empty');

  if (entries.length === 0 && !todaySelectedMuscle) {
    summary.classList.add('hidden');
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
    if (entries.length > 0) {
      summary.classList.remove('hidden');
      const muscleCounts = {};
      entries.forEach(e => {
        const m = e.muscleGroup || '未設定';
        muscleCounts[m] = (muscleCounts[m] || 0) + 1;
      });
      const parts = Object.entries(muscleCounts).map(([m, n]) => `${m} ${n}種目`).join('・');
      document.getElementById('today-summary-count').textContent = parts;
    } else {
      summary.classList.add('hidden');
    }
  }
}

// 部位ボタンの選択状態を視覚更新
function renderTodayMuscleBtns() {
  document.querySelectorAll('.today-muscle-btn').forEach(btn => {
    const m = btn.dataset.todayMuscle;
    const c = MUSCLE_COLORS[m];
    if (m === todaySelectedMuscle) {
      btn.style.cssText = `background-color:${c.sel};border-color:${c.sel};color:#fff;`;
    } else {
      btn.style.cssText = `background-color:${c.activeBg}22;border-color:${c.border};color:${muscleIdleText(c)};`;
    }
  });
}

// 部位の種目提案カードを描画
function renderTodaySuggestions(muscleGroup) {
  closeNumpad();
  const container = document.getElementById('today-suggestion-cards');
  container.innerHTML = '';
  if (!muscleGroup) return;

  const suggestions = getSuggestionsForMuscle(muscleGroup);
  if (suggestions.length === 0) {
    container.innerHTML = `<div class="text-center py-8 text-gray-400 text-sm">この部位の記録がまだありません</div>`;
    return;
  }

  suggestions.forEach(entry => {
    // 今日すでにこの種目を保存済みか。あれば「その保存済みエントリ」をカードの中身にする
    const saved = todayEntryFor(entry.exerciseName);
    const src   = saved || entry;
    const unit  = src.sets[0]?.unit || 'kg';

    const card = document.createElement('div');
    card.className = 'bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden';
    card.dataset.exerciseId   = entry.exerciseId || '';
    card.dataset.exerciseName = entry.exerciseName;
    card.dataset.unit         = unit;
    if (saved) card.dataset.savedEntryId = saved.id;

    const setsHtml = src.sets.map((s, i) => buildSetRowHtml(i, s.weight, s.unit || unit, s.reps)).join('');

    card.innerHTML = `
      <div class="flex items-center justify-between px-4 pt-4 pb-3">
        <span class="exercise-name font-bold text-white text-base"></span>
        <button class="save-card-btn px-6 py-3 bg-indigo-600 text-white text-base font-bold rounded-xl transition-colors active:bg-indigo-700">保存</button>
      </div>
      <div class="sets-list px-4 pb-2 space-y-1">${setsHtml}</div>
      <div class="px-4 pb-3 flex items-center gap-4">
        <button class="add-set-btn text-sm text-indigo-400 font-semibold px-3 -ml-3 rounded-lg" style="min-height:44px">＋ セット追加</button>
        <button class="edit-saved-btn hidden text-sm text-indigo-400 font-semibold px-3 -ml-3 rounded-lg" style="min-height:44px">編集</button>
      </div>`;
    // 種目名はユーザー入力なので innerHTML に混ぜず textContent で入れる
    card.querySelector('.exercise-name').textContent = entry.exerciseName;

    container.appendChild(card);

    card.querySelector('.save-card-btn').addEventListener('click', () => saveTodayCard(card, muscleGroup));
    card.querySelector('.add-set-btn').addEventListener('click', () => addSetToTodayCard(card));
    card.querySelector('.edit-saved-btn').addEventListener('click', () => {
      if (card.dataset.savedEntryId) openEditModal(card.dataset.savedEntryId);
    });
    card.querySelectorAll('.remove-set-btn').forEach(btn =>
      btn.addEventListener('click', () => removeTodaySetRow(card, btn.closest('.set-row')))
    );

    // 保存済みなら、再描画後も「保存済み」の見た目を復元する。
    // 以前はこの状態がDOMにしか無かったため、再描画のたびに未保存カードが復活し、
    // もう一度押すと同じ内容が2件目として記録されていた。
    if (saved) markTodayCardSaved(card);
  });
}

// 今日・同じ種目名のエントリを返す（種目名は大文字小文字と前後空白を無視して突き合わせる）
function todayEntryFor(exerciseName) {
  const key = (exerciseName || '').trim().toLowerCase();
  if (!key) return null;
  const today = todayStr();
  return getEntries().find(e =>
    e.date === today && (e.exerciseName || '').trim().toLowerCase() === key
  ) || null;
}

function markTodayCardSaved(card) {
  const saveBtn = card.querySelector('.save-card-btn');
  saveBtn.textContent = '✓ 保存済み';
  saveBtn.classList.remove('bg-indigo-600', 'active:bg-indigo-700');
  saveBtn.classList.add('bg-green-700');
  saveBtn.disabled = true;
  card.querySelectorAll('input').forEach(inp => inp.disabled = true);
  card.querySelectorAll('.remove-set-btn, .add-set-btn').forEach(b => b.classList.add('hidden'));
  card.querySelector('.edit-saved-btn').classList.remove('hidden');
  card.classList.add('opacity-60');
}

function buildSetRowHtml(idx, weight, unit, reps) {
  // weight / unit / reps は保存値（インポート由来なら第三者由来でもありうる）。属性に入るので必ずエスケープする
  const w = escapeHtml(weight), u = escapeHtml(unit), r = escapeHtml(reps);
  return `
    <div class="set-row flex items-center gap-2 py-1.5" data-idx="${idx}">
      <span class="set-label text-xs text-gray-400 w-12 flex-shrink-0">セット${idx + 1}</span>
      <input type="text" readonly inputmode="none" value="${w}"
        data-numpad="decimal" data-numpad-label="重量（${u}）"
        class="set-weight num-input w-20 bg-gray-800 border border-gray-700 rounded-xl px-2 py-3 text-white text-center focus:outline-none">
      <span class="text-xs text-gray-400">${u} ×</span>
      <input type="text" readonly inputmode="none" value="${r}"
        data-numpad="numeric" data-numpad-label="回数"
        class="set-reps num-input w-16 bg-gray-800 border border-gray-700 rounded-xl px-2 py-3 text-white text-center focus:outline-none">
      <span class="text-xs text-gray-400">回</span>
      <button class="remove-set-btn text-gray-400 hover:text-red-400 text-2xl leading-none ml-auto rounded-lg" style="width:44px;height:44px;flex-shrink:0;line-height:44px;text-align:center;padding:0" aria-label="セット${idx + 1}を削除">×</button>
    </div>`;
}

function addSetToTodayCard(card) {
  const list = card.querySelector('.sets-list');
  const rows = list.querySelectorAll('.set-row');
  if (rows.length >= MAX_SETS) { showToast(`セットは${MAX_SETS}件までです`); return; }
  const lastRow = rows[rows.length - 1];
  const lastWeight = lastRow ? lastRow.querySelector('.set-weight').value : '';
  const lastReps   = lastRow ? lastRow.querySelector('.set-reps').value : '';
  const unit = card.dataset.unit || 'kg';
  const idx  = rows.length;

  const tmp = document.createElement('div');
  tmp.innerHTML = buildSetRowHtml(idx, lastWeight, unit, lastReps);
  const newRow = tmp.firstElementChild;
  newRow.querySelector('.remove-set-btn').addEventListener('click', () => removeTodaySetRow(card, newRow));
  list.appendChild(newRow);
}

// セット行の削除。取り消せるようにしてから消す（汗で手が滑る前提のジムで、
// 取り消せない破壊的操作をいちばん小さいボタンに置かないため）
function removeTodaySetRow(card, row) {
  closeNumpad();
  const list = row.parentElement;
  const next = row.nextElementSibling;
  row.remove();
  renumberTodaySets(card);
  showToast('セットを削除しました', 5000, { label: '元に戻す', fn: () => {
    if (next && next.parentElement === list) list.insertBefore(row, next);
    else list.appendChild(row);
    renumberTodaySets(card);
  }});
}

function renumberTodaySets(card) {
  card.querySelectorAll('.set-row').forEach((row, i) => {
    row.dataset.idx = i;
    row.querySelector('.set-label').textContent = `セット${i + 1}`;
  });
}

function saveTodayCard(card, muscleGroup) {
  const exerciseName = card.dataset.exerciseName;
  const exerciseId   = card.dataset.exerciseId;
  const unit         = card.dataset.unit || 'kg';

  const sets = [];
  card.querySelectorAll('.set-row').forEach(row => {
    const w = parseFloat(row.querySelector('.set-weight').value);
    const r = parseInt(row.querySelector('.set-reps').value);
    if (!isNaN(w) && !isNaN(r) && w > 0 && r > 0) sets.push({ weight: w, unit, reps: r });
  });
  if (sets.length === 0) { showToast('セットを入力してください'); return; }

  const today = todayStr();
  const gymTimes = getGymTimes();
  const todayTime = gymTimes[today] || {};

  // 種目マスタを確認・更新
  const exercises = getExercises();
  let ex = exercises.find(e => e.id === exerciseId) || exercises.find(e => e.name === exerciseName);
  if (!ex) {
    ex = { id: genId(), name: exerciseName, muscleGroups: [muscleGroup] };
    exercises.push(ex);
    saveExercises(exercises);
  }

  // 今日すでに同じ種目があれば新規追加せず更新する（二重記録の防止）
  const existing = todayEntryFor(exerciseName);
  const entries = getEntries();

  if (existing) {
    const updated = entries.map(e =>
      e.id === existing.id
        ? stampEntry({ ...e, exerciseId: ex.id, muscleGroup, sets,
                       gymIn: todayTime.in || e.gymIn || '', gymOut: todayTime.out || e.gymOut || '' })
        : e
    );
    saveEntries(updated);
    card.dataset.savedEntryId = existing.id;
    showToast(`${exerciseName} を更新しました`);
  } else {
    const entry = stampEntry({
      id: genId(),
      date: today,
      exerciseId: ex.id,
      exerciseName,
      muscleGroup,
      sets,
      memo: '',
      gymIn: todayTime.in || '',
      gymOut: todayTime.out || '',
      createdAt: nowIso(),
    });
    entries.push(entry);
    saveEntries(entries);
    card.dataset.savedEntryId = entry.id;
    showToast(`${exerciseName} を保存しました`);
    announcePRs(entry);          // 自己ベスト更新なら通知
  }

  markTodayCardSaved(card);
  renderTodaySummary();
  startRestTimer();              // セット完了に相当するタイミングで休憩を開始
}

document.getElementById('today-summary-btn').addEventListener('click', () => switchTab('history'));

// 部位ボタン クリック
document.querySelectorAll('.today-muscle-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const m = btn.dataset.todayMuscle;
    todaySelectedMuscle = todaySelectedMuscle === m ? '' : m; // 同じボタンで解除
    renderTodayMuscleBtns();
    renderTodaySuggestions(todaySelectedMuscle);
    renderTodaySummary();
  });
});

// 「部位なしで追加」→ Add タブへ
document.getElementById('today-add-btn').addEventListener('click', () => {
  initAddForm();
  switchTab('add');
});

// 部位を選択した状態でAddページへ遷移（記録追加タブから使用）
function switchToAddWithMuscle(muscleGroup) {
  initAddForm();
  if (muscleGroup) {
    currentMuscleGroup = muscleGroup;
    updateMuscleBtns('.muscle-btn', muscleGroup);
    renderSuggestions(muscleGroup);
  }
  switchTab('add');
}

function buildEntryCard(entry, showActions, onDelete) {
  const card = document.createElement('div');
  card.className = 'bg-gray-900 rounded-2xl p-4 border border-gray-800';

  // 集計は必ず kg に揃えてから行い、表示は既定単位で出す。
  // 以前は単位を無視して合算し、先頭セットの単位をラベルに貼っていたため、
  // lbs と kg が混ざったエントリで誤った数値・誤った単位が表示されていた。
  const dispUnit = getDefaultUnit();
  const totalVolKg = entryVolumeKg(entry.sets);
  const maxKg      = entryMaxKg(entry.sets);
  const mixed      = hasMixedUnits(entry.sets);

  const setsHtml = entry.sets.map((s, i) =>
    `<div class="flex items-center gap-3 py-1">
      <span class="text-xs text-gray-400 w-12">セット${i + 1}</span>
      <span class="text-sm font-semibold text-white">${escapeHtml(s.weight)}${escapeHtml(s.unit || 'kg')}</span>
      <span class="text-xs text-gray-400">×</span>
      <span class="text-sm font-semibold text-white">${escapeHtml(s.reps)}回</span>
    </div>`
  ).join('');

  card.innerHTML = `
    <div class="flex items-start justify-between mb-3">
      <div class="flex-1 min-w-0">
        <div class="flex items-center flex-wrap gap-1">
          <span class="exercise-name text-base font-bold text-white"></span>${muscleTagHtml(entry.muscleGroup)}
        </div>
        <div class="text-xs text-gray-400 mt-0.5">${entry.sets.length}セット${mixed ? ' ・<span class="text-yellow-500">単位混在</span>' : ''}</div>
      </div>
      <div class="text-right ml-3">
        <div class="text-xs text-gray-400">最大</div>
        <div class="text-sm font-bold text-indigo-400">${formatKg(maxKg, dispUnit)}${dispUnit}</div>
      </div>
    </div>
    <div class="border-t border-gray-800 pt-2">${setsHtml}</div>
    <div class="flex items-center justify-between mt-2 pt-2 border-t border-gray-800">
      <span class="text-xs text-gray-400">総ボリューム: <span class="text-gray-400 font-semibold">${formatKg(totalVolKg, dispUnit)}${dispUnit}</span></span>
      ${showActions ? `
        <div class="flex items-center gap-3">
          <button class="text-sm text-indigo-400 font-semibold edit-entry-btn px-3 py-3 rounded-lg">編集</button>
          <button class="text-sm text-red-500 font-semibold delete-entry-btn px-3 py-3 -mr-2 rounded-lg">削除</button>
        </div>` : ''}
    </div>
    ${entry.memo ? '<div class="entry-memo mt-2 pt-2 border-t border-gray-800 text-xs text-gray-400 leading-relaxed whitespace-pre-wrap"></div>' : ''}
  `;
  // 種目名・メモはユーザー入力。innerHTML に混ぜず textContent で入れる
  card.querySelector('.exercise-name').textContent = entry.exerciseName || '';
  if (entry.memo) card.querySelector('.entry-memo').textContent = entry.memo;

  if (showActions) {
    card.querySelector('.edit-entry-btn').addEventListener('click', () => {
      openEditModal(entry.id);
    });
    card.querySelector('.delete-entry-btn').addEventListener('click', () => {
      if (confirm(`「${entry.exerciseName}」の記録を削除しますか？`)) {
        // 物理削除ではなく tombstone 化する。物理削除だと他端末から復活しうる
        deleteEntryById(entry.id);
        offerUndoDelete(entry);
        if (onDelete) onDelete(); else renderToday();
      }
    });
  }

  return card;
}

// Gym time edit
document.getElementById('edit-gym-time-btn').addEventListener('click', () => {
  const form = document.getElementById('gym-time-form');
  form.classList.toggle('hidden');
});

document.getElementById('save-gym-time-btn').addEventListener('click', () => {
  const inVal = document.getElementById('gym-in-input').value;
  const outVal = document.getElementById('gym-out-input').value;
  const today = todayStr();
  const gymTimes = getGymTimes();
  gymTimes[today] = { in: inVal, out: outVal };
  saveGymTimes(gymTimes);
  document.getElementById('gym-time-form').classList.add('hidden');
  renderToday();
});

// ============================================================
// ADD ENTRY PAGE
// ============================================================

function initAddForm() {
  const today = todayStr();
  document.getElementById('add-date').value = today;

  const gymTimes = getGymTimes();
  const todayTime = gymTimes[today] || {};
  document.getElementById('add-gym-in').value = todayTime.in || '';
  document.getElementById('add-gym-out').value = todayTime.out || '';

  // Reset sets
  sets = [{ weight: '', reps: '' }];
  renderSets();
  updateUnitButtons();

  // Reset add-set button state
  const addSetBtn = document.getElementById('add-set-btn');
  addSetBtn.classList.remove('opacity-40', 'pointer-events-none');

  // Clear exercise input
  document.getElementById('exercise-input').value = '';
  document.getElementById('exercise-dropdown').classList.add('hidden');

  // Reset muscle group
  currentMuscleGroup = '';
  updateMuscleBtns('.muscle-btn', '');

  // Reset suggestions panel
  document.getElementById('suggestions-panel').classList.add('hidden');

  // Reset memo
  document.getElementById('add-memo').value = '';
}

function updateMuscleBtns(selector, selected) {
  document.querySelectorAll(selector).forEach(btn => {
    const active = btn.dataset.muscle === selected;
    const base = 'py-4 rounded-2xl text-base font-bold border transition-colors';
    const cls = btn.classList.contains('edit-muscle-btn') ? 'edit-muscle-btn' : 'muscle-btn';
    btn.className = `${cls} ${base}`;
    const c = MUSCLE_COLORS[btn.dataset.muscle];
    if (active && c) {
      btn.style.backgroundColor = c.sel;
      btn.style.borderColor     = c.sel;
      btn.style.color           = '#ffffff';
    } else {
      btn.style.backgroundColor = '';
      btn.style.borderColor     = '';
      btn.style.color           = '';
      btn.classList.add('bg-gray-900', 'border-gray-800', 'text-gray-400');
    }
  });
}

// Muscle group button handlers (add form)
document.querySelectorAll('.muscle-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentMuscleGroup = currentMuscleGroup === btn.dataset.muscle ? '' : btn.dataset.muscle;
    updateMuscleBtns('.muscle-btn', currentMuscleGroup);
    showExerciseDropdown(exerciseInput.value);
    renderSuggestions(currentMuscleGroup);
  });
});

// ============================================================
// 前回メニュー提案（過去5セッションの種目を自動サジェスト）
// ============================================================

let suggestionsVisible = true; // 非表示トグル状態

// 部位の直近5セッションに登場した種目 × 最新の負荷・回数を返す
function getSuggestionsForMuscle(muscleGroup) {
  if (!muscleGroup) return [];
  const allEntries = getEntries().filter(e => e.muscleGroup === muscleGroup);
  if (allEntries.length === 0) return [];

  // 直近5セッション（ユニークな日付）を取得
  const sortedDates = [...new Set(allEntries.map(e => e.date))].sort().reverse();
  const last5Dates = new Set(sortedDates.slice(0, 5));

  // 直近5セッション内のエントリのみ抽出
  const recentEntries = allEntries.filter(e => last5Dates.has(e.date));

  // 種目ごとに「最新エントリ」だけ残す（IDが異なっても同名なら同一種目として扱う）
  const latestByExercise = {};
  recentEntries.forEach(entry => {
    const key = (entry.exerciseName || '').trim().toLowerCase();
    if (!latestByExercise[key] || entry.date > latestByExercise[key].date) {
      latestByExercise[key] = entry;
    }
  });

  // 直近日から登場した順に並べる（最近やったセッションの種目を先頭に）
  return Object.values(latestByExercise).sort((a, b) => {
    if (b.date !== a.date) return b.date.localeCompare(a.date);
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });
}

// セット内容を1行テキストに変換（例: 60kg×10 / 55kg×10 / 50kg×10）
function formatSetsCompact(sets) {
  if (!sets || sets.length === 0) return '記録なし';
  // 全セット同じ重量・回数なら "60kg × 10回 × 3セット" と表示
  const allSame = sets.every(s => s.weight === sets[0].weight && s.reps === sets[0].reps);
  if (allSame && sets.length > 1) {
    return `${sets[0].weight}${sets[0].unit} × ${sets[0].reps}回 × ${sets.length}セット`;
  }
  return sets.map(s => `${s.weight}${s.unit}×${s.reps}回`).join(' / ');
}

// 提案パネルを描画
function renderSuggestions(muscleGroup) {
  const panel = document.getElementById('suggestions-panel');
  const list  = document.getElementById('suggestions-list');
  const label = document.getElementById('suggestions-label');

  if (!muscleGroup) { panel.classList.add('hidden'); return; }

  const suggestions = getSuggestionsForMuscle(muscleGroup);
  if (suggestions.length === 0) { panel.classList.add('hidden'); return; }

  // パネルのヘッダー色を部位色に合わせる
  const mc = MUSCLE_COLORS[muscleGroup];
  if (mc) label.style.color = muscleIdleText(mc);
  else label.style.color = '';

  list.innerHTML = '';
  list.classList.toggle('hidden', !suggestionsVisible);

  suggestions.forEach(entry => {
    const [, m, d] = entry.date.split('-');
    const dateStr  = `${parseInt(m)}/${parseInt(d)}`;
    const setsStr  = formatSetsCompact(entry.sets);

    const card = document.createElement('button');
    card.type  = 'button';
    card.dataset.entryId = entry.id;
    card.className = 'suggestion-card w-full text-left bg-gray-900 border border-gray-800 rounded-2xl px-3 py-2.5 hover:border-indigo-500 active:bg-gray-800 transition-colors';

    card.innerHTML = `
      <div class="flex items-center justify-between gap-2">
        <span class="font-semibold text-sm text-white leading-tight">${escapeHtml(entry.exerciseName)}</span>
        <span class="text-xs text-gray-400 flex-shrink-0">${dateStr}</span>
      </div>
      <div class="text-xs text-gray-400 mt-0.5 leading-relaxed">${escapeHtml(setsStr)}</div>
    `;

    card.addEventListener('click', () => applySuggestion(entry, card));
    list.appendChild(card);
  });

  panel.classList.remove('hidden');
}

// 提案カードをタップ → 種目・セット・単位をフォームに流し込む
function applySuggestion(entry, cardEl) {
  // 他のカードのハイライトを外して、このカードをハイライト
  document.querySelectorAll('.suggestion-card').forEach(c =>
    c.classList.remove('border-indigo-500', 'bg-indigo-900/20')
  );
  cardEl.classList.add('border-indigo-500', 'bg-indigo-900/20');

  // 種目名を入力
  exerciseInput.value = entry.exerciseName;
  document.getElementById('exercise-dropdown').classList.add('hidden');

  // 単位を合わせる（最初のセットの単位を採用）。
  // ここで saveDefaultUnit() を呼ぶと、カードをタップしただけでアプリ全体の既定単位が
  // 書き換わり（かつ Firestore への全ドキュメント push まで走り）、kg/lbs 混在の原因になっていた。
  // このフォームの入力単位を合わせるだけに留め、既定単位は kg/lbs ボタンでのみ変更する。
  if (entry.sets && entry.sets.length > 0) {
    const unit = entry.sets[0].unit || currentUnit;
    if (unit !== currentUnit) {
      currentUnit = unit;
      document.getElementById('unit-kg').className  = currentUnit === 'kg'
        ? 'flex-1 py-3 rounded-2xl text-sm font-semibold border transition-colors bg-indigo-600 border-indigo-600 text-white'
        : 'flex-1 py-3 rounded-2xl text-sm font-semibold border transition-colors bg-gray-900 border-gray-800 text-gray-400';
      document.getElementById('unit-lbs').className = currentUnit === 'lbs'
        ? 'flex-1 py-3 rounded-2xl text-sm font-semibold border transition-colors bg-indigo-600 border-indigo-600 text-white'
        : 'flex-1 py-3 rounded-2xl text-sm font-semibold border transition-colors bg-gray-900 border-gray-800 text-gray-400';
    }
  }

  // セットを流し込む（重量・回数のみ、単位はグローバルcurrentUnitで管理）
  sets = (entry.sets || []).map(s => ({ weight: String(s.weight), reps: String(s.reps) }));
  if (sets.length === 0) sets = [{ weight: '', reps: '' }];
  renderSets();

  // メモは前回の内容を引き継がない（ユーザーが書きやすいよう空に）
}

// 非表示トグル
document.getElementById('suggestions-toggle').addEventListener('click', () => {
  suggestionsVisible = !suggestionsVisible;
  document.getElementById('suggestions-list').classList.toggle('hidden', !suggestionsVisible);
  document.getElementById('suggestions-toggle').textContent = suggestionsVisible ? '非表示' : '表示';
});

function renderSets() {
  closeNumpad();
  const container = document.getElementById('sets-container');
  container.innerHTML = '';
  sets.forEach((set, i) => {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-2';
    row.innerHTML = `
      <span class="text-xs text-gray-400 w-14 flex-shrink-0">セット${i + 1}</span>
      <div class="flex-1 relative">
        <input
          type="text"
          readonly
          inputmode="none"
          placeholder="重量"
          value="${set.weight}"
          data-set="${i}"
          data-field="weight"
          data-numpad="decimal"
          data-numpad-label="重量（${currentUnit}）"
          class="set-weight num-input w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-3.5 text-white text-right pr-10 focus:outline-none"
        />
        <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">${currentUnit}</span>
      </div>
      <span class="text-gray-400">×</span>
      <div class="flex-1 relative">
        <input
          type="text"
          readonly
          inputmode="none"
          placeholder="回数"
          value="${set.reps}"
          data-set="${i}"
          data-field="reps"
          data-numpad="numeric"
          data-numpad-label="回数"
          class="set-reps num-input w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-3.5 text-white text-right pr-8 focus:outline-none"
        />
        <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">回</span>
      </div>
      ${sets.length > 1 ? `<button class="remove-set-btn flex-shrink-0 text-gray-400 hover:text-red-400 text-2xl leading-none transition-colors rounded-lg" style="width:44px;height:44px;flex-shrink:0;line-height:44px;text-align:center;padding:0" data-set="${i}" aria-label="セット${i + 1}を削除">×</button>` : '<div class="w-5 flex-shrink-0"></div>'}
    `;
    container.appendChild(row);
  });

  container.querySelectorAll('input[data-field]').forEach(inp => {
    inp.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.set);
      const field = e.target.dataset.field;
      sets[idx][field] = e.target.value;
    });
  });

  container.querySelectorAll('.remove-set-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      closeNumpad();
      const idx = parseInt(btn.dataset.set);
      const removed = sets[idx];
      sets.splice(idx, 1);
      renderSets();
      showToast('セットを削除しました', 5000, { label: '元に戻す', fn: () => {
        sets.splice(idx, 0, removed);
        renderSets();
      }});
    });
  });
}

document.getElementById('add-set-btn').addEventListener('click', () => {
  if (sets.length >= MAX_SETS) return;
  sets.push({ weight: '', reps: '' });
  renderSets();
  if (sets.length >= MAX_SETS) {
    document.getElementById('add-set-btn').classList.add('opacity-40', 'pointer-events-none');
  }
});

function updateUnitButtons() {
  document.getElementById('unit-kg').className = `flex-1 py-3 rounded-2xl text-sm font-semibold border transition-colors ${currentUnit === 'kg' ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-gray-900 border-gray-800 text-gray-400'}`;
  document.getElementById('unit-lbs').className = `flex-1 py-3 rounded-2xl text-sm font-semibold border transition-colors ${currentUnit === 'lbs' ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-gray-900 border-gray-800 text-gray-400'}`;
  renderSets();
}

document.getElementById('unit-kg').addEventListener('click', () => {
  currentUnit = 'kg';
  saveDefaultUnit('kg');
  updateUnitButtons();
});
document.getElementById('unit-lbs').addEventListener('click', () => {
  currentUnit = 'lbs';
  saveDefaultUnit('lbs');
  updateUnitButtons();
});

// Exercise ComboBox
const exerciseInput = document.getElementById('exercise-input');
const exerciseDropdown = document.getElementById('exercise-dropdown');

exerciseInput.addEventListener('focus', () => showExerciseDropdown(''));
exerciseInput.addEventListener('input', (e) => showExerciseDropdown(e.target.value));

document.addEventListener('click', (e) => {
  if (!exerciseInput.contains(e.target) && !exerciseDropdown.contains(e.target)) {
    exerciseDropdown.classList.add('hidden');
  }
});

function showExerciseDropdown(query) {
  const exercises = getExercises();
  const q = query.toLowerCase().trim();

  // When muscle group is selected and no text typed: show only that muscle's exercises
  // When text typed: search across all exercises but mark muscle matches first
  let muscleMatches = [];
  let otherMatches = [];

  exercises.forEach(ex => {
    const nameMatch = ex.name.toLowerCase().includes(q);
    if (!nameMatch) return;
    const hasMuscle = currentMuscleGroup && (ex.muscleGroups || []).includes(currentMuscleGroup);
    if (hasMuscle) muscleMatches.push(ex);
    else otherMatches.push(ex); // 部位未紐付けの種目も常に「その他」に表示
  });

  exerciseDropdown.innerHTML = '';

  // "Add new" option when typing something not yet registered
  if (q && !exercises.some(ex => ex.name.toLowerCase() === q)) {
    const addNew = document.createElement('div');
    addNew.className = 'px-4 py-3 text-sm text-indigo-400 font-semibold border-b border-gray-700 cursor-pointer hover:bg-gray-700 flex items-center gap-2';
    addNew.innerHTML = `<span class="text-indigo-500">+</span> 「${escapeHtml(query)}」を追加`;
    addNew.addEventListener('click', () => {
      exerciseInput.value = query;
      exerciseDropdown.classList.add('hidden');
    });
    exerciseDropdown.appendChild(addNew);
  }

  // Section header when muscle filter is active
  if (currentMuscleGroup && muscleMatches.length > 0) {
    const label = document.createElement('div');
    label.className = 'px-4 pt-2 pb-1 text-xs font-bold text-gray-400 uppercase tracking-wider';
    label.textContent = `${currentMuscleGroup}のトレーニング`;
    exerciseDropdown.appendChild(label);
  }

  const renderItem = (ex) => {
    const item = document.createElement('div');
    item.className = 'px-4 py-3 text-sm text-white cursor-pointer hover:bg-gray-700 transition-colors';
    item.textContent = ex.name;
    item.addEventListener('click', () => {
      exerciseInput.value = ex.name;
      exerciseDropdown.classList.add('hidden');
    });
    exerciseDropdown.appendChild(item);
  };

  muscleMatches.forEach(renderItem);

  // Divider between muscle matches and others (only when mixing)
  if (currentMuscleGroup && muscleMatches.length > 0 && otherMatches.length > 0) {
    const div = document.createElement('div');
    div.className = 'px-4 pt-2 pb-1 text-xs font-bold text-gray-400 uppercase tracking-wider border-t border-gray-700 mt-1';
    div.textContent = 'その他';
    exerciseDropdown.appendChild(div);
  }
  otherMatches.forEach(renderItem);

  const hasItems = muscleMatches.length > 0 || otherMatches.length > 0;
  const hasAddNew = q && !exercises.some(ex => ex.name.toLowerCase() === q);
  if (hasItems || hasAddNew) {
    exerciseDropdown.classList.remove('hidden');
  } else {
    exerciseDropdown.classList.add('hidden');
  }
}

// Save entry
document.getElementById('save-entry-btn').addEventListener('click', () => {
  const date = document.getElementById('add-date').value;
  const gymIn = document.getElementById('add-gym-in').value;
  const gymOut = document.getElementById('add-gym-out').value;
  const exerciseName = exerciseInput.value.trim();

  if (!date) { alert('日付を入力してください'); return; }
  if (!exerciseName) { alert('種目を入力してください'); return; }

  const validSets = sets.filter(s => s.weight !== '' && s.reps !== '').map(s => ({
    weight: parseFloat(s.weight) || 0,
    unit: currentUnit,
    reps: parseInt(s.reps) || 0,
  })).filter(s => s.weight > 0 && s.reps > 0);

  if (validSets.length === 0) { alert('有効なセットを1つ以上入力してください'); return; }

  // Save exercise if new, or update muscle group association
  let exercises = getExercises();
  const existing = exercises.find(ex => ex.name.toLowerCase() === exerciseName.toLowerCase());
  if (!existing) {
    const newEx = { id: genId(), name: exerciseName, muscleGroups: currentMuscleGroup ? [currentMuscleGroup] : [] };
    exercises.push(newEx);
    saveExercises(exercises);
  } else if (currentMuscleGroup && !(existing.muscleGroups || []).includes(currentMuscleGroup)) {
    // Associate this muscle group with the existing exercise
    exercises = exercises.map(ex =>
      ex.id === existing.id
        ? { ...ex, muscleGroups: [...(ex.muscleGroups || []), currentMuscleGroup] }
        : ex
    );
    saveExercises(exercises);
  }

  // Save gym time for the date
  if (gymIn || gymOut) {
    const gymTimes = getGymTimes();
    gymTimes[date] = { in: gymIn, out: gymOut };
    saveGymTimes(gymTimes);
  }

  // Find existing exercise id
  const allExercises = getExercises();
  const matchExercise = allExercises.find(ex => ex.name.toLowerCase() === exerciseName.toLowerCase());

  const memo = document.getElementById('add-memo').value.trim();

  const entry = stampEntry({
    id: genId(),
    date,
    gymIn,
    gymOut,
    exerciseId: matchExercise?.id || genId(),
    exerciseName: matchExercise?.name || exerciseName,
    muscleGroup: currentMuscleGroup,
    sets: validSets,
    memo,
    createdAt: nowIso(),
  });

  const entries = getEntries();
  entries.push(entry);
  saveEntries(entries);
  announcePRs(entry);

  // Reset form
  sets = [{ weight: '', reps: '' }];
  exerciseInput.value = '';
  document.getElementById('add-memo').value = '';
  renderSets();

  // Show success and switch to today if date is today
  showToast('保存しました！');

  if (date === todayStr()) {
    setTimeout(() => switchTab('today'), 800);
  }
});

// action = { label, fn } を渡すと「元に戻す」等のボタンを出す。
// ボタンは 44px 以上（WCAG 2.2 SC 2.5.5 / Material 48dp）。
function showToast(msg, ms, action) {
  const toast = document.createElement('div');
  toast.className = 'fixed top-16 left-1/2 -translate-x-1/2 bg-indigo-600 text-white text-sm font-semibold rounded-full shadow-lg z-50 transition-opacity max-w-xs';
  toast.style.cssText += ';display:flex;align-items:center;gap:8px;padding:' + (action ? '4px 4px 4px 20px' : '10px 20px');
  const label = document.createElement('span');
  label.textContent = msg;
  toast.appendChild(label);
  let timer;
  const close = () => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); };
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = action.label;
    btn.className = 'font-bold rounded-full';
    btn.style.cssText = 'min-width:44px;min-height:44px;padding:0 14px;flex-shrink:0;background:rgba(255,255,255,.22);color:#fff';
    btn.addEventListener('click', () => { clearTimeout(timer); close(); action.fn(); });
    toast.appendChild(btn);
  }
  document.body.appendChild(toast);
  timer = setTimeout(close, ms || 2000);
}

// ============================================================
// HISTORY PAGE
// ============================================================

function renderHistory() {
  // Update toggle button styles
  document.getElementById('history-list-btn').className =
    `history-view-btn px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${historyViewMode === 'list' ? 'bg-indigo-600 text-white' : 'text-gray-400'}`;
  document.getElementById('history-cal-btn').className =
    `history-view-btn px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${historyViewMode === 'calendar' ? 'bg-indigo-600 text-white' : 'text-gray-400'}`;

  renderHistoryFilters();

  if (historyViewMode === 'calendar') {
    renderCalendarView();
  } else {
    renderHistoryList();
  }
}

// フィルタUI描画 + 種目セレクト更新
function renderHistoryFilters() {
  // --- 部位ピル ---
  const pillContainer = document.getElementById('history-muscle-pills');
  pillContainer.innerHTML = '';
  const muscles = ['', '胸', '背中', '脚', '肩', '腕', '腹'];
  muscles.forEach(m => {
    const btn = document.createElement('button');
    btn.className = 'flex-shrink-0 px-5 py-2.5 rounded-full text-base font-semibold border transition-colors';
    btn.dataset.muscle = m;
    btn.textContent = m || 'すべて';
    const isActive = historyMuscleFilter === m;
    if (isActive) {
      const c = MUSCLE_COLORS[m];
      btn.style.backgroundColor = c ? c.sel : '#4f46e5';
      btn.style.borderColor     = c ? c.sel : '#4f46e5';
      btn.style.color           = '#ffffff';
    } else {
      btn.classList.add('bg-gray-900', 'border-gray-800', 'text-gray-400');
    }
    btn.addEventListener('click', () => {
      historyMuscleFilter   = m;
      historyExerciseFilter = '';   // 部位が変わったら種目フィルタをリセット
      renderHistory();
    });
    pillContainer.appendChild(btn);
  });

  // --- 種目セレクト ---
  updateHistoryExerciseFilter();
}

function updateHistoryExerciseFilter() {
  const wrap = document.getElementById('history-exercise-wrap');
  const sel  = document.getElementById('history-exercise-select-filter');

  // フィルタ後のエントリから出現する種目を収集
  const allEntries = getEntries();
  const filtered   = historyMuscleFilter
    ? allEntries.filter(e => e.muscleGroup === historyMuscleFilter)
    : allEntries;

  // 種目名で重複排除しつつリスト化
  const seen = new Set();
  const exercisesInFilter = [];
  filtered.forEach(e => {
    const key = e.exerciseId || e.exerciseName;
    if (!seen.has(key)) {
      seen.add(key);
      exercisesInFilter.push({ id: e.exerciseId, name: e.exerciseName });
    }
  });

  if (exercisesInFilter.length === 0) {
    wrap.classList.add('hidden');
    historyExerciseFilter = '';
    return;
  }

  wrap.classList.remove('hidden');
  const prev = historyExerciseFilter;
  sel.innerHTML = '<option value="">すべての種目</option>';
  exercisesInFilter.forEach(ex => {
    const opt = document.createElement('option');
    opt.value = ex.id || ex.name;
    opt.textContent = ex.name;
    if (prev && (prev === ex.id || prev === ex.name)) {
      opt.selected = true;
      historyExerciseFilter = prev; // 保持
    }
    sel.appendChild(opt);
  });
  // 前回選択が候補外になった場合はリセット
  if (prev && !exercisesInFilter.some(ex => ex.id === prev || ex.name === prev)) {
    historyExerciseFilter = '';
    sel.value = '';
  }
}

// フィルタを適用してエントリを絞り込む共通ユーティリティ
function getFilteredEntries() {
  let entries = getEntries();
  if (historyMuscleFilter) {
    entries = entries.filter(e => e.muscleGroup === historyMuscleFilter);
  }
  if (historyExerciseFilter) {
    entries = entries.filter(e =>
      e.exerciseId === historyExerciseFilter || e.exerciseName === historyExerciseFilter
    );
  }
  return entries;
}

function renderHistoryList() {
  const entries = getFilteredEntries();
  const container = document.getElementById('history-list');
  const empty = document.getElementById('history-empty');

  Array.from(container.children).forEach(child => {
    if (child.id !== 'history-empty') child.remove();
  });

  if (entries.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  // Group by date
  const byDate = {};
  entries.forEach(e => {
    if (!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  });

  const sortedDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));

  sortedDates.forEach(date => {
    const dateEntries = byDate[date];
    const gymTimes = getGymTimes();
    const gt = gymTimes[date] || dateEntries[0] || {};

    const section = document.createElement('div');
    section.className = 'bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden';

    // Collect unique muscle groups for this date
    const muscles = [...new Set(dateEntries.map(e => e.muscleGroup).filter(Boolean))];
    const muscleTagsHtml = muscles.map(m => muscleTagHtml(m)).join('');

    const header = document.createElement('div');
    header.className = 'px-4 py-3 flex items-center justify-between cursor-pointer';
    header.innerHTML = `
      <div>
        <div class="flex items-center flex-wrap gap-1.5">
          <span class="text-sm font-bold text-white">${formatDate(date)}</span>${muscleTagsHtml}
        </div>
        <div class="text-xs text-gray-400 mt-0.5">${dateEntries.length}種目 ${gt.in ? `• ${gt.in}〜${gt.out || '?'}` : ''}</div>
      </div>
      <svg class="toggle-icon w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ml-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    `;

    const body = document.createElement('div');
    body.className = 'hidden border-t border-gray-800';

    dateEntries.forEach(entry => {
      const card = buildEntryCard(entry, true, renderHistory);
      card.className = 'rounded-none border-0 border-b border-gray-800 px-4 py-3 bg-transparent last:border-b-0';
      body.appendChild(card);
    });

    header.addEventListener('click', () => {
      body.classList.toggle('hidden');
      header.querySelector('.toggle-icon').classList.toggle('rotate-180');
    });

    section.appendChild(header);
    section.appendChild(body);
    container.insertBefore(section, empty);
  });
}

function renderCalendarView() {
  const container = document.getElementById('history-list');
  const empty = document.getElementById('history-empty');
  empty.classList.add('hidden');

  Array.from(container.children).forEach(child => {
    if (child.id !== 'history-empty') child.remove();
  });

  const entries = getFilteredEntries();
  const byDate = {};
  entries.forEach(e => {
    if (!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  });

  const cal = document.createElement('div');
  cal.id = 'calendar-view';

  // Month navigation
  const monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  const nav = document.createElement('div');
  nav.className = 'flex items-center justify-between mb-4 px-1';
  nav.innerHTML = `
    <button id="cal-prev" class="flex items-center justify-center rounded-full bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors text-xl font-light" style="width:44px;height:44px" aria-label="前の月">‹</button>
    <span class="text-base font-bold text-white">${calendarYear}年${monthNames[calendarMonth]}</span>
    <button id="cal-next" class="flex items-center justify-center rounded-full bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors text-xl font-light" style="width:44px;height:44px" aria-label="次の月">›</button>
  `;
  cal.appendChild(nav);

  // Day-of-week headers
  const dayLabels = ['日','月','火','水','木','金','土'];
  const headerRow = document.createElement('div');
  headerRow.className = 'grid grid-cols-7 mb-2';
  dayLabels.forEach((d, i) => {
    const cell = document.createElement('div');
    cell.className = `text-center text-xs font-semibold py-1 ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-400'}`;
    cell.textContent = d;
    headerRow.appendChild(cell);
  });
  cal.appendChild(headerRow);

  // Calendar grid
  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-7 gap-y-1';

  const firstDay = new Date(calendarYear, calendarMonth, 1).getDay();
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const today = todayStr();

  // Blank cells before first day
  for (let i = 0; i < firstDay; i++) {
    grid.appendChild(document.createElement('div'));
  }

  // Day cells
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayEntries = byDate[dateStr] || [];
    const isToday = dateStr === today;
    const isSelected = dateStr === calendarSelectedDate;
    const hasEntries = dayEntries.length > 0;
    const isFuture = dateStr > today;

    const cell = document.createElement('div');
    cell.className = 'flex flex-col items-center py-1 cursor-pointer select-none';
    cell.dataset.date = dateStr;

    // Day number circle
    const num = document.createElement('div');
    let numCls = 'w-8 h-8 flex items-center justify-center rounded-full text-sm font-semibold transition-all';
    if (isSelected && hasEntries) {
      numCls += ' bg-indigo-600 text-white';
    } else if (isToday) {
      numCls += ' ring-2 ring-indigo-500 text-indigo-400 font-bold';
    } else if (hasEntries) {
      numCls += ' text-white hover:bg-gray-800';
    } else if (isFuture) {
      numCls += ' text-gray-700';
    } else {
      numCls += ' text-gray-400';
    }
    num.className = numCls;
    num.textContent = d;
    cell.appendChild(num);

    // Muscle group dots
    if (hasEntries) {
      const muscles = [...new Set(dayEntries.map(e => e.muscleGroup).filter(Boolean))];
      const dotsDiv = document.createElement('div');
      dotsDiv.className = 'flex gap-0.5 mt-0.5 justify-center flex-wrap';
      if (muscles.length > 0) {
        muscles.slice(0, 3).forEach(m => {
          const dot = document.createElement('div');
          dot.className = 'w-1.5 h-1.5 rounded-full';
          const c = MUSCLE_COLORS[m];
          dot.style.backgroundColor = c ? c.activeBg : '#6366f1';
          dotsDiv.appendChild(dot);
        });
      } else {
        // No muscle group set — show generic indigo dot
        const dot = document.createElement('div');
        dot.className = 'w-1.5 h-1.5 rounded-full';
        dot.style.backgroundColor = '#6366f1';
        dotsDiv.appendChild(dot);
      }
      cell.appendChild(dotsDiv);
    }

    if (hasEntries) {
      cell.addEventListener('click', () => {
        calendarSelectedDate = calendarSelectedDate === dateStr ? null : dateStr;
        renderCalendarView();
      });
    }

    grid.appendChild(cell);
  }

  cal.appendChild(grid);

  // Monthly summary strip
  const monthDates = Object.keys(byDate).filter(d =>
    d.startsWith(`${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-`)
  );
  const summary = document.createElement('div');
  summary.className = 'mt-3 pt-3 border-t border-gray-800 flex items-center justify-between';
  summary.innerHTML = `
    <span class="text-xs text-gray-400">今月のトレーニング</span>
    <span class="text-xs font-bold text-indigo-400">${monthDates.length}日</span>
  `;
  cal.appendChild(summary);

  // Selected day entries
  if (calendarSelectedDate) {
    const daySection = document.createElement('div');
    daySection.className = 'mt-4 space-y-3';

    const selEntries = byDate[calendarSelectedDate] || [];
    const gymTimes = getGymTimes();
    const gt = gymTimes[calendarSelectedDate] || {};

    const dayHeader = document.createElement('div');
    dayHeader.className = 'flex items-center gap-2 mb-2 pb-2 border-b border-gray-800';
    const muscles = [...new Set(selEntries.map(e => e.muscleGroup).filter(Boolean))];
    dayHeader.innerHTML = `
      <span class="text-sm font-bold text-white">${formatDate(calendarSelectedDate)}</span>
      ${muscles.map(m => muscleTagHtml(m)).join('')}
      <span class="text-xs text-gray-400 ml-auto">${selEntries.length}種目${gt.in ? ` • ${gt.in}〜${gt.out || '?'}` : ''}</span>
    `;
    daySection.appendChild(dayHeader);

    selEntries.forEach(entry => {
      const card = buildEntryCard(entry, true, () => renderHistory());
      daySection.appendChild(card);
    });

    cal.appendChild(daySection);
  }

  container.insertBefore(cal, empty);

  // Navigation button handlers
  document.getElementById('cal-prev').addEventListener('click', () => {
    calendarMonth--;
    if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; }
    calendarSelectedDate = null;
    renderCalendarView();
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    calendarMonth++;
    if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; }
    calendarSelectedDate = null;
    renderCalendarView();
  });
}

// 種目フィルタ変更
document.getElementById('history-exercise-select-filter').addEventListener('change', (e) => {
  historyExerciseFilter = e.target.value;
  renderHistory();
});

// History view toggle
document.getElementById('history-list-btn').addEventListener('click', () => {
  historyViewMode = 'list';
  renderHistory();
});
document.getElementById('history-cal-btn').addEventListener('click', () => {
  historyViewMode = 'calendar';
  renderHistory();
});

// ============================================================
// GRAPH PAGE
// ============================================================

let graphView = 'exercise';   // 'exercise' | 'muscle'

function renderGraphPage() {
  const isMuscle = graphView === 'muscle';
  document.getElementById('graph-exercise-view').classList.toggle('hidden', isMuscle);
  document.getElementById('graph-muscle-view').classList.toggle('hidden', !isMuscle);

  const on  = 'flex-1 py-3 rounded-xl text-sm font-semibold border transition-colors bg-indigo-600 border-indigo-600 text-white';
  const off = 'flex-1 py-3 rounded-xl text-sm font-semibold border transition-colors bg-gray-900 border-gray-800 text-gray-400';
  document.getElementById('graph-view-exercise').className = isMuscle ? off : on;
  document.getElementById('graph-view-muscle').className   = isMuscle ? on  : off;

  if (isMuscle) { renderMuscleView(); return; }
  renderGraphMusclePills();
  renderGraphExerciseSelect();
  renderGraph();
}

document.getElementById('graph-view-exercise').addEventListener('click', () => {
  graphView = 'exercise'; renderGraphPage();
});
document.getElementById('graph-view-muscle').addEventListener('click', () => {
  graphView = 'muscle'; renderGraphPage();
});
document.getElementById('mv-count-fractional').addEventListener('click', () => {
  muscleCountFractional = true; updateMuscleCountBtns(); renderMuscleView();
});
document.getElementById('mv-count-direct').addEventListener('click', () => {
  muscleCountFractional = false; updateMuscleCountBtns(); renderMuscleView();
});
function updateMuscleCountBtns() {
  const on  = 'flex-1 py-3 rounded-xl text-sm font-semibold border transition-colors bg-indigo-600 border-indigo-600 text-white';
  const off = 'flex-1 py-3 rounded-xl text-sm font-semibold border transition-colors bg-gray-900 border-gray-800 text-gray-400';
  document.getElementById('mv-count-fractional').className = muscleCountFractional ? on : off;
  document.getElementById('mv-count-direct').className     = muscleCountFractional ? off : on;
}

function renderGraphMusclePills() {
  const pillContainer = document.getElementById('graph-muscle-pills');
  pillContainer.innerHTML = '';
  const muscles = ['', '胸', '背中', '脚', '肩', '腕', '腹'];
  muscles.forEach(m => {
    const btn = document.createElement('button');
    btn.className = 'flex-shrink-0 px-5 py-2.5 rounded-full text-base font-semibold border transition-colors';
    btn.dataset.muscle = m;
    btn.textContent = m || 'すべて';
    const isActive = graphMuscleFilter === m;
    if (isActive) {
      const c = MUSCLE_COLORS[m];
      btn.style.backgroundColor = c ? c.sel : '#4f46e5';
      btn.style.borderColor     = c ? c.sel : '#4f46e5';
      btn.style.color           = '#ffffff';
    } else {
      btn.classList.add('bg-gray-900', 'border-gray-800', 'text-gray-400');
    }
    btn.addEventListener('click', () => {
      graphMuscleFilter = m;
      renderGraphMusclePills();
      renderGraphExerciseSelect();
      renderGraph();
    });
    pillContainer.appendChild(btn);
  });
}

function renderGraphExerciseSelect() {
  const allExercises = getExercises();
  const select = document.getElementById('graph-exercise-select');
  const currentVal = select.value;

  // 部位フィルタが選択されている場合は、そのエントリに登場する種目のみ表示
  let exercises;
  if (graphMuscleFilter) {
    const entries = getEntries().filter(e => e.muscleGroup === graphMuscleFilter);
    const seenIds = new Set();
    exercises = [];
    entries.forEach(e => {
      const key = e.exerciseId || e.exerciseName;
      if (!seenIds.has(key)) {
        seenIds.add(key);
        // 対応するexerciseオブジェクトを探す（なければエントリから生成）
        const ex = allExercises.find(x => x.id === e.exerciseId) || { id: e.exerciseId || e.exerciseName, name: e.exerciseName };
        exercises.push(ex);
      }
    });
  } else {
    exercises = allExercises;
  }

  select.innerHTML = '<option value="">種目を選択してください</option>';
  exercises.forEach(ex => {
    const opt = document.createElement('option');
    opt.value = ex.id;
    opt.textContent = ex.name;
    select.appendChild(opt);
  });

  // 現在選択中の種目が絞り込み後のリストにあれば維持、なければリセット
  if (currentVal && exercises.some(ex => ex.id === currentVal)) {
    select.value = currentVal;
  }
}

function renderGraph() {
  const exerciseId = document.getElementById('graph-exercise-select').value;
  const canvas = document.getElementById('graph-canvas');
  const empty = document.getElementById('graph-empty');
  const statsEl = document.getElementById('graph-stats');

  if (!exerciseId) {
    canvas.classList.add('hidden');
    statsEl.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }

  const entries = getEntries().filter(e => e.exerciseId === exerciseId || e.exerciseName === getExercises().find(ex => ex.id === exerciseId)?.name);

  if (entries.length === 0) {
    canvas.classList.add('hidden');
    statsEl.classList.add('hidden');
    empty.classList.remove('hidden');
    empty.querySelector('div:last-child').textContent = 'この種目の記録がありません';
    return;
  }

  empty.classList.add('hidden');
  canvas.classList.remove('hidden');
  statsEl.classList.remove('hidden');

  // 日付ごとに集計する。値はすべて kg に揃えてから比較・合算する。
  // 以前は単位を無視して素の数値を使っていたため、2.5lbs(=1.1kg) が 5.0kg より
  // 小さい「2.5」として同じ軸に並んでいた。
  const dispUnit = getDefaultUnit();
  const byDate = {};
  entries.forEach(entry => {
    const maxKg = entryMaxKg(entry.sets);
    const volKg = entryVolumeKg(entry.sets);
    if (!byDate[entry.date]) {
      byDate[entry.date] = { maxKg, volKg };
    } else {
      // 同じ日に同じ種目を複数回記録した場合: 最大重量は最大、ボリュームは合算。
      // 以前はボリュームも Math.max にしていたため、2回に分けた日の総量が過小になっていた。
      byDate[entry.date].maxKg = Math.max(byDate[entry.date].maxKg, maxKg);
      byDate[entry.date].volKg += volKg;
    }
  });

  const sortedDates = Object.keys(byDate).sort();
  const dataPoints = sortedDates.map(d => ({
    date: d,
    // 表示単位に変換した値をプロットする（軸・統計・ラベルがすべて同じ単位になる）
    value: fromKg(graphMode === 'weight' ? byDate[d].maxKg : byDate[d].volKg, dispUnit),
    unit: dispUnit,
  }));

  // Draw chart using Canvas API
  drawLineChart(canvas, dataPoints);

  // Stats
  const values = dataPoints.map(p => p.value);
  const maxVal = Math.max(...values);
  const latestVal = values[values.length - 1];
  const firstVal = values[0];
  const diff = latestVal - firstVal;

  statsEl.innerHTML = `
    <div class="bg-gray-800 rounded-xl p-3 text-center">
      <div class="text-xs text-gray-400 mb-1">最大</div>
      <div class="text-sm font-bold text-indigo-400">${maxVal.toFixed(1)}<span class="text-xs text-gray-400">${dispUnit}</span></div>
    </div>
    <div class="bg-gray-800 rounded-xl p-3 text-center">
      <div class="text-xs text-gray-400 mb-1">最新</div>
      <div class="text-sm font-bold text-white">${latestVal.toFixed(1)}<span class="text-xs text-gray-400">${dispUnit}</span></div>
    </div>
    <div class="bg-gray-800 rounded-xl p-3 text-center">
      <div class="text-xs text-gray-400 mb-1">増減</div>
      <div class="text-sm font-bold ${diff >= 0 ? 'text-green-400' : 'text-red-400'}">${diff >= 0 ? '+' : ''}${diff.toFixed(1)}<span class="text-xs opacity-75">${dispUnit}</span></div>
    </div>
  `;
}

function drawLineChart(canvas, dataPoints) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  const W = rect.width - 32; // subtract padding
  const H = 220;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  if (dataPoints.length === 0) return;

  const padL = 44, padR = 16, padT = 16, padB = 40;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const values = dataPoints.map(p => p.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;

  // X軸は「日付」で取る。以前はインデックスの等間隔で描いていたため、
  // 1日空きも30日空きも同じ幅になり、中断期間や停滞期がグラフから消えていた。
  const times = dataPoints.map(p => new Date(p.date + 'T00:00:00').getTime());
  const tMin = times[0], tMax = times[times.length - 1];
  const tSpan = (tMax - tMin) || 1;
  const xScale = (i) => dataPoints.length === 1
    ? padL + chartW / 2
    : padL + ((times[i] - tMin) / tSpan) * chartW;
  const yScale = (v) => padT + chartH - ((v - minV) / range) * chartH;

  // Grid lines
  const pal = chartPalette();
  ctx.strokeStyle = pal.grid;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padT + (i / 4) * chartH;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + chartW, y);
    ctx.stroke();

    // Y labels
    const val = maxV - (i / 4) * range;
    ctx.fillStyle = pal.label;
    ctx.font = `${10 * dpr / dpr}px -apple-system, sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText(val.toFixed(0), padL - 6, y + 4);
  }

  // Gradient fill
  const gradient = ctx.createLinearGradient(0, padT, 0, padT + chartH);
  gradient.addColorStop(0, 'rgba(99,102,241,0.35)');
  gradient.addColorStop(1, 'rgba(99,102,241,0)');

  ctx.beginPath();
  dataPoints.forEach((p, i) => {
    const x = xScale(i), y = yScale(p.value);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.lineTo(xScale(dataPoints.length - 1), padT + chartH);
  ctx.lineTo(xScale(0), padT + chartH);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.strokeStyle = '#818cf8';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  dataPoints.forEach((p, i) => {
    const x = xScale(i), y = yScale(p.value);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Dots
  dataPoints.forEach((p, i) => {
    const x = xScale(i), y = yScale(p.value);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#6366f1';
    ctx.fill();
    ctx.strokeStyle = '#c7d2fe';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });

  // X labels: 実測した文字幅で重なりを判定して間引く。
  // 以前は「n個おきに描く」と「最後は必ず描く」が競合し、その2つが隣り合うと
  // 「07/2908/01」のように重なって読めなくなっていた。日付軸にすると点の間隔が
  // 不均等になるので、等間隔の間引きでは原理的に判定できない。
  ctx.fillStyle = pal.label;
  ctx.font = `9px -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  const labelY = padT + chartH + 18;
  const LABEL_GAP = 8;
  const labels = dataPoints.map((p, i) => {
    const [, m, d] = p.date.split('-');
    const text = `${m}/${d}`;
    return { text, x: xScale(i), w: ctx.measureText(text).width };
  });
  // 右端（＝最新）は必ず描き、そこから左へ、重ならないものだけ拾う
  const picked = [];
  for (let i = labels.length - 1; i >= 0; i--) {
    const cand = labels[i];
    const prev = picked[picked.length - 1];
    if (!prev || (prev.x - prev.w / 2) - (cand.x + cand.w / 2) >= LABEL_GAP) picked.push(cand);
  }
  picked.forEach(l => {
    // 端のラベルがキャンバスからはみ出さないように寄せる
    const x = Math.min(Math.max(l.x, l.w / 2 + 2), W - l.w / 2 - 2);
    ctx.fillText(l.text, x, labelY);
  });
}

document.getElementById('graph-exercise-select').addEventListener('change', renderGraph);

document.getElementById('graph-weight-btn').addEventListener('click', () => {
  graphMode = 'weight';
  document.getElementById('graph-weight-btn').className = 'flex-1 py-2 rounded-xl text-sm font-semibold border transition-colors bg-indigo-600 border-indigo-600 text-white';
  document.getElementById('graph-volume-btn').className = 'flex-1 py-2 rounded-xl text-sm font-semibold border transition-colors bg-gray-900 border-gray-800 text-gray-400';
  renderGraph();
});

document.getElementById('graph-volume-btn').addEventListener('click', () => {
  graphMode = 'volume';
  document.getElementById('graph-volume-btn').className = 'flex-1 py-2 rounded-xl text-sm font-semibold border transition-colors bg-indigo-600 border-indigo-600 text-white';
  document.getElementById('graph-weight-btn').className = 'flex-1 py-2 rounded-xl text-sm font-semibold border transition-colors bg-gray-900 border-gray-800 text-gray-400';
  renderGraph();
});

// ============================================================
// 部位別・週間セット数
// ============================================================
// 週あたりの部位別セット数は、肥大の用量指標として最も裏付けが強い
// （Schoenfeld 2017: 連続変数で P=0.002 ／ Pelland 2026: 傾き>0 の事後確率100%）。
// 「種目ごとの最大重量の折れ線」ではこのドライバーが見えないため追加した。
//
// 数え方は Pelland 2026 が最も支持した fractional（主働筋1.0／協働筋0.5）。
// ただし 0.5 という重みは著者自身が heuristic と明言しているので、
// 「主働のみ」に切り替えられるようにし、UIにも注記を出している。

const MUSCLES = ['胸', '背中', '脚', '肩', '腕', '腹'];

// 種目名から主働筋・協働筋を推定するテーブル（前方一致でなく部分一致）。
// exercise.muscleGroups / exercise.secondaryMuscles が設定されていればそちらを優先する。
const EXERCISE_MUSCLE_HINTS = [
  { re: /(ベンチプレス|チェストプレス|ダンベルプレス|プッシュアップ|腕立て|ディップ)/, primary: '胸',  secondary: ['腕', '肩'] },
  { re: /(フライ|ペックデック|ペックフライ)/,                                        primary: '胸',  secondary: [] },
  { re: /(デッドリフト)/,                                                            primary: '背中', secondary: ['脚', '腕'] },
  { re: /(ラットプル|懸垂|チンニング|プルアップ|ロウ|ローイング|プルオーバー|シュラッグ)/, primary: '背中', secondary: ['腕'] },
  { re: /(スクワット|レッグプレス|ランジ|ヒップスラスト|ブルガリアン)/,                 primary: '脚',  secondary: ['腹'] },
  { re: /(レッグエクステンション|レッグカール|カーフ|アダクション|アブダクション)/,      primary: '脚',  secondary: [] },
  { re: /(ショルダープレス|オーバーヘッドプレス|アップライトロウ)/,                     primary: '肩',  secondary: ['腕'] },
  { re: /(サイドレイズ|フロントレイズ|リアレイズ|リアデルト)/,                          primary: '肩',  secondary: [] },
  { re: /(カール|プッシュダウン|キックバック|トライセプス|ビセップス|フレンチプレス)/,    primary: '腕',  secondary: [] },
  { re: /(クランチ|シットアップ|レッグレイズ|プランク|アブ|トーソ|腹筋)/,               primary: '腹',  secondary: [] },
];

// エントリ1件が各部位に寄与するセット数を返す（fractional なら協働筋は0.5）
function entryMuscleContribution(entry, exercisesById, fractional) {
  const out = {};
  const setCount = (entry.sets || []).length;
  if (!setCount) return out;

  const ex = exercisesById[entry.exerciseId];
  let primary = entry.muscleGroup || (ex && (ex.muscleGroups || [])[0]) || '';
  let secondary = (ex && ex.secondaryMuscles) || null;

  if (!primary || !secondary) {
    const hint = EXERCISE_MUSCLE_HINTS.find(h => h.re.test(entry.exerciseName || ''));
    if (hint) {
      if (!primary) primary = hint.primary;
      if (!secondary) secondary = hint.secondary;
    }
  }
  if (!primary) return out;
  if (!secondary) secondary = [];

  out[primary] = (out[primary] || 0) + setCount;
  if (fractional) {
    for (const m of secondary) {
      if (m === primary || !MUSCLES.includes(m)) continue;
      out[m] = (out[m] || 0) + setCount * 0.5;
    }
  }
  return out;
}

function isoWeekKey(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);                       // ISO: 木曜日基準
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// 直近 n 週分（記録が無い週も0として詰める）を返す
function weeklyMuscleSets(nWeeks, fractional) {
  const exercisesById = {};
  getExercises().forEach(x => { exercisesById[x.id] = x; });

  const byWeek = {};
  getEntries().forEach(e => {
    if (!e.date) return;
    const k = isoWeekKey(e.date);
    if (!byWeek[k]) byWeek[k] = {};
    const c = entryMuscleContribution(e, exercisesById, fractional);
    for (const m in c) byWeek[k][m] = (byWeek[k][m] || 0) + c[m];
  });

  // 今週から遡って n 週分のキーを作る（欠週を隠さない）
  const keys = [];
  const now = new Date();
  for (let i = nWeeks - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i * 7);
    const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const k = isoWeekKey(ds);
    if (!keys.includes(k)) keys.push(k);
  }
  return keys.map(k => ({ week: k, counts: byWeek[k] || {} }));
}

let muscleCountFractional = true;

function renderMuscleView() {
  const weeks = weeklyMuscleSets(12, muscleCountFractional);
  drawMuscleChart(document.getElementById('muscle-canvas'), weeks);

  // 凡例
  const legend = document.getElementById('muscle-legend');
  legend.innerHTML = '';
  MUSCLES.forEach(m => {
    const el = document.createElement('span');
    el.className = 'inline-flex items-center gap-1 text-xs text-gray-400';
    el.innerHTML = `<span class="inline-block w-2.5 h-2.5 rounded-sm" style="background:${MUSCLE_COLORS[m].activeBg}"></span>`;
    el.appendChild(document.createTextNode(m));
    legend.appendChild(el);
  });

  // 週平均（記録のある週だけで平均を出す。0の週を混ぜると実施週の実態が薄まるため）
  const active = weeks.filter(w => Object.values(w.counts).some(v => v > 0));
  const avgBox = document.getElementById('muscle-avg');
  if (active.length === 0) {
    avgBox.innerHTML = '<div class="text-center text-sm text-gray-400 py-4">まだ記録がありません</div>';
    return;
  }
  const rows = MUSCLES.map(m => ({
    m, avg: active.reduce((s, w) => s + (w.counts[m] || 0), 0) / active.length
  })).sort((a, b) => b.avg - a.avg);

  const max = Math.max(...rows.map(r => r.avg), 1);
  avgBox.innerHTML = `<div class="text-xs font-semibold text-gray-400 mb-3">
      記録のあった${active.length}週の平均（セット/週）</div>`;
  rows.forEach(r => {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-2 mb-2';
    row.innerHTML = `
      <span class="text-xs text-gray-400 w-8 flex-shrink-0">${r.m}</span>
      <span class="flex-1 h-2 rounded-full bg-gray-800 overflow-hidden">
        <span class="block h-full rounded-full" style="width:${(r.avg / max * 100).toFixed(1)}%;background:${MUSCLE_COLORS[r.m].activeBg}"></span>
      </span>
      <span class="text-xs font-bold text-gray-300 w-10 text-right tabular-nums flex-shrink-0">${r.avg.toFixed(1)}</span>`;
    avgBox.appendChild(row);
  });
}

function drawMuscleChart(canvas, weeks) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.parentElement.getBoundingClientRect().width - 32;
  const H = 260;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const padL = 30, padR = 8, padT = 12, padB = 34;
  const chartW = W - padL - padR, chartH = H - padT - padB;

  const totals = weeks.map(w => MUSCLES.reduce((s, m) => s + (w.counts[m] || 0), 0));
  const maxTotal = Math.max(...totals, 10);
  const yScale = v => padT + chartH - (v / maxTotal) * chartH;

  // 目安帯（10〜20セット/週）。Schoenfeld 2017 のカテゴリ分析は P=0.074 で有意ではないため、
  // 目標線ではなく「通説の位置」として薄く敷くだけに留める
  const bandTop = yScale(20), bandBottom = yScale(10);
  const pal2 = chartPalette();
  ctx.fillStyle = pal2.band;
  ctx.fillRect(padL, bandTop, chartW, bandBottom - bandTop);

  ctx.strokeStyle = pal2.grid;
  ctx.lineWidth = 1;
  ctx.fillStyle = pal2.label;
  ctx.font = '9px -apple-system, sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const v = (maxTotal / 4) * i, y = yScale(v);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + chartW, y); ctx.stroke();
    ctx.fillText(String(Math.round(v)), padL - 5, y + 3);
  }

  const slot = chartW / Math.max(weeks.length, 1);
  const barW = Math.min(slot * 0.62, 28);

  weeks.forEach((w, i) => {
    const x = padL + slot * i + (slot - barW) / 2;
    let acc = 0;
    MUSCLES.forEach(m => {
      const v = w.counts[m] || 0;
      if (v <= 0) return;
      const y0 = yScale(acc), y1 = yScale(acc + v);
      ctx.fillStyle = MUSCLE_COLORS[m].activeBg;
      ctx.fillRect(x, y1, barW, Math.max(y0 - y1, 0.5));
      acc += v;
    });
    // 週ラベル（詰まらないよう間引く）
    if (weeks.length <= 8 || i % 2 === 0 || i === weeks.length - 1) {
      ctx.fillStyle = pal2.label;
      ctx.textAlign = 'center';
      ctx.font = '9px -apple-system, sans-serif';
      ctx.fillText(w.week.slice(-3), x + barW / 2, padT + chartH + 14);
    }
    // 合計
    if (acc > 0) {
      ctx.fillStyle = 'rgba(226,232,240,0.9)';
      ctx.textAlign = 'center';
      ctx.font = 'bold 9px -apple-system, sans-serif';
      ctx.fillText(acc % 1 ? acc.toFixed(1) : String(acc), x + barW / 2, yScale(acc) - 4);
    }
  });

  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(148,163,184,0.6)';
  ctx.font = '9px -apple-system, sans-serif';
  ctx.fillText('薄い帯 = 通説の10〜20セット（目標線ではありません）', padL, padT + chartH + 30);
}

// ============================================================
// PR（自己ベスト）検出
// ============================================================
// 単位を kg に正規化してから比較する（優先度3の修正が前提）。
// 推定1RM は Epley 式。Reynolds 2006 が「線形式は10レップ以下」としているため、
// 11レップ以上のセットからは算出しない。

function epley1RMkg(set) {
  const reps = parseInt(set.reps) || 0;
  if (reps <= 0 || reps > 10) return null;      // 有効域外は推定しない
  return toKg(set.weight, set.unit) * (1 + reps / 30);
}

function best1RMkg(sets) {
  return (sets || []).reduce((mx, s) => {
    const v = epley1RMkg(s);
    return v != null && v > mx ? v : mx;
  }, 0);
}
function bestSetVolumeKg(sets) {
  return (sets || []).reduce((mx, s) =>
    Math.max(mx, toKg(s.weight, s.unit) * (parseInt(s.reps) || 0)), 0);
}

// 保存したエントリが自己ベストを更新したか判定する。
// 比較対象は「同じ種目名の、この記録より前の日付」のエントリ。
function detectPRs(entry) {
  const key = (entry.exerciseName || '').trim().toLowerCase();
  const past = getEntries().filter(e =>
    e.id !== entry.id &&
    (e.exerciseName || '').trim().toLowerCase() === key &&
    e.date <= entry.date
  );
  if (past.length === 0) return [];   // 初回は PR 扱いしない（全部が「自己ベスト」になってしまう）

  const prs = [];
  const dispUnit = getDefaultUnit();
  const checks = [
    { label: '最大重量',       now: entryMaxKg(entry.sets),      prev: Math.max(...past.map(e => entryMaxKg(e.sets))) },
    { label: '推定1RM',        now: best1RMkg(entry.sets),       prev: Math.max(...past.map(e => best1RMkg(e.sets))) },
    { label: 'ベストセット',   now: bestSetVolumeKg(entry.sets), prev: Math.max(...past.map(e => bestSetVolumeKg(e.sets))) },
  ];
  for (const c of checks) {
    if (c.now > 0 && c.now > c.prev + 1e-9) {
      prs.push(`${c.label} ${formatKg(c.now, dispUnit)}${dispUnit}`);
    }
  }
  return prs;
}

function announcePRs(entry) {
  const prs = detectPRs(entry);
  if (prs.length === 0) return;
  showToast(`🏆 自己ベスト更新! ${prs.join(' / ')}`, 3500);
  if (navigator.vibrate) { try { navigator.vibrate([40, 60, 40]); } catch {} }
}

// ============================================================
// 休憩タイマー
// ============================================================
// Strong / Hevy / FitNotes / StrengthLog / Fitbod の5本で確認できた定番機能。
// 本アプリはセット単位の完了マークを持たないため、カードの保存を開始トリガーにする。

const REST_KEY = 'wt_rest_sec';
let restTimerId = null, restEndAt = 0, restTotal = 0;

function getRestSeconds() { return load(REST_KEY, 120); }
function setRestSeconds(s) { save(REST_KEY, s); }

function startRestTimer(seconds) {
  const sec = seconds || getRestSeconds();
  if (!sec) return;
  restTotal = sec;
  restEndAt = Date.now() + sec * 1000;
  document.getElementById('rest-timer').classList.remove('hidden');
  tickRestTimer();
  clearInterval(restTimerId);
  restTimerId = setInterval(tickRestTimer, 200);
}

function tickRestTimer() {
  const leftMs = restEndAt - Date.now();
  const left = Math.max(0, Math.ceil(leftMs / 1000));
  const el = document.getElementById('rest-remaining');
  if (el) el.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  const bar = document.getElementById('rest-progress');
  if (bar) bar.style.width = `${Math.max(0, Math.min(100, (leftMs / (restTotal * 1000)) * 100))}%`;
  if (leftMs <= 0) {
    stopRestTimer();
    showToast('休憩おわり');
    if (navigator.vibrate) { try { navigator.vibrate([120, 80, 120]); } catch {} }
  }
}

function stopRestTimer() {
  clearInterval(restTimerId);
  restTimerId = null;
  document.getElementById('rest-timer')?.classList.add('hidden');
}

document.getElementById('rest-stop')?.addEventListener('click', stopRestTimer);
document.querySelectorAll('.rest-add-btn').forEach(b =>
  b.addEventListener('click', () => {
    restEndAt += parseInt(b.dataset.sec) * 1000;
    if (restEndAt < Date.now()) restEndAt = Date.now();
    tickRestTimer();
  })
);

// ============================================================
// 削除の取り消し（tombstone を戻すだけなので安全に実装できる）
// ============================================================
let undoTimerId = null;

function offerUndoDelete(entry) {
  const bar = document.getElementById('undo-bar');
  if (!bar) return;
  document.getElementById('undo-msg').textContent = `「${entry.exerciseName || '記録'}」を削除しました`;
  bar.classList.remove('hidden');
  clearTimeout(undoTimerId);
  undoTimerId = setTimeout(() => bar.classList.add('hidden'), 6000);

  const btn = document.getElementById('undo-btn');
  const handler = () => {
    // tombstone を元のエントリで置き換えて復元する
    const raw = getEntriesRaw().map(e => e.id === entry.id ? stampEntry({ ...entry, deleted: false }) : e);
    saveEntriesRaw(raw.map(e => { if (e.id === entry.id) delete e.deleted; return e; }));
    scheduleFsSync();
    bar.classList.add('hidden');
    btn.removeEventListener('click', handler);
    showToast('元に戻しました');
    if (currentTab === 'today') renderToday();
    if (currentTab === 'history') renderHistory();
  };
  btn.addEventListener('click', handler, { once: true });
}

// ============================================================
// EDIT ENTRY MODAL
// ============================================================

function openEditModal(id) {
  const entry = getEntries().find(e => e.id === id);
  if (!entry) return;
  editingEntryId = id;
  // セットごとの単位を保持する。以前は sets[0] の単位を全セットに書き戻していたため、
  // kg と lbs が混ざったエントリを開いて保存しただけで、単位が黙って書き換わっていた。
  editSets = entry.sets.map(s => ({ weight: String(s.weight), reps: String(s.reps), unit: s.unit || 'kg' }));
  editUnit = entry.sets[0]?.unit || 'kg';
  editUnitTouched = false;   // 単位ボタンを押したときだけ全セットへ適用する
  editMuscleGroup = entry.muscleGroup || '';

  document.getElementById('edit-exercise-display').textContent = entry.exerciseName;
  document.getElementById('edit-memo').value = entry.memo || '';

  // ジム時間をその日の gymTimes から読み込む
  const gymTimes = getGymTimes();
  const gt = gymTimes[entry.date] || {};
  document.getElementById('edit-gym-in').value  = gt.in  || entry.gymIn  || '';
  document.getElementById('edit-gym-out').value = gt.out || entry.gymOut || '';

  updateEditUnitButtons();
  updateMuscleBtns('.edit-muscle-btn', editMuscleGroup);
  renderEditSets();
  updateEditAddSetBtn();
  document.getElementById('edit-modal').classList.remove('hidden');
}

function closeEditModal() {
  closeNumpad();
  document.getElementById('edit-modal').classList.add('hidden');
  editingEntryId = null;
}

function renderEditSets() {
  closeNumpad();
  const container = document.getElementById('edit-sets-container');
  container.innerHTML = '';
  editSets.forEach((set, i) => {
    const rowUnit = editUnitTouched ? editUnit : (set.unit || editUnit);
    const row = document.createElement('div');
    row.className = 'flex items-center gap-2';
    row.innerHTML = `
      <span class="text-xs text-gray-400 w-14 flex-shrink-0">セット${i + 1}</span>
      <div class="flex-1 relative">
        <input type="text" readonly inputmode="none" placeholder="重量"
          value="${escapeHtml(set.weight)}" data-set="${i}" data-field="weight"
          data-numpad="decimal" data-numpad-label="重量（${escapeHtml(rowUnit)}）"
          class="edit-set-input num-input w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-3.5 text-white text-right pr-10 focus:outline-none" />
        <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">${escapeHtml(rowUnit)}</span>
      </div>
      <span class="text-gray-400">×</span>
      <div class="flex-1 relative">
        <input type="text" readonly inputmode="none" placeholder="回数"
          value="${set.reps}" data-set="${i}" data-field="reps"
          data-numpad="numeric" data-numpad-label="回数"
          class="edit-set-input num-input w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-3.5 text-white text-right pr-8 focus:outline-none" />
        <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">回</span>
      </div>
      ${editSets.length > 1 ? `<button class="remove-edit-set-btn flex-shrink-0 text-gray-400 hover:text-red-400 text-2xl leading-none transition-colors rounded-lg" style="width:44px;height:44px;flex-shrink:0;line-height:44px;text-align:center;padding:0" data-set="${i}" aria-label="セット${i + 1}を削除">×</button>` : '<div class="w-5 flex-shrink-0"></div>'}
    `;
    container.appendChild(row);
  });

  container.querySelectorAll('.edit-set-input').forEach(inp => {
    inp.addEventListener('input', (e) => {
      editSets[parseInt(e.target.dataset.set)][e.target.dataset.field] = e.target.value;
    });
  });
  container.querySelectorAll('.remove-edit-set-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      closeNumpad();
      const eIdx = parseInt(btn.dataset.set);
      const eRemoved = editSets[eIdx];
      editSets.splice(eIdx, 1);
      renderEditSets();
      updateEditAddSetBtn();
      showToast('セットを削除しました', 5000, { label: '元に戻す', fn: () => {
        editSets.splice(eIdx, 0, eRemoved);
        renderEditSets();
        updateEditAddSetBtn();
      }});
    });
  });
}

function updateEditUnitButtons() {
  document.getElementById('edit-unit-kg').className = `flex-1 py-3 rounded-2xl text-sm font-semibold border transition-colors ${editUnit === 'kg' ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-gray-900 border-gray-800 text-gray-400'}`;
  document.getElementById('edit-unit-lbs').className = `flex-1 py-3 rounded-2xl text-sm font-semibold border transition-colors ${editUnit === 'lbs' ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-gray-900 border-gray-800 text-gray-400'}`;
}

function updateEditAddSetBtn() {
  const btn = document.getElementById('edit-add-set-btn');
  if (editSets.length >= MAX_SETS) btn.classList.add('opacity-40', 'pointer-events-none');
  else btn.classList.remove('opacity-40', 'pointer-events-none');
}

document.getElementById('edit-cancel-btn').addEventListener('click', closeEditModal);

document.getElementById('edit-save-btn').addEventListener('click', () => {
  if (!editingEntryId) return;
  const validSets = editSets
    .filter(s => s.weight !== '' && s.reps !== '')
    .map(s => ({
      weight: parseFloat(s.weight) || 0,
      // 単位ボタンを押したときだけ全セットへ適用。押していなければ各セットの元の単位を残す
      unit: editUnitTouched ? editUnit : (s.unit || editUnit),
      reps: parseInt(s.reps) || 0,
    }))
    .filter(s => s.weight > 0 && s.reps > 0);
  if (validSets.length === 0) { alert('有効なセットを1つ以上入力してください'); return; }

  const editMemo  = document.getElementById('edit-memo').value.trim();
  const editGymIn  = document.getElementById('edit-gym-in').value;
  const editGymOut = document.getElementById('edit-gym-out').value;

  // 編集対象エントリの日付を取得してジム時間を保存
  const targetEntry = getEntries().find(e => e.id === editingEntryId);
  if (targetEntry) {
    const gymTimes = getGymTimes();
    gymTimes[targetEntry.date] = { in: editGymIn, out: editGymOut };
    saveGymTimes(gymTimes);
  }

  const entries = getEntries().map(e => {
    if (e.id !== editingEntryId) return e;
    return stampEntry({ ...e, sets: validSets, muscleGroup: editMuscleGroup, memo: editMemo,
                        gymIn: editGymIn, gymOut: editGymOut });
  });
  saveEntries(entries);
  closeEditModal();
  showToast('更新しました！');
  if (currentTab === 'today') renderToday();
  if (currentTab === 'history') renderHistory();
});

document.getElementById('edit-add-set-btn').addEventListener('click', () => {
  if (editSets.length >= MAX_SETS) return;
  editSets.push({ weight: '', reps: '', unit: editUnit });
  renderEditSets();
  updateEditAddSetBtn();
});

document.getElementById('edit-unit-kg').addEventListener('click', () => {
  editUnit = 'kg';
  editUnitTouched = true;
  updateEditUnitButtons();
  renderEditSets();
});
document.getElementById('edit-unit-lbs').addEventListener('click', () => {
  editUnit = 'lbs';
  editUnitTouched = true;
  updateEditUnitButtons();
  renderEditSets();
});

document.querySelectorAll('.edit-muscle-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    editMuscleGroup = editMuscleGroup === btn.dataset.muscle ? '' : btn.dataset.muscle;
    updateMuscleBtns('.edit-muscle-btn', editMuscleGroup);
  });
});

// ============================================================
// BACKUP — EXPORT / IMPORT
// ============================================================

document.getElementById('backup-btn').addEventListener('click', () => {
  document.getElementById('backup-modal').classList.remove('hidden');
});
document.getElementById('backup-modal-close').addEventListener('click', () => {
  document.getElementById('backup-modal').classList.add('hidden');
});

document.getElementById('delete-all-btn').addEventListener('click', () => {
  document.getElementById('backup-modal').classList.add('hidden');

  // 1段階目の警告
  if (!confirm('⚠️ 全データを削除します\n\n記録・種目・ジム時間がすべて消去されます。\nこの操作は取り消せません。\n\n続けますか？')) return;

  // 2段階目の確認（より強い警告）
  if (!confirm('🚨 最終確認\n\n本当に削除してよいですか？\nクラウド（Firestore）のデータも削除されます。\n\n「OK」を押すと即座に削除されます。')) return;

  // ローカルデータ削除
  save(KEYS.entries,     []);
  save(KEYS.exercises,   []);
  save(KEYS.gymTime,     {});
  save(KEYS.defaultUnit, 'kg');

  // Firestore も削除
  if (fsUser && fsDb) {
    const ts = firebase.firestore.FieldValue.serverTimestamp();
    Promise.all([
      fsUserRef('entries').set({ items: [], updatedAt: ts }),
      fsUserRef('exercises').set({ items: [], updatedAt: ts }),
      fsUserRef('settings').set({ defaultUnit: 'kg', gymTimes: {}, updatedAt: ts }),
    ]).catch(e => console.warn('Firestore delete failed:', e));
  }

  showToast('全データを削除しました');
  switchTab('today');
  renderToday();
});

document.getElementById('dedup-btn').addEventListener('click', () => {
  const before = getExercises().length;
  deduplicateExercises();
  const after = getExercises().length;
  const merged = before - after;
  const repaired = repairOrphanedExerciseIds();
  const total = merged + repaired;
  showToast(total > 0
    ? `修復完了: 重複統合 ${merged}件 / ID修復 ${repaired}件`
    : '問題は見つかりませんでした');
  document.getElementById('backup-modal').classList.add('hidden');
});
document.getElementById('backup-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('backup-modal')) {
    document.getElementById('backup-modal').classList.add('hidden');
  }
});

document.getElementById('export-btn').addEventListener('click', () => {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    entries: getEntries(),
    exercises: getExercises(),
    gymTimes: getGymTimes(),
    defaultUnit: getDefaultUnit(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = todayStr().replace(/-/g, '');
  a.href = url;
  a.download = `workout-backup-${dateStr}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('エクスポートしました！');
  document.getElementById('backup-modal').classList.add('hidden');
});

// インポートされた1エントリを検証・正規化する。壊れていれば null を返して取り込まない。
function sanitizeImportedEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date)) return null;
  if (!Array.isArray(raw.sets)) return null;

  const sets = raw.sets.map(s => {
    if (!s || typeof s !== 'object') return null;
    const weight = parseFloat(s.weight);
    const reps   = parseInt(s.reps);
    if (!isFinite(weight) || weight <= 0 || !isFinite(reps) || reps <= 0) return null;
    return { weight, unit: s.unit === 'lbs' ? 'lbs' : 'kg', reps };
  }).filter(Boolean);
  if (sets.length === 0) return null;

  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : genId(),
    date: raw.date,
    exerciseId: str(raw.exerciseId, 64) || genId(),
    exerciseName: str(raw.exerciseName, 200) || '(名称なし)',
    muscleGroup: MUSCLE_COLORS[raw.muscleGroup] ? raw.muscleGroup : '',
    sets,
    memo: str(raw.memo, 2000),
    gymIn: str(raw.gymIn, 5),
    gymOut: str(raw.gymOut, 5),
    createdAt: str(raw.createdAt, 40) || nowIso(),
    updatedAt: str(raw.updatedAt, 40) || str(raw.createdAt, 40) || nowIso(),
  };
}

document.getElementById('import-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!Array.isArray(data.entries) || !Array.isArray(data.exercises)) throw new Error('invalid');

      // 取り込む前に形を検証する。バックアップは他人から受け取ることもあり、
      // 検証なしで取り込むと壊れた値や細工された文字列がそのまま保存・同期される。
      const cleanEntries = data.entries.map(sanitizeImportedEntry).filter(Boolean);
      const cleanExercises = data.exercises
        .filter(x => x && typeof x.name === 'string' && x.name.trim())
        .map(x => ({
          id: typeof x.id === 'string' && x.id ? x.id : genId(),
          name: String(x.name).slice(0, 200),
          muscleGroups: Array.isArray(x.muscleGroups)
            ? x.muscleGroups.filter(m => MUSCLE_COLORS[m]) : [],
        }));

      const skipped = data.entries.length - cleanEntries.length;
      const msg = `${cleanEntries.length}件の記録をインポートします。現在のデータに追加されます。`
        + (skipped > 0 ? `\n\n（形式が不正な ${skipped} 件は取り込みません）` : '')
        + '\n\nよろしいですか？';
      if (!confirm(msg)) return;

      // Merge entries (avoid duplicates by id)
      const existingIds = new Set(getEntriesRaw().map(e => e.id));
      const newEntries = [...getEntries(), ...cleanEntries.filter(e => !existingIds.has(e.id))];
      saveEntries(newEntries);
      // Merge exercises
      const existingExNames = new Set(getExercises().map(e => e.name.toLowerCase()));
      const newExercises = [...getExercises(), ...cleanExercises.filter(e => !existingExNames.has(e.name.toLowerCase()))];
      saveExercises(newExercises);
      // Merge gym times
      const mergedTimes = { ...data.gymTimes, ...getGymTimes() };
      saveGymTimes(mergedTimes);
      deduplicateExercises();      // インポートで重複が生じた場合も除去
      repairOrphanedExerciseIds(); // インポートエントリの孤立IDも修復
      showToast(`${cleanEntries.length}件をインポートしました！`);
      document.getElementById('backup-modal').classList.add('hidden');
      switchTab('today');
    } catch {
      alert('ファイルの読み込みに失敗しました。正しいバックアップファイルを選択してください。');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
});

// ============================================================
// THEME TOGGLE
// ============================================================

const THEME_KEY = 'wt_theme';

function applyTheme(theme) {
  const isDark = theme !== 'light';
  // body.light-mode（CSS override用）と html[data-theme]（FOUC防止 & Mac対応）の両方を更新
  document.body.classList.toggle('light-mode', !isDark);
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
  }
  document.getElementById('theme-icon-sun').classList.toggle('hidden', !isDark);
  document.getElementById('theme-icon-moon').classList.toggle('hidden', isDark);
  localStorage.setItem(THEME_KEY, theme);
  // 部位色とグラフはテーマ依存なので描き直す（起動時の初回呼び出しでは何もしない）
  if (window.__wtBooted) {
    if (currentTab === 'today')   renderToday();
    if (currentTab === 'history') renderHistory();
    if (currentTab === 'graph')   renderGraphPage();
  }
}

// 保存された選択が無ければ OS のダーク／ライト設定に従う
function defaultTheme() {
  return (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches)
    ? 'light' : 'dark';
}

document.getElementById('theme-toggle-btn').addEventListener('click', () => {
  const current = localStorage.getItem(THEME_KEY) || defaultTheme();
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

// Apply saved theme immediately (before Firebase / render)
applyTheme(localStorage.getItem(THEME_KEY) || defaultTheme());

// ============================================================
// FIREBASE — AUTH & FIRESTORE SYNC
// ============================================================

let fsDb   = null;
let fsAuth = null;
let fsUser = null;
let fsSyncTimer    = null;
let fsUnsubscribe  = null;

// Called by every save* function — no-op until Firebase is ready
function scheduleFsSync() {
  if (!fsUser || !fsDb) return;
  clearTimeout(fsSyncTimer);
  fsSyncTimer = setTimeout(pushToFirestore, 800);
}

// 保留中のデバウンスを即座に送り切る。
// 保存直後にアプリを閉じると 800ms のタイマーが発火せず、その記録が
// 一度もサーバに届かないまま次回の pull で消えていた。
function flushFsSync() {
  if (!fsUser || !fsDb || !fsSyncTimer) return;
  clearTimeout(fsSyncTimer);
  fsSyncTimer = null;
  pushToFirestore();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushFsSync();
});
window.addEventListener('pagehide', flushFsSync);

function fsUserRef(doc) {
  return fsDb.collection('users').doc(fsUser.uid).collection('data').doc(doc);
}

// ------------------------------------------------------------
// マージ — id をキーに、新しい方を採用する
// ------------------------------------------------------------
// 以前は受信した配列でローカルを丸ごと置き換えていたため、
//   ・オフラインで記録 → 次回サインイン時の pull でその日の記録が消える
//   ・古い配列を持った2台目が保存すると、新しい記録が巻き戻る
// という消失が起きていた。id 単位でマージすれば、どちらの側にしか無い記録も残る。
function entryStamp(e) { return e.updatedAt || e.createdAt || ''; }

function mergeEntries(localRaw, remoteRaw) {
  const byId = new Map();
  for (const e of localRaw || []) {
    if (e && e.id) byId.set(e.id, e);
  }
  for (const r of remoteRaw || []) {
    if (!r || !r.id) continue;
    const l = byId.get(r.id);
    // タイムスタンプが無い旧データ同士は、ローカルを優先して不用意な巻き戻しを避ける
    if (!l || entryStamp(r) > entryStamp(l)) byId.set(r.id, r);
  }
  return [...byId.values()];
}

function sameItems(a, b) {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

async function pullFromFirestore() {
  try {
    const [eSnap, xSnap, sSnap] = await Promise.all([
      fsUserRef('entries').get(),
      fsUserRef('exercises').get(),
      fsUserRef('settings').get(),
    ]);
    let needPush = false;
    if (eSnap.exists && eSnap.data().items) {
      const remote = eSnap.data().items;
      const merged = mergeEntries(getEntriesRaw(), remote);
      saveEntriesRaw(merged);
      // ローカルにしか無い記録があった場合は、こちらから送り返す
      if (!sameItems(merged, remote)) needPush = true;
    } else if (getEntries().length > 0) {
      // Firestore が空でローカルにデータがある（初回ログイン等）
      needPush = true;
    }
    if (xSnap.exists && xSnap.data().items) save(KEYS.exercises, xSnap.data().items);
    if (sSnap.exists) {
      const s = sSnap.data();
      if (s.defaultUnit) save(KEYS.defaultUnit, s.defaultUnit);
      if (s.gymTimes)    save(KEYS.gymTime,     s.gymTimes);
    }
    if (needPush) await pushToFirestore();
  } catch(e) {
    console.warn('Firestore pull failed:', e);
    showSyncError('クラウドからの読み込みに失敗しました');
  }
}

async function pushToFirestore() {
  if (!fsUser || !fsDb) return;
  showSyncIndicator(true);
  try {
    const ts = firebase.firestore.FieldValue.serverTimestamp();
    await Promise.all([
      // tombstone も送る（削除を他端末へ伝えるため）
      fsUserRef('entries').set({ items: getEntriesRaw(), updatedAt: ts }),
      fsUserRef('exercises').set({ items: getExercises(), updatedAt: ts }),
      fsUserRef('settings').set({ defaultUnit: getDefaultUnit(), gymTimes: getGymTimes(), updatedAt: ts }),
    ]);
    clearSyncError();
  } catch(e) {
    console.warn('Firestore push failed:', e);
    // 静かに失敗させない。ここが無言だと、上限超過や権限エラーに気づけない
    showSyncError('クラウドへの保存に失敗しました。バックアップを取ってください');
  }
  showSyncIndicator(false);
}

function setupRealtimeListener() {
  if (fsUnsubscribe) fsUnsubscribe();
  fsUnsubscribe = fsUserRef('entries').onSnapshot((snap) => {
    // Only process updates from the server (not our own pending writes)
    if (snap.metadata.hasPendingWrites || !snap.exists) return;
    const items = snap.data().items;
    if (!items) return;
    const before = getEntriesRaw();
    const merged = mergeEntries(before, items);
    if (sameItems(before, merged)) return;   // 変化なしなら再描画もしない
    saveEntriesRaw(merged);
    if (currentTab === 'today')   renderToday();
    if (currentTab === 'history') renderHistory();
  });
}

function showSyncIndicator(on) {
  document.getElementById('sync-indicator').classList.toggle('hidden', !on);
}

function showSyncError(msg) {
  const bar = document.getElementById('sync-error');
  if (!bar) return;
  document.getElementById('sync-error-msg').textContent = msg;
  bar.classList.remove('hidden');
}

function clearSyncError() {
  const bar = document.getElementById('sync-error');
  if (bar) bar.classList.add('hidden');
}

document.getElementById('sync-error-close')?.addEventListener('click', clearSyncError);

function updateMenuUserSection(user) {
  const userSection  = document.getElementById('menu-user-section');
  const loginBtn     = document.getElementById('menu-login-btn');
  const menuPhoto    = document.getElementById('menu-user-photo');
  const menuName     = document.getElementById('menu-user-name');
  const menuEmail    = document.getElementById('menu-user-email');
  const headerPhoto  = document.getElementById('user-photo');

  if (user) {
    userSection.classList.remove('hidden');
    loginBtn.classList.add('hidden');
    if (user.photoURL) {
      menuPhoto.src   = user.photoURL;
      headerPhoto.src = user.photoURL;
      headerPhoto.classList.remove('hidden');
    }
    menuName.textContent  = user.displayName || '';
    menuEmail.textContent = user.email || '';
  } else {
    userSection.classList.add('hidden');
    loginBtn.classList.remove('hidden');
    headerPhoto.classList.add('hidden');
  }
}

function initFirebase() {
  try {
    fsDb   = firebase.firestore();
    fsAuth = firebase.auth();
  } catch(e) {
    // Firebase not configured — run in local-only mode
    console.info('Firebase not configured, running in local-only mode.');
    return;
  }

  // Handle redirect result (iOS Safari uses redirect instead of popup)
  fsAuth.getRedirectResult().catch(() => {});

  fsAuth.onAuthStateChanged(async (user) => {
    if (user) {
      fsUser = user;
      updateMenuUserSection(user);
      document.getElementById('login-overlay').classList.add('hidden');
      await pullFromFirestore();
      deduplicateExercises();       // 同名種目の統合
      repairOrphanedExerciseIds();  // 孤立IDの修復
      setupRealtimeListener();
      currentUnit = getDefaultUnit();
      renderToday();
    } else {
      fsUser = null;
      if (fsUnsubscribe) { fsUnsubscribe(); fsUnsubscribe = null; }
      updateMenuUserSection(null);
      // Show login overlay only if Firebase is properly configured
      if (!firebaseConfig.apiKey.startsWith('REPLACE_')) {
        document.getElementById('login-overlay').classList.remove('hidden');
      }
    }
  });
}

// Google sign-in
document.getElementById('google-signin-btn')?.addEventListener('click', async () => {
  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    await fsAuth.signInWithPopup(provider);
  } catch(e) {
    // Popup blocked (common on iOS) → fall back to redirect
    fsAuth.signInWithRedirect(provider);
  }
});

document.getElementById('menu-login-btn')?.addEventListener('click', async () => {
  document.getElementById('backup-modal').classList.add('hidden');
  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    await fsAuth.signInWithPopup(provider);
  } catch(e) {
    fsAuth.signInWithRedirect(provider);
  }
});

document.getElementById('signout-btn')?.addEventListener('click', () => {
  if (confirm('ログアウトしますか？\nデータはこの端末に残ります。')) {
    fsAuth.signOut();
    document.getElementById('backup-modal').classList.add('hidden');
  }
});

document.getElementById('skip-login-btn')?.addEventListener('click', () => {
  document.getElementById('login-overlay').classList.add('hidden');
});

// ============================================================
// SERVICE WORKER
// ============================================================

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// ============================================================
// INIT
// ============================================================

// ============================================================
// 種目重複除去（同じ名前の種目を統合 & エントリのexerciseIdを修正）
// ============================================================
function deduplicateExercises() {
  const exercises = getExercises();
  if (exercises.length === 0) return;

  // 名前（小文字）でグループ化
  const groups = {};
  exercises.forEach(ex => {
    const key = ex.name.trim().toLowerCase();
    if (!groups[key]) groups[key] = [];
    groups[key].push(ex);
  });

  // 重複があるグループだけ処理
  const duplicateGroups = Object.values(groups).filter(g => g.length > 1);
  if (duplicateGroups.length === 0) return;

  // 各グループで「代表」を選ぶ（最も多くのmuscleGroupsを持つものを優先、同数なら最初）
  const idRemap = {}; // 旧ID → 代表ID のマップ
  const survivingIds = new Set();

  duplicateGroups.forEach(group => {
    // muscleGroups の数が多いものを代表に
    group.sort((a, b) => (b.muscleGroups || []).length - (a.muscleGroups || []).length);
    const primary = group[0];
    survivingIds.add(primary.id);

    // 代表のmuscleGroupsに他のグループの情報もマージ
    const mergedMuscles = [...new Set(group.flatMap(ex => ex.muscleGroups || []))];
    primary.muscleGroups = mergedMuscles;

    // 2番目以降を代表IDにリマップ
    group.slice(1).forEach(ex => {
      idRemap[ex.id] = primary.id;
    });
  });

  // 重複を除いた exercises リストを保存
  const cleanExercises = exercises.filter(ex =>
    !Object.keys(idRemap).includes(ex.id)
  );
  // 代表のmuscleGroupsも更新
  duplicateGroups.forEach(group => {
    const primary = group[0];
    const idx = cleanExercises.findIndex(ex => ex.id === primary.id);
    if (idx !== -1) cleanExercises[idx] = primary;
  });
  saveExercises(cleanExercises);

  // エントリのexerciseIdを修正（重複統合によるリマップ）
  const entries = getEntries();
  let changed = false;
  const fixedEntries = entries.map(e => {
    if (idRemap[e.exerciseId]) {
      changed = true;
      return { ...e, exerciseId: idRemap[e.exerciseId] };
    }
    return e;
  });
  if (changed) saveEntries(fixedEntries);

  console.log(`[dedup] ${duplicateGroups.length}件の重複種目を統合しました`);
}

// 孤立exerciseId修復: exercises リストに存在しないIDを持つエントリを種目名で突合して修正
function repairOrphanedExerciseIds() {
  const exercises = getExercises();
  if (exercises.length === 0) return 0;

  const idSet     = new Set(exercises.map(ex => ex.id));
  const nameToId  = {};
  exercises.forEach(ex => { nameToId[ex.name.trim().toLowerCase()] = ex.id; });

  const entries = getEntries();
  let repaired = 0;
  const fixed = entries.map(e => {
    if (idSet.has(e.exerciseId)) return e; // IDが正常に存在する
    // 孤立ID → 種目名でマッチング
    const matchId = nameToId[e.exerciseName?.trim().toLowerCase()];
    if (matchId) {
      repaired++;
      return { ...e, exerciseId: matchId };
    }
    return e;
  });
  if (repaired > 0) saveEntries(fixed);
  console.log(`[repair] ${repaired}件のエントリのexerciseIdを修復しました`);
  return repaired;
}

/* ============================================================
   数値キーパッド（自前実装）
   - iOS標準テンキーは「小数点＝左下 / ⌫＝右下」で押し間違えるため置き換え
   - 本キーパッド: ⌫＝右上（値表示の隣） / 小数点＝右下
   - 入力欄は readonly + inputmode=none にしてOSキーボードを出さない
     （＝フォーカス時のズームも起きないので保存ボタンが隠れない）
   ============================================================ */
const numpad = {
  el: null, valueEl: null, labelEl: null, dotEl: null,
  target: null,        // 入力中の <input>
  buf: '',             // 表示中の文字列
  allowDecimal: true,
  fresh: false,        // 開いた直後（最初の数字入力で全置換）
};

function numpadEls() {
  if (!numpad.el) {
    numpad.el      = document.getElementById('numpad');
    numpad.valueEl = document.getElementById('numpad-value');
    numpad.labelEl = document.getElementById('numpad-label');
    numpad.dotEl   = document.getElementById('numpad-dot');
  }
  return numpad.el;
}

function openNumpad(input) {
  if (!numpadEls()) return;
  if (numpad.target && numpad.target !== input) {
    if (numpad.target.isConnected) commitNumpad(true);   // 別の欄へ移るときも末尾の「.」を整える
    numpad.target.classList.remove('numpad-active');
  }

  numpad.target       = input;
  numpad.allowDecimal = input.dataset.numpad !== 'numeric';
  numpad.buf          = String(input.value || '');
  numpad.fresh        = numpad.buf !== '';

  input.classList.add('numpad-active');
  numpad.labelEl.textContent = input.dataset.numpadLabel || '数値';
  numpad.dotEl.classList.toggle('opacity-30', !numpad.allowDecimal);
  numpad.dotEl.classList.toggle('pointer-events-none', !numpad.allowDecimal);

  numpad.el.classList.remove('hidden');
  document.body.classList.add('numpad-open');
  renderNumpadValue();

  // 入力中の行がキーパッドに隠れないようスクロール（レイアウト確定後にもう一度）
  scrollInputAboveNumpad(input);
  setTimeout(() => scrollInputAboveNumpad(input), 0);
}

function scrollInputAboveNumpad(input) {
  const cont = input.closest('#edit-scroll') || document.getElementById('content');
  if (!cont) return;
  const padTop  = numpad.el.getBoundingClientRect().top;
  const contTop = cont.getBoundingClientRect().top;
  const r = input.getBoundingClientRect();
  const overlap = r.bottom - (padTop - 16);   // キーパッドに掛かっている量
  if (overlap > 0)              cont.scrollTop += overlap;
  else if (r.top < contTop + 8) cont.scrollTop -= (contTop + 8 - r.top);
}

function closeNumpad() {
  if (!numpad.el || numpad.el.classList.contains('hidden')) return;
  if (numpad.target && numpad.target.isConnected) commitNumpad(true);
  if (numpad.target) numpad.target.classList.remove('numpad-active');
  numpad.target = null;
  numpad.el.classList.add('hidden');
  document.body.classList.remove('numpad-open');
}

function renderNumpadValue() {
  numpad.valueEl.textContent = numpad.buf === '' ? '0' : numpad.buf;
  numpad.valueEl.classList.toggle('is-fresh', numpad.fresh);
}

// 入力欄へ反映（既存の input リスナーに拾わせるためイベントも発火）
function commitNumpad(final) {
  if (!numpad.target) return;
  let v = numpad.buf;
  if (final) {
    if (v.endsWith('.')) v = v.slice(0, -1);
    if (v === '.' || v === '') v = '';
    numpad.buf = v;
  }
  numpad.target.value = v;
  numpad.target.dispatchEvent(new Event('input', { bubbles: true }));
}

function numpadPress(key) {
  if (!numpad.target) return;

  if (key === 'back') {
    numpad.fresh = false;
    numpad.buf = numpad.buf.slice(0, -1);
  } else if (key === '.') {
    if (!numpad.allowDecimal) return;
    if (numpad.fresh) { numpad.buf = '0'; numpad.fresh = false; }
    if (numpad.buf.includes('.')) return;
    numpad.buf = (numpad.buf === '' ? '0' : numpad.buf) + '.';
  } else {
    // 数字: 開いた直後の最初の1打は上書き（打ち直しが多いため）
    if (numpad.fresh) { numpad.buf = ''; numpad.fresh = false; }
    if (numpad.buf.replace('.', '').length >= 6) return;
    if (numpad.buf === '0') numpad.buf = '';
    numpad.buf += key;
  }
  renderNumpadValue();
  commitNumpad(false);
}

// 数値欄タップでキーパッドを開く
document.addEventListener('click', (e) => {
  const inp = e.target.closest('input.num-input');
  if (inp) { openNumpad(inp); return; }
  if (!numpad.el || numpad.el.classList.contains('hidden')) return;
  if (e.target.closest('#numpad')) return;
  closeNumpad();
});

document.addEventListener('DOMContentLoaded', bindNumpadKeys);
if (document.readyState !== 'loading') bindNumpadKeys();

function bindNumpadKeys() {
  if (!numpadEls() || numpad.el.dataset.bound) return;
  numpad.el.dataset.bound = '1';
  numpad.el.querySelectorAll('[data-np]').forEach(btn => {
    btn.addEventListener('click', () => numpadPress(btn.dataset.np));
  });
  document.getElementById('numpad-back').addEventListener('click', () => numpadPress('back'));
  document.getElementById('numpad-done').addEventListener('click', closeNumpad);
}

// Mac（物理キーボード）でもそのまま打てるように
document.addEventListener('keydown', (e) => {
  if (!numpad.target) return;
  if (/^[0-9]$/.test(e.key))      { numpadPress(e.key); e.preventDefault(); }
  else if (e.key === '.')         { numpadPress('.');   e.preventDefault(); }
  else if (e.key === 'Backspace') { numpadPress('back'); e.preventDefault(); }
  else if (e.key === 'Enter' || e.key === 'Escape') { closeNumpad(); e.preventDefault(); }
});

(function init() {
  deduplicateExercises();  // 起動時に重複種目を自動統合
  currentUnit = getDefaultUnit();
  window.__wtBooted = true;
  switchTab('today');  // Show app immediately with local data
  initFirebase();      // Then connect Firebase in background
})();
