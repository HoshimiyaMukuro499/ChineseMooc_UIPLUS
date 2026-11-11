const DEFAULTS = { theme: 'auto', enhance: true, video: true, rate: 1, notes: {}, bookmarks: [], cmpyData: null };

const el = (id) => document.getElementById(id);
const fmt = (ts) => new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

let state = { ...DEFAULTS };
let learn = null;

function applyPopupTheme() {
  document.documentElement.dataset.theme =
    state.theme === 'auto'
      ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : state.theme;
}

function pendingOf(course) {
  if (!course || /结束/.test(course.status || '')) return 0;
  if (course.assignments && course.assignments.total) {
    return course.assignments.pending || 0;
  }
  if (course.tasks) return course.tasks.pending || 0;
  return 0;
}

function renderLearn() {
  const user = (learn && learn.user) || {};
  const courses = (learn && learn.courses) || [];
  const active = Number.isFinite(user.activeCourses)
    ? user.activeCourses
    : courses.filter((c) => !/结束/.test(c.status || '')).length;
  const pending = courses.reduce((n, c) => n + pendingOf(c), 0);

  el('learnMinutes').textContent = Number.isFinite(user.minutes) ? user.minutes : '—';
  el('learnCourses').textContent = Number.isFinite(active) ? active : '—';
  el('learnPending').textContent = pending || (learn ? '0' : '—');
  el('learnUpdated').textContent = learn && learn.updatedAt ? fmt(learn.updatedAt) : '未同步';
}

function render() {
  document.querySelectorAll('#themeSeg button').forEach((b) =>
    b.classList.toggle('active', b.dataset.theme === state.theme));
  el('videoToggle').checked = !!state.video;
  el('enhanceToggle').checked = !!state.enhance;

  const bms = Array.isArray(state.bookmarks) ? state.bookmarks : [];
  el('bmCount').textContent = bms.length;
  el('bmList').replaceChildren(...bms.slice(0, 30).map((b) => {
    const li = document.createElement('li');
    li.innerHTML = `<div class="li-main"><div class="li-title"></div><div class="li-sub"></div></div>
      <button title="删除">×</button>`;
    li.querySelector('.li-title').textContent = b.title || b.url;
    li.querySelector('.li-sub').textContent = fmt(b.ts || Date.now());
    li.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') {
        state.bookmarks = bms.filter((x) => x.url !== b.url);
        chrome.storage.local.set({ bookmarks: state.bookmarks });
        render();
        return;
      }
      chrome.tabs.create({ url: b.url });
    });
    return li;
  }));

  const notes = Object.entries(state.notes || {})
    .filter(([, n]) => n && n.text)
    .sort((a, b) => (b[1].updated || 0) - (a[1].updated || 0));
  el('noteCount').textContent = notes.length;
  el('noteList').replaceChildren(...notes.slice(0, 30).map(([id, n]) => {
    const li = document.createElement('li');
    li.innerHTML = `<div class="li-main"><div class="li-title"></div><div class="li-sub"></div></div>
      <button title="删除">×</button>`;
    li.querySelector('.li-title').textContent = n.title || ('课程 ' + id);
    li.querySelector('.li-sub').textContent = n.text.slice(0, 60);
    li.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') {
        delete state.notes[id];
        chrome.storage.local.set({ notes: state.notes });
        render();
        return;
      }
      chrome.tabs.create({ url: `https://www.chinesemooc.org/web/course_detail.php?courseid=${id}` });
    });
    return li;
  }));
}

function download(name, text) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function refreshLearn() {
  const hint = el('learnHint');
  const button = el('refreshLearnBtn');
  const old = button.textContent;
  button.disabled = true;
  button.textContent = '刷新中…';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error('no tab');
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'cmpy-refresh-data' });
    if (!res || !res.ok) throw new Error('no data');
    const got = await chrome.storage.local.get({ cmpyData: null });
    learn = got.cmpyData;
    renderLearn();
    hint.textContent = '已刷新。数据只在本机解析和保存。';
  } catch (e) {
    hint.textContent = '请先打开并刷新华文慕课学习中心页面，再点刷新。';
  } finally {
    button.disabled = false;
    button.textContent = old;
  }
}

function bind() {
  document.querySelectorAll('#themeSeg button').forEach((b) =>
    b.addEventListener('click', () => {
      state.theme = b.dataset.theme;
      chrome.storage.local.set({ theme: state.theme });
      applyPopupTheme();
      render();
    }));

  el('videoToggle').addEventListener('change', (e) => {
    state.video = e.target.checked;
    chrome.storage.local.set({ video: state.video });
  });
  el('enhanceToggle').addEventListener('change', (e) => {
    state.enhance = e.target.checked;
    chrome.storage.local.set({ enhance: state.enhance });
  });

  el('exportBtn').addEventListener('click', () => {
    const data = {
      exportedAt: new Date().toISOString(),
      bookmarks: state.bookmarks || [],
      notes: state.notes || {},
    };
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    download(`chinesemooc-plus-${stamp}.json`, JSON.stringify(data, null, 2));
  });

  el('refreshLearnBtn').addEventListener('click', refreshLearn);
}

chrome.storage.local.get(DEFAULTS).then((got) => {
  state = { ...DEFAULTS, ...got };
  learn = got.cmpyData || null;
  applyPopupTheme();
  render();
  renderLearn();
  bind();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.cmpyData) {
    learn = changes.cmpyData.newValue || null;
    renderLearn();
  }
  let settingsChanged = false;
  for (const [k, v] of Object.entries(changes)) {
    if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) {
      state[k] = v.newValue;
      settingsChanged = true;
    }
  }
  if (settingsChanged) {
    applyPopupTheme();
    render();
  }
});
