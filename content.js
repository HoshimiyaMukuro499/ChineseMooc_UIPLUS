/* ==========================================================================
   华文慕课 Plus — content script
   ========================================================================== */
(() => {
  if (window.__cmpyLoaded) return;
  window.__cmpyLoaded = true;

  const DEFAULTS = {
    theme: 'auto',          // auto | light | dark
    enhance: true,          // 卡片/布局增强
    video: true,            // 视频控制条与快捷键
    autoplay: true,         // 播完自动播放下一节
    rate: 1,                // 记忆的播放倍速
    notes: {},              // { courseid: { title, text, updated } }
    bookmarks: [],          // [{ title, url, ts }]
  };

  const state = { ...DEFAULTS };
  let currentTheme = 'light';
  let pageKind = 'plain';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  /* ----------------------------- 设置 ----------------------------- */
  async function loadSettings() {
    try {
      const got = await chrome.storage.local.get(DEFAULTS);
      Object.assign(state, got);
    } catch (e) { /* 忽略 */ }
  }

  function saveSettings(patch) {
    Object.assign(state, patch);
    try { chrome.storage.local.set(patch); } catch (e) { /* 忽略 */ }
  }

  /* ----------------------------- 主题 ----------------------------- */
  function resolveTheme() {
    if (state.theme === 'auto') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return state.theme;
  }

  function applyTheme() {
    currentTheme = resolveTheme();
    document.documentElement.dataset.cmpyTheme = currentTheme;
    document.documentElement.style.colorScheme = currentTheme;
    const btn = $('#cmpy-toolbar button[data-act="theme"]');
    if (btn) {
      btn.classList.toggle('active', currentTheme === 'dark');
      btn.innerHTML = currentTheme === 'dark' ? ICON.moon : ICON.sun;
      btn.dataset.tip = state.theme === 'auto'
        ? `跟随系统（当前${currentTheme === 'dark' ? '深色' : '浅色'}）`
        : (currentTheme === 'dark' ? '深色主题' : '浅色主题');
    }
  }

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.theme === 'auto') applyTheme();
  });

  /* ----------------------------- 页面类型 ----------------------------- */
  function detectPage() {
    const path = location.pathname;
    if (path.includes('/student/')) return 'student';
    if (path.includes('course_list_search')) return 'search';
    if ($('#course_detail')) return 'detail';
    if ($('#course_certified')) return 'courses';
    if ($('#index')) return 'home';
    return 'plain';
  }

  function markPage() {
    pageKind = detectPage();
    document.body.classList.add('cmpy-page-' + pageKind);
    if (pageKind === 'student') {
      const path = location.pathname;
      const sub =
        path.includes('student_content_video') ? 'video' :
        path.includes('term_section_list') ? 'sections' :
        path.includes('my_course_list') ? 'courses' :
        path.includes('index.php') ? 'index' : 'other';
      document.body.classList.add('cmpy-student-' + sub);
      document.body.dataset.cmpyStudent = sub;
    }
  }

  /* ----------------------------- 图标 ----------------------------- */
  const svg = (inner) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

  const ICON = {
    home: svg('<path d="M3 10.8 12 3l9 7.8"/><path d="M5.5 9.5V21h13V9.5"/><path d="M9.5 21v-6h5v6"/>'),
    grid: svg('<rect x="3" y="3" width="7.5" height="7.5" rx="1.4"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.4"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.4"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.4"/>'),
    user: svg('<circle cx="12" cy="8" r="4"/><path d="M4.5 21c.8-4 3.9-6 7.5-6s6.7 2 7.5 6"/>'),
    school: svg('<path d="M3 21h18"/><path d="M5 21V8.5L12 4l7 4.5V21"/><path d="M9.5 21v-5h5v5"/>'),
    sun: svg('<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6"/>'),
    moon: svg('<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>'),
    note: svg('<path d="M5 3.5h9.5L19 8v12.5H5z"/><path d="M14 3.5V8h4.5"/><path d="M8.5 12.5h7M8.5 16h5"/>'),
    bookmark: svg('<path d="M6.5 3.5h11V21L12 16.8 6.5 21Z"/>'),
    top: svg('<path d="M12 20V5"/><path d="m5.5 11.5 6.5-6.5 6.5 6.5"/>'),
    close: svg('<path d="M5 5l14 14M19 5 5 19"/>'),
    pip: svg('<rect x="3" y="4.5" width="18" height="15" rx="2"/><rect x="12" y="11" width="7" height="6" rx="1"/>'),
    wide: svg('<path d="M3 9V4.5h4.5M21 9V4.5h-4.5M3 15v4.5h4.5M21 15v4.5h-4.5"/>'),
  };

  /* ----------------------------- 左侧导航 ----------------------------- */
  function enhanceRail() {
    const nav = $('#public_vertical_nav');
    if (!nav || nav.dataset.cmpy) return;
    nav.dataset.cmpy = '1';
    nav.classList.add('cmpy-rail');

    $$('li', nav).forEach((li) => {
      const a = li.querySelector('a');
      if (!a) return;
      const ps = $$('p', a).filter((p) => !p.classList.contains('img_parent'));
      const label = (ps[ps.length - 1] || a).textContent.trim();
      const key =
        label.includes('首页') ? 'home' :
        label.includes('课程') ? 'grid' :
        label.includes('教师') ? 'user' :
        label.includes('学校') ? 'school' : null;
      if (!key) return;
      const holder = $('.img_parent', a);
      if (holder) holder.insertAdjacentHTML('beforebegin', ICON[key]);
      else a.insertAdjacentHTML('afterbegin', ICON[key]);
    });
  }

  /* ----------------------------- 首页 Hero ----------------------------- */
  function setupHomeHero() {
    const box = $('.search_box');
    if (!box || box.dataset.cmpyHero) return;
    box.dataset.cmpyHero = '1';

    const head = document.createElement('div');
    head.className = 'cmpy-hero-head';
    head.innerHTML = `
      <p class="cmpy-kicker">北京大学 · 华文慕课</p>
      <h1>集优秀课程<span>，</span>惠全球华人</h1>
      <p class="cmpy-sub">Serve Global Chinese with Better Courses through Better Teaching</p>`;
    box.insertBefore(head, box.firstChild);

    const input = $('input[name="search_keywords"]', box);
    if (input) input.placeholder = '搜索课程、教师或关键词…';

    const wrap = box.closest('.pos_abs_center');
    if (wrap) wrap.classList.add('cmpy-hero-wrap');
  }

  /* ----------------------------- 课程筛选 ----------------------------- */
  const STATUS_LABEL = { doing: '正在进行', wait: '待开始', end: '学期结束' };

  function statusOf(li) {
    const tag = $('h5 span', li);
    if (!tag) return 'unknown';
    if (tag.classList.contains('progressing')) return 'doing';
    if (tag.classList.contains('begin')) return 'wait';
    if (tag.classList.contains('term_end')) return 'end';
    const t = tag.textContent || '';
    if (t.includes('正在')) return 'doing';
    if (t.includes('待开始') || t.includes('未开始')) return 'wait';
    if (t.includes('结束')) return 'end';
    return 'unknown';
  }

  // 课程页把两页 swiper 合并成一个连续网格，筛选/排序才能覆盖全部课程
  function mergeCourseLists(list) {
    const lists = $$('ul#public_course_list');
    if (lists.length < 2) return list;
    const main = lists[0];
    lists.slice(1).forEach((ul) => {
      $$(':scope > li.item', ul).forEach((li) => main.appendChild(li));
      ul.remove();
    });
    $$('.course_list .swiper-button-next, .course_list .swiper-button-prev')
      .forEach((b) => b.style.setProperty('display', 'none', 'important'));
    return main;
  }

  // 站点标题是裸文本 + 徽标 span，无法 clamp；包一层 <p> 让两行截断生效
  function wrapCourseTitles() {
    $$('#public_course_list > li.item h5').forEach((h5) => {
      if (h5.querySelector(':scope > p') || h5.dataset.cmpyWrapped) return;
      const text = [...h5.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.replace(/\s+/g, ' ').trim())
        .join(' ')
        .trim();
      if (!text) return;
      [...h5.childNodes].filter((n) => n.nodeType === 3).forEach((n) => n.remove());
      const p = document.createElement('p');
      p.textContent = text;
      h5.insertBefore(p, h5.firstChild);
      h5.dataset.cmpyWrapped = '1';
    });
  }

  function setupCourseFilter() {
    if (!/course_(index|list_search)/.test(location.pathname)) return;
    let list = $('#public_course_list');
    if (!list || $('#cmpy-filterbar')) return;
    list = mergeCourseLists(list);
    wrapCourseTitles();

    const bar = document.createElement('div');
    bar.id = 'cmpy-filterbar';
    bar.innerHTML = `
      <div class="cmpy-seg" role="group" aria-label="按状态筛选">
        <button data-status="all" class="active">全部</button>
        <button data-status="doing">正在进行</button>
        <button data-status="wait">待开始</button>
        <button data-status="end">学期结束</button>
      </div>
      <label>排序
        <select id="cmpy-sort">
          <option value="default">默认</option>
          <option value="title">名称</option>
          <option value="hot">热度</option>
        </select>
      </label>
      <span class="cmpy-count"></span>`;
    list.parentNode.insertBefore(bar, list);

    let filter = 'all';
    let sort = 'default';
    let applying = false;
    let mo = null;
    const originalOrder = new WeakMap();
    let orderCounter = 0;

    const apply = () => {
      if (applying) return;
      applying = true;
      mo?.disconnect();
      try {
        const items = $$(':scope > li.item', list);
        items.forEach((li) => {
          if (!originalOrder.has(li)) originalOrder.set(li, orderCounter++);
          const st = statusOf(li);
          const hidden = filter !== 'all' && st !== filter;
          li.toggleAttribute('data-cmpy-hidden', hidden);
        });
        let desired;
        if (sort === 'title') {
          desired = [...items].sort((a, b) =>
            (a.querySelector('h5 p')?.textContent || '').localeCompare(
              b.querySelector('h5 p')?.textContent || '', 'zh-Hans-CN'));
        } else if (sort === 'hot') {
          desired = [...items].sort((a, b) => hotOf(b) - hotOf(a));
        } else {
          desired = [...items].sort((a, b) => originalOrder.get(a) - originalOrder.get(b));
        }
        // 只有顺序真的不同才搬动 DOM，避免触发观察者自循环
        const changed = desired.some((li, i) => items[i] !== li);
        if (changed) desired.forEach((li) => list.appendChild(li));
        const visible = items.filter((li) => !li.hasAttribute('data-cmpy-hidden')).length;
        bar.querySelector('.cmpy-count').textContent = `${visible} 门课程`;
      } finally {
        mo?.observe(list, { childList: true });
        applying = false;
      }
    };

    const hotOf = (li) => {
      const n = li.querySelector('.info_num li span, .info_num li');
      const m = (n?.textContent || '').replace(/[^\d]/g, '');
      return m ? parseInt(m, 10) : 0;
    };

    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-status]');
      if (!btn) return;
      filter = btn.dataset.status;
      $$('button[data-status]', bar).forEach((b) => b.classList.toggle('active', b === btn));
      apply();
    });
    bar.querySelector('#cmpy-sort').addEventListener('change', (e) => {
      sort = e.target.value;
      apply();
    });

    // 页面数据是异步加载的，持续观察
    mo = new MutationObserver(() => {
      wrapCourseTitles();
      apply();
    });
    mo.observe(list, { childList: true });
    apply();
  }

  /* ----------------------------- 视频增强 ----------------------------- */
  const RATES = [0.75, 1, 1.25, 1.5, 2];
  let videoBar = null;

  function rateButtons() {
    return $$('button[data-rate]', videoBar || document);
  }
  function markRate(r) {
    rateButtons().forEach((b) => b.classList.toggle('active', parseFloat(b.dataset.rate) === r));
  }
  function setRate(v, r) {
    try { v.playbackRate = r; } catch (e) { /* 忽略 */ }
    saveSettings({ rate: r });
    markRate(r);
  }

  function toggleWide() {
    document.documentElement.classList.toggle('cmpy-video-wide');
    const b = videoBar?.querySelector('[data-act="wide"]');
    if (b) b.classList.toggle('active', document.documentElement.classList.contains('cmpy-video-wide'));
  }

  /* ---------- 自动连播 ---------- */
  let nextTimer = null;
  let nextBox = null;

  function syncAutoplayBtn() {
    const b = videoBar?.querySelector('[data-act="autoplay"]');
    if (b) b.classList.toggle('active', !!state.autoplay);
  }

  function clearNext() {
    if (nextTimer) { clearInterval(nextTimer); nextTimer = null; }
    if (nextBox) { nextBox.remove(); nextBox = null; }
  }

  function nextVideo() {
    const course = window.CMPY_DATA?.currentCourse?.();
    const videos = (course && course.videos) || [];
    if (!videos.length) return null;
    const vid = (new URLSearchParams(location.search).get('videoid') || '').replace(/\D/g, '');
    let index = vid
      ? videos.findIndex((x) => new RegExp(`[?&]videoid=${vid}(?:&|$)`).test(x.href || ''))
      : -1;
    if (index < 0) index = videos.findIndex((x) => x.active);
    if (index < 0 || index + 1 >= videos.length) return null;
    const next = videos[index + 1];
    if (!next || !next.href) return null;
    try {
      if (new URL(next.href, location.href).origin !== location.origin) return null;
    } catch (e) { return null; }
    return next;
  }

  function scheduleNext(v) {
    if (!state.autoplay) return;
    const next = nextVideo();
    if (!next) return;
    clearNext();

    const box = document.createElement('div');
    box.id = 'cmpy-next-overlay';
    box.innerHTML = `
      <p>即将播放下一节</p>
      <strong>${escHtml(next.describe || next.title || '下一节')}</strong>
      <span class="cmpy-next-count"></span>
      <div class="cmpy-next-actions">
        <button type="button" data-act="cancel">取消</button>
        <button type="button" data-act="play">立即播放</button>
      </div>`;
    const container = v.closest('.prism-player') || v.parentElement;
    if (!container) return;
    container.appendChild(box);
    nextBox = box;

    const counter = box.querySelector('.cmpy-next-count');
    let left = 5;
    const tick = () => {
      if (left <= 0) {
        clearNext();
        location.assign(next.href);
        return;
      }
      counter.textContent = `${left} 秒后自动播放${next.time ? ` · ${next.time}` : ''}`;
      left -= 1;
    };
    tick();
    nextTimer = setInterval(tick, 1000);
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.act === 'cancel') clearNext();
      if (b.dataset.act === 'play') { clearNext(); location.assign(next.href); }
    });
  }

  const enhancedVideos = new WeakSet();

  function setupVideo() {
    if (!state.video) return;
    syncAutoplayBtn();
    const v = document.querySelector('video');
    if (!v) return;
    const container = v.closest('.prism-player') || v.parentElement;
    if (!container) return;

    if (enhancedVideos.has(v)) {
      // 站点脚本重建播放器时，控制条可能被一起移除，挂到新容器上
      if (videoBar && videoBar.parentElement !== container) container.appendChild(videoBar);
      return;
    }
    enhancedVideos.add(v);
    v.dataset.cmpy = '1';
    try { v.playbackRate = state.rate || 1; } catch (e) { /* 忽略 */ }

    v.addEventListener('ended', () => scheduleNext(v));
    v.addEventListener('play', () => clearNext());

    container.classList.add('cmpy-player');
    if (!videoBar) {
      videoBar = document.createElement('div');
      videoBar.id = 'cmpy-video-bar';
      videoBar.innerHTML =
        RATES.map((r) => `<button data-rate="${r}">${r === 1 ? '1x' : r + 'x'}</button>`).join('') +
        `<button data-act="pip" title="画中画">${ICON.pip}</button>
         <button data-act="wide" title="宽屏">${ICON.wide}</button>
         <button data-act="autoplay" title="播放结束后自动播放下一节">连播</button>`;
      videoBar.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        const cur = document.querySelector('video') || v;
        const rate = b.dataset.rate;
        if (rate) { setRate(cur, parseFloat(rate)); return; }
        if (b.dataset.act === 'pip') {
          if (document.pictureInPictureElement) document.exitPictureInPicture();
          else cur.requestPictureInPicture?.().catch(() => {});
        }
        if (b.dataset.act === 'wide') toggleWide();
        if (b.dataset.act === 'autoplay') {
          saveSettings({ autoplay: !state.autoplay });
          syncAutoplayBtn();
          if (!state.autoplay) clearNext();
        }
      });
      markRate(state.rate || 1);
    }
    if (videoBar.parentElement !== container) container.appendChild(videoBar);
    syncAutoplayBtn();
  }

  function bindVideoKeys() {
    document.addEventListener('keydown', (e) => {
      if (!state.video) return;
      const t = e.target;
      if (t && (t.matches('input, textarea, select') || t.isContentEditable)) return;
      const v = document.querySelector('video');
      if (!v) return;
      const key = e.key;
      if (key === ' ' || key === 'Spacebar') {
        e.preventDefault();
        v.paused ? v.play().catch(() => {}) : v.pause();
      } else if (key === 'ArrowLeft') {
        e.preventDefault(); v.currentTime = Math.max(0, v.currentTime - 5);
      } else if (key === 'ArrowRight') {
        e.preventDefault(); v.currentTime = Math.min(v.duration || 0, v.currentTime + 5);
      } else if (key === 'ArrowUp') {
        e.preventDefault(); v.volume = Math.min(1, v.volume + 0.1);
      } else if (key === 'ArrowDown') {
        e.preventDefault(); v.volume = Math.max(0, v.volume - 0.1);
      } else if (key === 'f' || key === 'F') {
        const c = v.closest('.prism-player') || v.parentElement;
        if (document.fullscreenElement) document.exitFullscreen();
        else (c || v).requestFullscreen?.().catch(() => {});
      } else if (key === 'p' || key === 'P') {
        if (document.pictureInPictureElement) document.exitPictureInPicture();
        else v.requestPictureInPicture?.().catch(() => {});
      } else if (key === ']' || key === '[') {
        const idx = RATES.indexOf(v.playbackRate) >= 0 ? RATES.indexOf(v.playbackRate) : 1;
        const next = key === ']' ? Math.min(RATES.length - 1, idx + 1) : Math.max(0, idx - 1);
        setRate(v, RATES[next]);
      }
    });
  }

  /* ----------------------------- 笔记 ----------------------------- */
  let drawer = null;

  function courseId() {
    const m = location.search.match(/courseid=(\d+)/);
    return m ? m[1] : null;
  }

  function courseTitle() {
    return ($('.title_name')?.textContent || document.title.replace(/ - 课程.*$/, '')).trim();
  }

  function ensureDrawer() {
    if (drawer) return drawer;
    drawer = document.createElement('aside');
    drawer.id = 'cmpy-drawer';
    drawer.innerHTML = `
      <div class="cmpy-drawer-head">
        <h3>课程笔记</h3>
        <button data-act="close" title="关闭">${ICON.close}</button>
      </div>
      <textarea placeholder="在这里记录这节课的要点、疑问……内容自动保存在本地。"></textarea>
      <div class="cmpy-drawer-foot"><span class="cmpy-saved">已保存</span><span class="cmpy-meta"></span></div>`;
    document.body.appendChild(drawer);
    const ta = $('textarea', drawer);
    let timer = null;
    ta.addEventListener('input', () => {
      $('.cmpy-saved', drawer).textContent = '保存中…';
      clearTimeout(timer);
      timer = setTimeout(() => {
        const id = courseId() || 'misc';
        const notes = { ...(state.notes || {}) };
        notes[id] = { title: courseTitle(), text: ta.value, updated: Date.now() };
        saveSettings({ notes });
        $('.cmpy-saved', drawer).textContent = '已保存';
      }, 400);
    });
    drawer.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="close"]')) toggleDrawer(false);
    });
    return drawer;
  }

  function toggleDrawer(force) {
    const d = ensureDrawer();
    const open = force === undefined ? !d.classList.contains('open') : force;
    if (open) {
      const id = courseId() || 'misc';
      const note = (state.notes || {})[id];
      $('textarea', d).value = note?.text || '';
      $('.cmpy-meta', d).textContent = note ? new Date(note.updated).toLocaleString() : '';
      d.classList.add('open');
    } else {
      d.classList.remove('open');
    }
  }

  /* ----------------------------- 收藏 ----------------------------- */
  function bookmarkCurrent() {
    const url = location.href;
    const title = document.title.replace(/ - 华文慕课$/, '').trim();
    const list = Array.isArray(state.bookmarks) ? [...state.bookmarks] : [];
    const idx = list.findIndex((b) => b.url === url);
    if (idx >= 0) {
      list.splice(idx, 1);
      saveSettings({ bookmarks: list });
      toast('已取消收藏');
      syncBookmarkBtn();
    } else {
      list.unshift({ title, url, ts: Date.now() });
      saveSettings({ bookmarks: list });
      toast('已收藏');
      syncBookmarkBtn();
    }
  }

  function isBookmarked() {
    return (state.bookmarks || []).some((b) => b.url === location.href);
  }
  function syncBookmarkBtn() {
    const b = $('#cmpy-toolbar button[data-act="bookmark"]');
    if (b) b.classList.toggle('active', isBookmarked());
  }

  /* ----------------------------- 工具条 / 提示 ----------------------------- */
  function toast(msg) {
    let t = $('#cmpy-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'cmpy-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t.__timer);
    t.__timer = setTimeout(() => t.classList.remove('show'), 1600);
  }

  function scrollTop() {
    const box = $('#content_box');
    if (box) box.scrollTo({ top: 0, behavior: 'smooth' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function buildToolbar() {
    if ($('#cmpy-toolbar')) return;
    const bar = document.createElement('div');
    bar.id = 'cmpy-toolbar';
    bar.innerHTML = `
      <button data-act="theme" data-tip="切换主题">${ICON.sun}</button>
      ${pageKind === 'detail' ? `<button data-act="note" data-tip="课程笔记">${ICON.note}</button>` : ''}
      <button data-act="bookmark" data-tip="收藏本页">${ICON.bookmark}</button>
      <button data-act="top" data-tip="回到顶部">${ICON.top}</button>`;
    document.body.appendChild(bar);
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'theme') {
        const order = ['auto', 'light', 'dark'];
        const next = order[(order.indexOf(state.theme) + 1) % order.length];
        saveSettings({ theme: next });
        applyTheme();
      } else if (act === 'note') {
        toggleDrawer();
      } else if (act === 'bookmark') {
        bookmarkCurrent();
      } else if (act === 'top') {
        scrollTop();
      }
    });
    applyTheme();
    syncBookmarkBtn();
  }

  /* ----------------------------- 键盘：/ 聚焦搜索 ----------------------------- */
  function bindSearchKey() {
    document.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t && (t.matches('input, textarea, select') || t.isContentEditable)) return;
      if (e.key === '/') {
        const input = $('.search_click input, .search input, input[name="search_keywords"]');
        if (input) {
          e.preventDefault();
          input.focus();
          input.select?.();
        }
      }
    });
  }

  /* ----------------------------- 启动 ----------------------------- */
  function safe(name, fn) {
    try {
      fn();
    } catch (e) {
      console.warn('[华文慕课 Plus]', name, e && e.message);
    }
  }

  async function init() {
    await loadSettings();
    markPage();

    // 学习区：数据层同源读取站点页面，视图层重建统计与目录
    if (pageKind === 'student' && window.CMPY_VIEW) {
      safe('CMPY_VIEW.init', () => window.CMPY_VIEW.init());
    }

    try {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (!msg || msg.type !== 'cmpy-refresh-data') return;
        if (!window.CMPY_DATA || pageKind !== 'student') {
          sendResponse({ ok: false });
          return;
        }
        window.CMPY_DATA.refresh(true)
          .then(() => sendResponse({ ok: true }))
          .catch(() => sendResponse({ ok: false }));
        return true;
      });
    } catch (e) { /* 忽略 */ }

    safe('applyTheme', applyTheme);
    safe('enhanceRail', enhanceRail);
    if (pageKind === 'home') safe('setupHomeHero', setupHomeHero);
    safe('setupCourseFilter', setupCourseFilter);
    safe('setupVideo', setupVideo);
    safe('bindVideoKeys', bindVideoKeys);
    safe('bindSearchKey', bindSearchKey);
    safe('buildToolbar', buildToolbar);

    const mo = new MutationObserver(() => {
      setupVideo();
      wrapCourseTitles();
      if (!$('#cmpy-filterbar')) setupCourseFilter();
    });
    mo.observe(document.body, { childList: true, subtree: true });

    // 页面切换/设置变化时同步
    try {
      chrome.storage.onChanged.addListener((changes) => {
        for (const [k, v] of Object.entries(changes)) state[k] = v.newValue;
        applyTheme();
        syncBookmarkBtn();
        if (state.video) setupVideo();
      });
    } catch (e) { /* 忽略 */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
