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

function getEntries() { return load(KEYS.entries, []); }
function saveEntries(e)   { save(KEYS.entries, e);   scheduleFsSync(); }

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
// MUSCLE COLOR MAP
// ============================================================

const MUSCLE_COLORS = {
  //                                                                           ダーク用テキスト  ライト用テキスト（濃色）
  '胸':  { activeBg: '#dc2626', border: '#dc2626', tagBg: 'rgba(220,38,38,0.18)', tagBorder: '#dc2626', tagText: '#fca5a5', tagTextLight: '#991b1b' },
  '背中': { activeBg: '#2563eb', border: '#2563eb', tagBg: 'rgba(37,99,235,0.18)',  tagBorder: '#2563eb', tagText: '#93c5fd', tagTextLight: '#1e40af' },
  '脚':  { activeBg: '#16a34a', border: '#16a34a', tagBg: 'rgba(22,163,74,0.18)',  tagBorder: '#16a34a', tagText: '#86efac', tagTextLight: '#14532d' },
  '肩':  { activeBg: '#ca8a04', border: '#ca8a04', tagBg: 'rgba(202,138,4,0.18)',  tagBorder: '#ca8a04', tagText: '#fde68a', tagTextLight: '#78350f' },
  '腕':  { activeBg: '#9333ea', border: '#9333ea', tagBg: 'rgba(147,51,234,0.18)', tagBorder: '#9333ea', tagText: '#d8b4fe', tagTextLight: '#581c87' },
  '腹':  { activeBg: '#0d9488', border: '#0d9488', tagBg: 'rgba(13,148,136,0.18)', tagBorder: '#0d9488', tagText: '#5eead4', tagTextLight: '#134e4a' },
};

function muscleTagHtml(muscle) {
  if (!muscle) return '';
  const c = MUSCLE_COLORS[muscle];
  if (c) {
    const isLight = document.body.classList.contains('light-mode');
    const textColor = isLight ? c.tagTextLight : c.tagText;
    return `<span class="inline-block text-xs font-semibold px-2 py-0.5 rounded-full ml-1" style="background:${c.tagBg};border:1px solid ${c.tagBorder};color:${textColor}">${muscle}</span>`;
  }
  return `<span class="inline-block text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-900 text-indigo-300 ml-1">${muscle}</span>`;
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
};

function switchTab(tab) {
  currentTab = tab;
  document.getElementById('page-title').textContent = tabTitles[tab];

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + tab).classList.add('active');

  document.querySelectorAll('.tab-btn').forEach(btn => {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle('text-indigo-400', active);
    btn.classList.toggle('text-gray-500', !active);
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
      btn.style.cssText = `background-color:${c.activeBg};border-color:${c.activeBg};color:#fff;`;
    } else {
      btn.style.cssText = `background-color:${c.activeBg}22;border-color:${c.border};color:${c.activeBg};`;
    }
  });
}

// 部位の種目提案カードを描画
function renderTodaySuggestions(muscleGroup) {
  const container = document.getElementById('today-suggestion-cards');
  container.innerHTML = '';
  if (!muscleGroup) return;

  const suggestions = getSuggestionsForMuscle(muscleGroup);
  if (suggestions.length === 0) {
    container.innerHTML = `<div class="text-center py-8 text-gray-600 text-sm">この部位の記録がまだありません</div>`;
    return;
  }

  suggestions.forEach(entry => {
    const unit = entry.sets[0]?.unit || 'kg';
    const card = document.createElement('div');
    card.className = 'bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden';
    card.dataset.exerciseId   = entry.exerciseId || '';
    card.dataset.exerciseName = entry.exerciseName;
    card.dataset.unit         = unit;

    const setsHtml = entry.sets.map((s, i) => buildSetRowHtml(i, s.weight, unit, s.reps)).join('');

    card.innerHTML = `
      <div class="flex items-center justify-between px-4 pt-4 pb-3">
        <span class="font-bold text-white text-base">${entry.exerciseName}</span>
        <button class="save-card-btn px-4 py-1.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl transition-colors active:bg-indigo-700">保存</button>
      </div>
      <div class="sets-list px-4 pb-2 space-y-1">${setsHtml}</div>
      <div class="px-4 pb-3 flex items-center gap-4">
        <button class="add-set-btn text-xs text-indigo-400 font-medium">＋ セット追加</button>
      </div>`;

    container.appendChild(card);

    card.querySelector('.save-card-btn').addEventListener('click', () => saveTodayCard(card, muscleGroup));
    card.querySelector('.add-set-btn').addEventListener('click', () => addSetToTodayCard(card));
    card.querySelectorAll('.remove-set-btn').forEach(btn =>
      btn.addEventListener('click', () => { btn.closest('.set-row').remove(); renumberTodaySets(card); })
    );
  });
}

function buildSetRowHtml(idx, weight, unit, reps) {
  return `
    <div class="set-row flex items-center gap-2 py-1" data-idx="${idx}">
      <span class="set-label text-xs text-gray-500 w-12 flex-shrink-0">セット${idx + 1}</span>
      <input type="number" inputmode="decimal" value="${weight}" step="0.5"
        class="set-weight w-16 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-sm text-center focus:outline-none focus:border-indigo-500">
      <span class="text-xs text-gray-400">${unit} ×</span>
      <input type="number" inputmode="numeric" value="${reps}"
        class="set-reps w-14 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-sm text-center focus:outline-none focus:border-indigo-500">
      <span class="text-xs text-gray-400">回</span>
      <button class="remove-set-btn text-gray-600 text-lg leading-none ml-auto px-1">×</button>
    </div>`;
}

function addSetToTodayCard(card) {
  const list = card.querySelector('.sets-list');
  const rows = list.querySelectorAll('.set-row');
  const lastRow = rows[rows.length - 1];
  const lastWeight = lastRow ? lastRow.querySelector('.set-weight').value : '';
  const lastReps   = lastRow ? lastRow.querySelector('.set-reps').value : '';
  const unit = card.dataset.unit || 'kg';
  const idx  = rows.length;

  const tmp = document.createElement('div');
  tmp.innerHTML = buildSetRowHtml(idx, lastWeight, unit, lastReps);
  const newRow = tmp.firstElementChild;
  newRow.querySelector('.remove-set-btn').addEventListener('click', () => {
    newRow.remove(); renumberTodaySets(card);
  });
  list.appendChild(newRow);
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

  const entry = {
    id: genId(),
    date: today,
    exerciseId: ex.id,
    exerciseName,
    muscleGroup,
    sets,
    memo: '',
    gymIn: todayTime.in || '',
    gymOut: todayTime.out || '',
    createdAt: new Date().toISOString(),
  };
  const entries = getEntries();
  entries.push(entry);
  saveEntries(entries);

  // カードを保存済み状態に
  const saveBtn = card.querySelector('.save-card-btn');
  saveBtn.textContent = '✓ 保存済み';
  saveBtn.classList.replace('bg-indigo-600', 'bg-green-700');
  saveBtn.disabled = true;
  card.querySelectorAll('input').forEach(inp => inp.disabled = true);
  card.querySelectorAll('.remove-set-btn, .add-set-btn').forEach(b => b.classList.add('hidden'));
  card.classList.add('opacity-60');

  renderTodaySummary();
  showToast(`${exerciseName} を保存しました`);
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

  const totalVol = entry.sets.reduce((s, set) => s + set.weight * set.reps, 0);
  const maxW = Math.max(...entry.sets.map(s => s.weight));
  const unit = entry.sets[0]?.unit || 'kg';

  const setsHtml = entry.sets.map((s, i) =>
    `<div class="flex items-center gap-3 py-1">
      <span class="text-xs text-gray-600 w-12">セット${i + 1}</span>
      <span class="text-sm font-semibold text-white">${s.weight}${s.unit}</span>
      <span class="text-xs text-gray-500">×</span>
      <span class="text-sm font-semibold text-white">${s.reps}回</span>
    </div>`
  ).join('');

  const memoHtml = entry.memo
    ? `<div class="mt-2 pt-2 border-t border-gray-800 text-xs text-gray-500 leading-relaxed whitespace-pre-wrap">${entry.memo}</div>`
    : '';

  card.innerHTML = `
    <div class="flex items-start justify-between mb-3">
      <div class="flex-1 min-w-0">
        <div class="flex items-center flex-wrap gap-1">
          <span class="text-base font-bold text-white">${entry.exerciseName}</span>${muscleTagHtml(entry.muscleGroup)}
        </div>
        <div class="text-xs text-gray-500 mt-0.5">${entry.sets.length}セット</div>
      </div>
      <div class="text-right ml-3">
        <div class="text-xs text-gray-500">最大</div>
        <div class="text-sm font-bold text-indigo-400">${maxW}${unit}</div>
      </div>
    </div>
    <div class="border-t border-gray-800 pt-2">${setsHtml}</div>
    <div class="flex items-center justify-between mt-2 pt-2 border-t border-gray-800">
      <span class="text-xs text-gray-600">総ボリューム: <span class="text-gray-400 font-semibold">${totalVol.toFixed(1)}${unit}</span></span>
      ${showActions ? `
        <div class="flex items-center gap-3">
          <button class="text-xs text-indigo-400 font-medium edit-entry-btn" data-id="${entry.id}">編集</button>
          <button class="text-xs text-red-500 font-medium delete-entry-btn" data-id="${entry.id}">削除</button>
        </div>` : ''}
    </div>
    ${memoHtml}
  `;

  if (showActions) {
    card.querySelector('.edit-entry-btn').addEventListener('click', () => {
      openEditModal(entry.id);
    });
    card.querySelector('.delete-entry-btn').addEventListener('click', () => {
      if (confirm(`「${entry.exerciseName}」の記録を削除しますか？`)) {
        const entries = getEntries().filter(e => e.id !== entry.id);
        saveEntries(entries);
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
    const base = 'px-4 py-2.5 rounded-xl text-sm font-semibold border transition-colors';
    const cls = btn.classList.contains('edit-muscle-btn') ? 'edit-muscle-btn' : 'muscle-btn';
    btn.className = `${cls} ${base}`;
    const c = MUSCLE_COLORS[btn.dataset.muscle];
    if (active && c) {
      btn.style.backgroundColor = c.activeBg;
      btn.style.borderColor     = c.border;
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
  if (mc) label.style.color = mc.activeBg;
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
        <span class="font-semibold text-sm text-white leading-tight">${entry.exerciseName}</span>
        <span class="text-xs text-gray-500 flex-shrink-0">${dateStr}</span>
      </div>
      <div class="text-xs text-gray-400 mt-0.5 leading-relaxed">${setsStr}</div>
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

  // 単位を合わせる（最初のセットの単位を採用）
  if (entry.sets && entry.sets.length > 0) {
    const unit = entry.sets[0].unit || currentUnit;
    if (unit !== currentUnit) {
      currentUnit = unit;
      saveDefaultUnit(currentUnit);
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
  const container = document.getElementById('sets-container');
  container.innerHTML = '';
  sets.forEach((set, i) => {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-2';
    row.innerHTML = `
      <span class="text-xs text-gray-500 w-14 flex-shrink-0">セット${i + 1}</span>
      <div class="flex-1 relative">
        <input
          type="number"
          inputmode="decimal"
          placeholder="重量"
          value="${set.weight}"
          data-set="${i}"
          data-field="weight"
          class="set-weight w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2.5 text-white text-sm text-right pr-10 focus:outline-none focus:border-indigo-500"
        />
        <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">${currentUnit}</span>
      </div>
      <span class="text-gray-600">×</span>
      <div class="flex-1 relative">
        <input
          type="number"
          inputmode="numeric"
          placeholder="回数"
          value="${set.reps}"
          data-set="${i}"
          data-field="reps"
          class="set-reps w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2.5 text-white text-sm text-right pr-8 focus:outline-none focus:border-indigo-500"
        />
        <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">回</span>
      </div>
      ${sets.length > 1 ? `<button class="remove-set-btn flex-shrink-0 text-gray-600 hover:text-red-500 text-lg leading-none transition-colors" data-set="${i}">×</button>` : '<div class="w-5 flex-shrink-0"></div>'}
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
      const idx = parseInt(btn.dataset.set);
      sets.splice(idx, 1);
      renderSets();
    });
  });
}

document.getElementById('add-set-btn').addEventListener('click', () => {
  if (sets.length >= 5) return;
  sets.push({ weight: '', reps: '' });
  renderSets();
  if (sets.length >= 5) {
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
    addNew.innerHTML = `<span class="text-indigo-500">+</span> 「${query}」を追加`;
    addNew.addEventListener('click', () => {
      exerciseInput.value = query;
      exerciseDropdown.classList.add('hidden');
    });
    exerciseDropdown.appendChild(addNew);
  }

  // Section header when muscle filter is active
  if (currentMuscleGroup && muscleMatches.length > 0) {
    const label = document.createElement('div');
    label.className = 'px-4 pt-2 pb-1 text-xs font-bold text-gray-500 uppercase tracking-wider';
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
    div.className = 'px-4 pt-2 pb-1 text-xs font-bold text-gray-500 uppercase tracking-wider border-t border-gray-700 mt-1';
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

  const entry = {
    id: genId(),
    date,
    gymIn,
    gymOut,
    exerciseId: matchExercise?.id || genId(),
    exerciseName: matchExercise?.name || exerciseName,
    muscleGroup: currentMuscleGroup,
    sets: validSets,
    memo,
    createdAt: new Date().toISOString(),
  };

  const entries = getEntries();
  entries.push(entry);
  saveEntries(entries);

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

function showToast(msg) {
  const toast = document.createElement('div');
  toast.className = 'fixed top-16 left-1/2 -translate-x-1/2 bg-indigo-600 text-white text-sm font-semibold px-5 py-2.5 rounded-full shadow-lg z-50 transition-opacity';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 2000);
}

// ============================================================
// HISTORY PAGE
// ============================================================

function renderHistory() {
  // Update toggle button styles
  document.getElementById('history-list-btn').className =
    `history-view-btn px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${historyViewMode === 'list' ? 'bg-indigo-600 text-white' : 'text-gray-500'}`;
  document.getElementById('history-cal-btn').className =
    `history-view-btn px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${historyViewMode === 'calendar' ? 'bg-indigo-600 text-white' : 'text-gray-500'}`;

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
    btn.className = 'flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors';
    btn.dataset.muscle = m;
    btn.textContent = m || 'すべて';
    const isActive = historyMuscleFilter === m;
    if (isActive) {
      const c = MUSCLE_COLORS[m];
      btn.style.backgroundColor = c ? c.activeBg : '#4f46e5';
      btn.style.borderColor     = c ? c.border    : '#4f46e5';
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
        <div class="text-xs text-gray-500 mt-0.5">${dateEntries.length}種目 ${gt.in ? `• ${gt.in}〜${gt.out || '?'}` : ''}</div>
      </div>
      <svg class="toggle-icon w-4 h-4 text-gray-500 transition-transform flex-shrink-0 ml-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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
    <button id="cal-prev" class="w-10 h-10 flex items-center justify-center rounded-full bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors text-xl font-light">‹</button>
    <span class="text-base font-bold text-white">${calendarYear}年${monthNames[calendarMonth]}</span>
    <button id="cal-next" class="w-10 h-10 flex items-center justify-center rounded-full bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors text-xl font-light">›</button>
  `;
  cal.appendChild(nav);

  // Day-of-week headers
  const dayLabels = ['日','月','火','水','木','金','土'];
  const headerRow = document.createElement('div');
  headerRow.className = 'grid grid-cols-7 mb-2';
  dayLabels.forEach((d, i) => {
    const cell = document.createElement('div');
    cell.className = `text-center text-xs font-semibold py-1 ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-500'}`;
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
      numCls += ' text-gray-500';
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
    <span class="text-xs text-gray-600">今月のトレーニング</span>
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
      <span class="text-xs text-gray-600 ml-auto">${selEntries.length}種目${gt.in ? ` • ${gt.in}〜${gt.out || '?'}` : ''}</span>
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

function renderGraphPage() {
  renderGraphMusclePills();
  renderGraphExerciseSelect();
  renderGraph();
}

function renderGraphMusclePills() {
  const pillContainer = document.getElementById('graph-muscle-pills');
  pillContainer.innerHTML = '';
  const muscles = ['', '胸', '背中', '脚', '肩', '腕', '腹'];
  muscles.forEach(m => {
    const btn = document.createElement('button');
    btn.className = 'flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors';
    btn.dataset.muscle = m;
    btn.textContent = m || 'すべて';
    const isActive = graphMuscleFilter === m;
    if (isActive) {
      const c = MUSCLE_COLORS[m];
      btn.style.backgroundColor = c ? c.activeBg : '#4f46e5';
      btn.style.borderColor     = c ? c.border    : '#4f46e5';
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

  // Build data points per date (take max per date)
  const byDate = {};
  entries.forEach(entry => {
    const maxW = Math.max(...entry.sets.map(s => s.weight));
    const volume = entry.sets.reduce((s, set) => s + set.weight * set.reps, 0);
    const unit = entry.sets[0]?.unit || 'kg';
    if (!byDate[entry.date]) {
      byDate[entry.date] = { maxW, volume, unit };
    } else {
      byDate[entry.date].maxW = Math.max(byDate[entry.date].maxW, maxW);
      byDate[entry.date].volume = Math.max(byDate[entry.date].volume, volume);
    }
  });

  const sortedDates = Object.keys(byDate).sort();
  const dataPoints = sortedDates.map(d => ({
    date: d,
    value: graphMode === 'weight' ? byDate[d].maxW : byDate[d].volume,
    unit: byDate[d].unit,
  }));

  // Draw chart using Canvas API
  drawLineChart(canvas, dataPoints);

  // Stats
  const values = dataPoints.map(p => p.value);
  const maxVal = Math.max(...values);
  const latestVal = values[values.length - 1];
  const firstVal = values[0];
  const diff = latestVal - firstVal;
  const unit = dataPoints[dataPoints.length - 1]?.unit || 'kg';

  statsEl.innerHTML = `
    <div class="bg-gray-800 rounded-xl p-3 text-center">
      <div class="text-xs text-gray-500 mb-1">最大</div>
      <div class="text-sm font-bold text-indigo-400">${maxVal.toFixed(1)}<span class="text-xs text-gray-500">${unit}</span></div>
    </div>
    <div class="bg-gray-800 rounded-xl p-3 text-center">
      <div class="text-xs text-gray-500 mb-1">最新</div>
      <div class="text-sm font-bold text-white">${latestVal.toFixed(1)}<span class="text-xs text-gray-500">${unit}</span></div>
    </div>
    <div class="bg-gray-800 rounded-xl p-3 text-center">
      <div class="text-xs text-gray-500 mb-1">増減</div>
      <div class="text-sm font-bold ${diff >= 0 ? 'text-green-400' : 'text-red-400'}">${diff >= 0 ? '+' : ''}${diff.toFixed(1)}<span class="text-xs opacity-75">${unit}</span></div>
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

  const xScale = (i) => padL + (i / Math.max(dataPoints.length - 1, 1)) * chartW;
  const yScale = (v) => padT + chartH - ((v - minV) / range) * chartH;

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padT + (i / 4) * chartH;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + chartW, y);
    ctx.stroke();

    // Y labels
    const val = maxV - (i / 4) * range;
    ctx.fillStyle = 'rgba(156,163,175,0.7)';
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

  // X labels (show up to 5)
  ctx.fillStyle = 'rgba(156,163,175,0.7)';
  ctx.font = `9px -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  const step = Math.max(1, Math.ceil(dataPoints.length / 5));
  dataPoints.forEach((p, i) => {
    if (i % step === 0 || i === dataPoints.length - 1) {
      const x = xScale(i);
      const parts = p.date.split('-');
      ctx.fillText(`${parts[1]}/${parts[2]}`, x, padT + chartH + 18);
    }
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
// EDIT ENTRY MODAL
// ============================================================

function openEditModal(id) {
  const entry = getEntries().find(e => e.id === id);
  if (!entry) return;
  editingEntryId = id;
  editSets = entry.sets.map(s => ({ weight: String(s.weight), reps: String(s.reps) }));
  editUnit = entry.sets[0]?.unit || 'kg';
  editMuscleGroup = entry.muscleGroup || '';

  document.getElementById('edit-exercise-display').textContent = entry.exerciseName;
  document.getElementById('edit-memo').value = entry.memo || '';
  updateEditUnitButtons();
  updateMuscleBtns('.edit-muscle-btn', editMuscleGroup);
  renderEditSets();
  document.getElementById('edit-modal').classList.remove('hidden');
}

function closeEditModal() {
  document.getElementById('edit-modal').classList.add('hidden');
  editingEntryId = null;
}

function renderEditSets() {
  const container = document.getElementById('edit-sets-container');
  container.innerHTML = '';
  editSets.forEach((set, i) => {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-2';
    row.innerHTML = `
      <span class="text-xs text-gray-500 w-14 flex-shrink-0">セット${i + 1}</span>
      <div class="flex-1 relative">
        <input type="number" inputmode="decimal" placeholder="重量"
          value="${set.weight}" data-set="${i}" data-field="weight"
          class="edit-set-input w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2.5 text-white text-sm text-right pr-10 focus:outline-none focus:border-indigo-500" />
        <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">${editUnit}</span>
      </div>
      <span class="text-gray-600">×</span>
      <div class="flex-1 relative">
        <input type="number" inputmode="numeric" placeholder="回数"
          value="${set.reps}" data-set="${i}" data-field="reps"
          class="edit-set-input w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2.5 text-white text-sm text-right pr-8 focus:outline-none focus:border-indigo-500" />
        <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">回</span>
      </div>
      ${editSets.length > 1 ? `<button class="remove-edit-set-btn flex-shrink-0 text-gray-600 hover:text-red-500 text-lg leading-none transition-colors" data-set="${i}">×</button>` : '<div class="w-5 flex-shrink-0"></div>'}
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
      editSets.splice(parseInt(btn.dataset.set), 1);
      renderEditSets();
      updateEditAddSetBtn();
    });
  });
}

function updateEditUnitButtons() {
  document.getElementById('edit-unit-kg').className = `flex-1 py-3 rounded-2xl text-sm font-semibold border transition-colors ${editUnit === 'kg' ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-gray-900 border-gray-800 text-gray-400'}`;
  document.getElementById('edit-unit-lbs').className = `flex-1 py-3 rounded-2xl text-sm font-semibold border transition-colors ${editUnit === 'lbs' ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-gray-900 border-gray-800 text-gray-400'}`;
}

function updateEditAddSetBtn() {
  const btn = document.getElementById('edit-add-set-btn');
  if (editSets.length >= 5) btn.classList.add('opacity-40', 'pointer-events-none');
  else btn.classList.remove('opacity-40', 'pointer-events-none');
}

document.getElementById('edit-cancel-btn').addEventListener('click', closeEditModal);

document.getElementById('edit-save-btn').addEventListener('click', () => {
  if (!editingEntryId) return;
  const validSets = editSets
    .filter(s => s.weight !== '' && s.reps !== '')
    .map(s => ({ weight: parseFloat(s.weight) || 0, unit: editUnit, reps: parseInt(s.reps) || 0 }))
    .filter(s => s.weight > 0 && s.reps > 0);
  if (validSets.length === 0) { alert('有効なセットを1つ以上入力してください'); return; }

  const editMemo = document.getElementById('edit-memo').value.trim();
  const entries = getEntries().map(e => {
    if (e.id !== editingEntryId) return e;
    return { ...e, sets: validSets, muscleGroup: editMuscleGroup, memo: editMemo };
  });
  saveEntries(entries);
  closeEditModal();
  showToast('更新しました！');
  if (currentTab === 'today') renderToday();
  if (currentTab === 'history') renderHistory();
});

document.getElementById('edit-add-set-btn').addEventListener('click', () => {
  if (editSets.length >= 5) return;
  editSets.push({ weight: '', reps: '' });
  renderEditSets();
  updateEditAddSetBtn();
});

document.getElementById('edit-unit-kg').addEventListener('click', () => {
  editUnit = 'kg';
  updateEditUnitButtons();
  renderEditSets();
});
document.getElementById('edit-unit-lbs').addEventListener('click', () => {
  editUnit = 'lbs';
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

document.getElementById('import-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data.entries || !data.exercises) throw new Error('invalid');
      if (!confirm(`${data.entries.length}件の記録をインポートします。現在のデータに追加されます。よろしいですか？`)) return;
      // Merge entries (avoid duplicates by id)
      const existingIds = new Set(getEntries().map(e => e.id));
      const newEntries = [...getEntries(), ...data.entries.filter(e => !existingIds.has(e.id))];
      saveEntries(newEntries);
      // Merge exercises
      const existingExNames = new Set(getExercises().map(e => e.name.toLowerCase()));
      const newExercises = [...getExercises(), ...data.exercises.filter(e => !existingExNames.has(e.name.toLowerCase()))];
      saveExercises(newExercises);
      // Merge gym times
      const mergedTimes = { ...data.gymTimes, ...getGymTimes() };
      saveGymTimes(mergedTimes);
      deduplicateExercises();      // インポートで重複が生じた場合も除去
      repairOrphanedExerciseIds(); // インポートエントリの孤立IDも修復
      showToast(`${data.entries.length}件をインポートしました！`);
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
}

document.getElementById('theme-toggle-btn').addEventListener('click', () => {
  const current = localStorage.getItem(THEME_KEY) || 'dark';
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

// Apply saved theme immediately (before Firebase / render)
applyTheme(localStorage.getItem(THEME_KEY) || 'dark');

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

function fsUserRef(doc) {
  return fsDb.collection('users').doc(fsUser.uid).collection('data').doc(doc);
}

async function pullFromFirestore() {
  try {
    const [eSnap, xSnap, sSnap] = await Promise.all([
      fsUserRef('entries').get(),
      fsUserRef('exercises').get(),
      fsUserRef('settings').get(),
    ]);
    let fsHadEntries = false;
    if (eSnap.exists && eSnap.data().items) {
      save(KEYS.entries, eSnap.data().items);
      fsHadEntries = true;
    }
    if (xSnap.exists && xSnap.data().items) save(KEYS.exercises, xSnap.data().items);
    if (sSnap.exists) {
      const s = sSnap.data();
      if (s.defaultUnit) save(KEYS.defaultUnit, s.defaultUnit);
      if (s.gymTimes)    save(KEYS.gymTime,     s.gymTimes);
    }
    // 初回ログイン: Firestoreが空でもローカルにデータがある場合は即プッシュ
    if (!fsHadEntries && getEntries().length > 0) {
      await pushToFirestore();
    }
  } catch(e) { console.warn('Firestore pull failed:', e); }
}

async function pushToFirestore() {
  if (!fsUser || !fsDb) return;
  showSyncIndicator(true);
  try {
    const ts = firebase.firestore.FieldValue.serverTimestamp();
    await Promise.all([
      fsUserRef('entries').set({ items: getEntries(), updatedAt: ts }),
      fsUserRef('exercises').set({ items: getExercises(), updatedAt: ts }),
      fsUserRef('settings').set({ defaultUnit: getDefaultUnit(), gymTimes: getGymTimes(), updatedAt: ts }),
    ]);
  } catch(e) { console.warn('Firestore push failed:', e); }
  showSyncIndicator(false);
}

function setupRealtimeListener() {
  if (fsUnsubscribe) fsUnsubscribe();
  fsUnsubscribe = fsUserRef('entries').onSnapshot((snap) => {
    // Only process updates from the server (not our own pending writes)
    if (snap.metadata.hasPendingWrites || !snap.exists) return;
    const items = snap.data().items;
    if (!items) return;
    save(KEYS.entries, items);
    if (currentTab === 'today')   renderToday();
    if (currentTab === 'history') renderHistory();
  });
}

function showSyncIndicator(on) {
  document.getElementById('sync-indicator').classList.toggle('hidden', !on);
}

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

(function init() {
  deduplicateExercises();  // 起動時に重複種目を自動統合
  currentUnit = getDefaultUnit();
  switchTab('today');  // Show app immediately with local data
  initFirebase();      // Then connect Firebase in background
})();
