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
  return new Date().toISOString().slice(0, 10);
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
  '胸':  { activeBg: '#dc2626', border: '#dc2626', tagBg: 'rgba(220,38,38,0.18)', tagBorder: '#dc2626', tagText: '#fca5a5' },
  '背中': { activeBg: '#2563eb', border: '#2563eb', tagBg: 'rgba(37,99,235,0.18)',  tagBorder: '#2563eb', tagText: '#93c5fd' },
  '脚':  { activeBg: '#16a34a', border: '#16a34a', tagBg: 'rgba(22,163,74,0.18)',  tagBorder: '#16a34a', tagText: '#86efac' },
  '肩':  { activeBg: '#ea580c', border: '#ea580c', tagBg: 'rgba(234,88,12,0.18)',  tagBorder: '#ea580c', tagText: '#fdba74' },
  '腕':  { activeBg: '#9333ea', border: '#9333ea', tagBg: 'rgba(147,51,234,0.18)', tagBorder: '#9333ea', tagText: '#d8b4fe' },
  '腹':  { activeBg: '#0d9488', border: '#0d9488', tagBg: 'rgba(13,148,136,0.18)', tagBorder: '#0d9488', tagText: '#5eead4' },
};

function muscleTagHtml(muscle) {
  if (!muscle) return '';
  const c = MUSCLE_COLORS[muscle];
  if (c) {
    return `<span class="inline-block text-xs font-semibold px-2 py-0.5 rounded-full ml-1" style="background:${c.tagBg};border:1px solid ${c.tagBorder};color:${c.tagText}">${muscle}</span>`;
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
let currentMuscleGroup = '';
let editingEntryId = null;
let editSets = [];
let editUnit = 'kg';
let editMuscleGroup = '';
let historyViewMode = 'list';
let calendarYear = new Date().getFullYear();
let calendarMonth = new Date().getMonth(); // 0-indexed
let calendarSelectedDate = null;

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

  const entries = getEntries().filter(e => e.date === today);
  const container = document.getElementById('today-entries');
  const empty = document.getElementById('today-empty');

  // Clear existing entry cards
  Array.from(container.children).forEach(child => {
    if (child.id !== 'today-empty') child.remove();
  });

  if (entries.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  entries.forEach(entry => {
    container.appendChild(buildEntryCard(entry, true, renderToday));
  });
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

document.getElementById('today-add-btn').addEventListener('click', () => {
  switchTab('add');
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
  });
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
  const filtered = exercises.filter(ex => ex.name.toLowerCase().includes(q));

  exerciseDropdown.innerHTML = '';

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

  if (filtered.length === 0 && !q) {
    exerciseDropdown.classList.add('hidden');
    return;
  }

  filtered.forEach(ex => {
    const item = document.createElement('div');
    item.className = 'px-4 py-3 text-sm text-white cursor-pointer hover:bg-gray-700 transition-colors';
    item.textContent = ex.name;
    item.addEventListener('click', () => {
      exerciseInput.value = ex.name;
      exerciseDropdown.classList.add('hidden');
    });
    exerciseDropdown.appendChild(item);
  });

  if (exerciseDropdown.children.length > 0) {
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

  // Save exercise if new
  const exercises = getExercises();
  if (!exercises.some(ex => ex.name.toLowerCase() === exerciseName.toLowerCase())) {
    exercises.push({ id: genId(), name: exerciseName });
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

  if (historyViewMode === 'calendar') {
    renderCalendarView();
  } else {
    renderHistoryList();
  }
}

function renderHistoryList() {
  const entries = getEntries();
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

  const entries = getEntries();
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
  const exercises = getExercises();
  const select = document.getElementById('graph-exercise-select');
  const currentVal = select.value;

  select.innerHTML = '<option value="">種目を選択してください</option>';
  exercises.forEach(ex => {
    const opt = document.createElement('option');
    opt.value = ex.id;
    opt.textContent = ex.name;
    select.appendChild(opt);
  });

  if (currentVal) select.value = currentVal;
  renderGraph();
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
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
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

(function init() {
  currentUnit = getDefaultUnit();
  switchTab('today');  // Show app immediately with local data
  initFirebase();      // Then connect Firebase in background
})();
