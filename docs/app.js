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
function saveEntries(e) { save(KEYS.entries, e); }

function getExercises() { return load(KEYS.exercises, []); }
function saveExercises(e) { save(KEYS.exercises, e); }

function getDefaultUnit() { return load(KEYS.defaultUnit, 'kg'); }
function saveDefaultUnit(u) { save(KEYS.defaultUnit, u); }

function getGymTimes() { return load(KEYS.gymTime, {}); }
function saveGymTimes(t) { save(KEYS.gymTime, t); }

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
// STATE
// ============================================================

let currentTab = 'today';
let currentUnit = getDefaultUnit();
let sets = [{ weight: '', reps: '' }];
let graphMode = 'weight'; // 'weight' | 'volume'
let graphChart = null;

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
    container.appendChild(buildEntryCard(entry, true));
  });
}

function buildEntryCard(entry, showDelete) {
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

  card.innerHTML = `
    <div class="flex items-start justify-between mb-3">
      <div>
        <div class="text-base font-bold text-white">${entry.exerciseName}</div>
        <div class="text-xs text-gray-500 mt-0.5">${entry.sets.length}セット</div>
      </div>
      <div class="text-right">
        <div class="text-xs text-gray-500">最大</div>
        <div class="text-sm font-bold text-indigo-400">${maxW}${unit}</div>
      </div>
    </div>
    <div class="border-t border-gray-800 pt-2">${setsHtml}</div>
    <div class="flex items-center justify-between mt-2 pt-2 border-t border-gray-800">
      <span class="text-xs text-gray-600">総ボリューム: <span class="text-gray-400 font-semibold">${totalVol.toFixed(1)}${unit}</span></span>
      ${showDelete ? `<button class="text-xs text-red-500 font-medium delete-entry-btn" data-id="${entry.id}">削除</button>` : ''}
    </div>
  `;

  if (showDelete) {
    card.querySelector('.delete-entry-btn').addEventListener('click', () => {
      if (confirm(`「${entry.exerciseName}」の記録を削除しますか？`)) {
        const entries = getEntries().filter(e => e.id !== entry.id);
        saveEntries(entries);
        renderToday();
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
}

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

  const entry = {
    id: genId(),
    date,
    gymIn,
    gymOut,
    exerciseId: matchExercise?.id || genId(),
    exerciseName: matchExercise?.name || exerciseName,
    sets: validSets,
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

    const header = document.createElement('div');
    header.className = 'px-4 py-3 flex items-center justify-between cursor-pointer';
    header.innerHTML = `
      <div>
        <div class="text-sm font-bold text-white">${formatDate(date)}</div>
        <div class="text-xs text-gray-500 mt-0.5">${dateEntries.length}種目 ${gt.in ? `• ${gt.in}〜${gt.out || '?'}` : ''}</div>
      </div>
      <svg class="toggle-icon w-4 h-4 text-gray-500 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    `;

    const body = document.createElement('div');
    body.className = 'hidden border-t border-gray-800 divide-y divide-gray-800';

    dateEntries.forEach(entry => {
      const item = document.createElement('div');
      item.className = 'px-4 py-3';
      const maxW = Math.max(...entry.sets.map(s => s.weight));
      const unit = entry.sets[0]?.unit || 'kg';
      item.innerHTML = `
        <div class="flex items-center justify-between mb-1">
          <span class="text-sm font-semibold text-white">${entry.exerciseName}</span>
          <span class="text-xs text-indigo-400 font-semibold">${maxW}${unit} max</span>
        </div>
        <div class="flex gap-3 flex-wrap">
          ${entry.sets.map((s, i) => `<span class="text-xs text-gray-500">S${i+1}: ${s.weight}${s.unit}×${s.reps}</span>`).join('')}
        </div>
      `;
      body.appendChild(item);
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
  switchTab('today');
})();
