/* ==========================================================================
   华文慕课 Plus — 学习中心视图层
   只生成自己的 DOM，原站节点保留在页面里做视觉隐藏，避免破坏站点脚本。
   ========================================================================== */
(() => {
  if (window.CMPY_VIEW) return;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const ui = {
    courseFilter: 'all',
    sectionFilter: 'all',
    materialSearch: '',
    materialKind: 'all',
  };

  let root = null;

  /* ----------------------------- 基础工具 ----------------------------- */
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  function safeHref(h) {
    const s = String(h || '');
    if (/^(https?:\/\/|\/)/i.test(s)) return s;
    return '';
  }

  function el(tag, cls, textValue) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (textValue !== undefined) node.textContent = textValue;
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function fmtRange(s) {
    const v = String(s || '').replace(/\s+/g, ' ').trim();
    if (!v) return '';
    return v
      .replace(/\s*[-–—]\s*/g, ' – ')
      .replace(/–\s*$/, '– 至今')
      .replace(/\s+/g, ' ');
  }

  function groupBy(list, fn) {
    const out = {};
    list.forEach((x) => {
      const k = fn(x) || '其他';
      (out[k] || (out[k] = [])).push(x);
    });
    return out;
  }

  function fmtDate(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  }

  function parseDeadline(raw) {
    const m = String(raw || '')
      .match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:\s*(\d{1,2})[:：](\d{2}))?/);
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 23, m[5] ? +m[5] : 59);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // 按自然日计算剩余天数：今天截止 / 剩 N 天 / 已截止
  function deadlineInfo(raw) {
    const d = parseDeadline(raw);
    if (!d) return null;
    const now = new Date();
    const diff = d.getTime() - now.getTime();
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const days = Math.round((dayStart - todayStart) / 86400000);
    if (diff <= 0) return { label: '已截止', tone: 'muted', overdue: true };
    if (days <= 0) return { label: '今天截止', tone: 'danger', overdue: false };
    if (days <= 3) return { label: `剩 ${days} 天`, tone: 'danger', overdue: false };
    if (days <= 7) return { label: `剩 ${days} 天`, tone: 'warn', overdue: false };
    return { label: `剩 ${days} 天`, tone: '', overdue: false };
  }

  /* ----------------------------- 数据读取 ----------------------------- */
  function state() {
    return (window.CMPY_DATA && window.CMPY_DATA.get()) || { user: null, courses: [] };
  }

  function courseUrl(c) {
    return c && window.CMPY_DATA ? window.CMPY_DATA.courseHref(c) : '';
  }

  function materialsUrl(c) {
    return c && window.CMPY_DATA ? window.CMPY_DATA.materialsHref(c) : '';
  }

  function progressOf(c) {
    const p = c && c.progress;
    if (p && p.total) {
      const percent = Number.isFinite(p.percent) ? p.percent : Math.round((p.done / p.total) * 100);
      return { done: p.done || 0, total: p.total, percent: Math.max(0, Math.min(100, percent)) };
    }
    return { done: 0, total: 0, percent: 0 };
  }

  function taskOf(c) {
    if (c && c.assignments && c.assignments.total) {
      return {
        pending: c.assignments.pending || 0,
        graded: c.assignments.graded || 0,
        total: c.assignments.total,
      };
    }
    if (c && c.tasks && c.tasks.total) {
      return { pending: c.tasks.pending || 0, graded: 0, total: c.tasks.total };
    }
    const total = c && c.totals ? c.totals.assignments || 0 : 0;
    return { pending: 0, graded: 0, total };
  }

  function statusTone(status) {
    const s = String(status || '');
    if (!s) return '';
    if (s === 'pending') return 'warn';
    if (s === 'graded') return 'ok';
    if (s === 'open') return 'accent';
    if (s === 'closed') return 'muted';
    if (/结束|关闭|已过/.test(s)) return 'muted';
    if (/待|未/.test(s)) return 'warn';
    if (/完成|公布|已交|已获/.test(s)) return 'ok';
    if (/正在|进行|可提交|开课/.test(s)) return 'accent';
    return '';
  }

  function statusLabel(status) {
    const map = { pending: '待完成', open: '可提交', graded: '已完成', closed: '已结束' };
    return map[status] || status || '';
  }

  function pill(label, tone) {
    if (!label) return '';
    return `<span class="cmpy-pill${tone ? ` is-${tone}` : ''}">${esc(label)}</span>`;
  }

  function card(value, label, unit) {
    return `<div class="cmpy-card">
      <div class="cmpy-card-num">${esc(value ?? '—')}</div>
      <div class="cmpy-card-label">${esc(label)}${unit ? `<span>${esc(unit)}</span>` : ''}</div>
    </div>`;
  }

  function seg(name, options, active) {
    return `<div class="cmpy-seg" data-seg="${esc(name)}">${options.map(([value, label]) =>
      `<button type="button" data-value="${esc(value)}" class="${value === active ? 'active' : ''}">${esc(label)}</button>`
    ).join('')}</div>`;
  }

  function empty(text) {
    return `<div class="cmpy-empty">${esc(text)}</div>`;
  }

  function emptyRow(text) {
    return `<div class="cmpy-empty-row">${esc(text)}</div>`;
  }

  function footer(data) {
    const at = data && data.updatedAt ? fmtDate(data.updatedAt) : '';
    const stale = data && data.stale ? ' · 部分数据未更新' : '';
    return `<footer class="cmpy-foot">
      <span>${at ? `数据更新于 ${esc(at)}${esc(stale)}` : '尚未同步学习数据'}</span>
      <button type="button" class="cmpy-btn cmpy-btn-ghost" data-act="export">导出数据</button>
      <button type="button" class="cmpy-btn" data-act="refresh">刷新</button>
    </footer>`;
  }

  /* ----------------------------- 公共行 ----------------------------- */
  function courseRow(c) {
    const p = progressOf(c);
    const t = taskOf(c);
    const ended = /结束/.test(c.status || '');
    const href = safeHref(courseUrl(c));
    const meta = [c.termLabel, fmtRange(c.dateRange)].filter(Boolean).join(' · ');
    const tag = href ? 'a' : 'div';
    return `<${tag} class="cmpy-item cmpy-course-row"${href ? ` href="${esc(href)}"` : ''}>
      <span class="cmpy-item-main">
        <span class="cmpy-item-title">${esc(c.title || '未命名课程')} ${pill(c.kind)} ${pill(c.status, statusTone(c.status))}</span>
        <span class="cmpy-item-sub">${esc(meta)}</span>
      </span>
      <span class="cmpy-item-progress">
        <span class="cmpy-bar"><i style="width:${p.percent}%"></i></span>
        <span class="cmpy-item-sub">${p.total ? `${p.done}/${p.total} 节 · ${p.percent}%` : '进度未知'}</span>
      </span>
      <span class="cmpy-item-side">
        <span class="cmpy-item-side-num">${!ended && t.total ? `${t.pending}/${t.total}` : '—'}</span>
        <span class="cmpy-item-sub">${ended ? '课程已结束' : (t.total ? '待交作业' : '暂无作业数据')}</span>
      </span>
      ${href ? '<span class="cmpy-chev">›</span>' : ''}
    </${tag}>`;
  }

  function lessonRow(item) {
    const type = item.type || '';
    const isVideo = /视频/.test(type);
    const href = safeHref(item.href);
    const tag = href ? 'a' : 'div';
    const title = item.title || '';
    // 视频前补小节号（1.1…）；作业的 sectionNum 是所属小节，不是标题的一部分
    const fullTitle = isVideo && item.sectionNum && !title.startsWith(item.sectionNum)
      ? `${item.sectionNum} ${title}`
      : title;
    const meta = isVideo ? '' : [
      item.deadline ? `截止 ${item.deadline}` : '',
      item.submit ? `提交 ${item.submit}` : '',
    ].filter(Boolean).join(' · ');
    return `<${tag} class="cmpy-item cmpy-lesson-row"${href ? ` href="${esc(href)}" target="_blank" rel="noopener"` : ''}>
      <span class="cmpy-type${isVideo ? ' is-video' : ''}">${esc(type || '内容')}</span>
      <span class="cmpy-item-main">
        <span class="cmpy-item-title">${esc(fullTitle || '未命名内容')}</span>
        ${meta ? `<span class="cmpy-item-sub">${esc(meta)}</span>` : ''}
      </span>
      ${item.status ? pill(statusLabel(item.status), statusTone(item.status)) : ''}
      ${href ? '<span class="cmpy-chev">›</span>' : ''}
    </${tag}>`;
  }

  function todoRow(entry) {
    const href = safeHref(entry.item.href);
    const tag = href ? 'a' : 'div';
    const dl = deadlineInfo(entry.item.deadline);
    const cls = `cmpy-item cmpy-todo-row${dl ? ' has-deadline' : ''}${dl && dl.overdue ? ' is-overdue' : ''}`;
    const meta = [
      entry.course.title,
      entry.item.deadline ? `截止 ${entry.item.deadline}` : '',
    ].filter(Boolean).join(' · ');
    return `<${tag} class="${cls}"${href ? ` href="${esc(href)}" target="_blank" rel="noopener"` : ''}>
      <span class="cmpy-item-main">
        <span class="cmpy-item-title">${esc(entry.item.title || '作业')} ${dl ? pill(dl.label, dl.tone) : ''}</span>
        <span class="cmpy-item-sub">${esc(meta)}</span>
      </span>
      ${pill(statusLabel(entry.item.status || 'pending'), 'warn')}
      ${href ? '<span class="cmpy-chev">›</span>' : ''}
    </${tag}>`;
  }

  function collectTodo(courses) {
    const out = [];
    (courses || []).filter((course) => !/结束/.test(course.status || '')).forEach((course) => {
      (course.chapters || []).forEach((chapter) => {
        (chapter.items || []).forEach((item) => {
          if (/作业/.test(item.type || '') && (item.status === 'pending' || item.status === 'open')) {
            out.push({ course, item });
          }
        });
      });
    });
    out.sort((a, b) => String(a.item.deadline || '9999').localeCompare(String(b.item.deadline || '9999')));
    return out;
  }

  /* ----------------------------- 视图根节点 ----------------------------- */
  function ensureRoot(kind) {
    if (root && root.isConnected) return root;
    const page = $('.pagecont');
    if (!page) return null;
    root = el('section', 'cmpy-view');

    if (kind === 'index') {
      const native = $('.student-two-column', page);
      if (native) page.insertBefore(root, native);
      else page.appendChild(root);
    } else {
      const body = $('.pagecont-body', page);
      if (body) body.insertBefore(root, body.firstChild);
      else page.appendChild(root);
    }
    return root;
  }

  /* ----------------------------- 学习总览 ----------------------------- */
  function renderIndex(container, data) {
    const courses = data.courses || [];
    const user = data.user || {};
    // 已结束课程不再计入“待交”，否则历史课程会把首页数字撑大
    const pending = courses
      .filter((c) => !/结束/.test(c.status || ''))
      .reduce((n, c) => n + taskOf(c).pending, 0);
    const active = Number.isFinite(user.activeCourses)
      ? user.activeCourses
      : courses.filter((c) => !/结束/.test(c.status || '')).length;
    const minutes = Number.isFinite(user.minutes) ? user.minutes : 0;
    const certs = Number.isFinite(user.certificates) ? user.certificates : 0;
    const today = new Date().toLocaleDateString('zh-CN', {
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
    });
    const todo = collectTodo(courses).slice(0, 8);

    container.innerHTML = `
      <header class="cmpy-page-head">
        <p class="cmpy-kicker">${esc(today)}</p>
        <h1 class="cmpy-page-title">欢迎回来，${esc(user.name || '同学')}</h1>
        <p class="cmpy-page-sub">${courses.length
          ? `你正在学习 ${active} 门课程，还有 ${pending} 份作业待完成。`
          : '正在读取你的学习数据…'}</p>
      </header>
      <div class="cmpy-cards">
        ${card(minutes, '已学习', '分钟')}
        ${card(active, '进行中', '课程')}
        ${card(pending, '待交', '作业')}
        ${card(certs, '已获', '证书')}
      </div>
      <section class="cmpy-section">
        <div class="cmpy-section-head">
          <h2>课程进度</h2>
          <a class="cmpy-link" href="/student/my_course_list.php">全部课程 →</a>
        </div>
        <div class="cmpy-list">${courses.map(courseRow).join('') || emptyRow('还没有课程数据')}</div>
      </section>
      <section class="cmpy-section">
        <div class="cmpy-section-head">
          <h2>待办作业</h2>
          <span class="cmpy-muted">${pending ? `${pending} 份待完成` : ''}</span>
        </div>
        <div class="cmpy-list">${todo.map(todoRow).join('') || emptyRow('没有待办作业，保持这个节奏。')}</div>
      </section>
      ${footer(data)}`;

    bindCommon(container);
    document.body.classList.toggle('cmpy-view-ready', courses.length > 0);
  }

  /* ----------------------------- 我的课程 ----------------------------- */
  function renderCourses(container, data) {
    const all = data.courses || [];
    const filter = ui.courseFilter;
    const courses = all.filter((c) => {
      const ended = /结束/.test(c.status || '');
      if (filter === 'doing') return !ended;
      if (filter === 'ended') return ended;
      return true;
    });

    container.innerHTML = `
      <div class="cmpy-toolbar-row">
        ${seg('course-filter', [['all', '全部'], ['doing', '进行中'], ['ended', '已结束']], filter)}
        <span class="cmpy-muted">${courses.length} 门课程</span>
      </div>
      <div class="cmpy-list">${courses.map(courseRow).join('') || emptyRow(all.length ? '没有符合条件的课程' : '正在读取课程…')}</div>
      ${footer(data)}`;

    bindCommon(container);
    bindSeg(container);
    document.body.classList.toggle('cmpy-view-ready', all.length > 0);
  }

  /* ----------------------------- 课程内部 ----------------------------- */
  function chapterTitleFor(course, num) {
    const raw = String(num || '').replace(/\D/g, '');
    const chapter = (course && course.chapters || []).find((c) => {
      const cn = String(c.num || '').replace(/\D/g, '');
      return cn && raw && cn === raw;
    });
    return (chapter && chapter.title) || (raw ? `第 ${raw} 章` : '课程目录');
  }

  function chaptersView(course, chapters, openState) {
    if (!chapters.length) return empty('这个筛选下没有内容。');
    return `<div class="cmpy-chapters">${chapters.map((chapter, index) => {
      const videos = chapter.items.filter((x) => /视频/.test(x.type || '')).length;
      const homework = chapter.items.filter((x) => /作业/.test(x.type || '')).length;
      const open = openState.has(chapter.num)
        ? openState.get(chapter.num)
        : index === 0;
      return `<details class="cmpy-chapter" data-chapter="${esc(chapter.num || '')}" ${open ? 'open' : ''}>
        <summary class="cmpy-chapter-head">
          <span class="cmpy-chapter-num">${esc(chapter.num || '')}</span>
          <span class="cmpy-chapter-title">${esc(chapter.title || '未命名章节')}</span>
          <span class="cmpy-chapter-meta">${[videos ? `${videos} 视频` : '', homework ? `${homework} 作业` : ''].filter(Boolean).join(' · ')}</span>
          <span class="cmpy-chapter-chev">›</span>
        </summary>
        <div class="cmpy-list cmpy-chapter-list">${chapter.items.map(lessonRow).join('')}</div>
      </details>`;
    }).join('')}</div>`;
  }

  function materialsView(course) {
    const materials = course.materials || [];
    const resource = safeHref(materialsUrl(course));
    if (!materials.length) {
      return `<div class="cmpy-empty">这门课还没有可整理的资料。${resource
        ? ` <a class="cmpy-link" href="${esc(resource)}" target="_blank" rel="noopener">打开资源下载页 →</a>`
        : ''}</div>`;
    }
    const kinds = [...new Set(materials.map((m) => m.kind).filter(Boolean))];
    const kindOptions = ['all', ...kinds].map((k) =>
      `<option value="${esc(k)}" ${ui.materialKind === k ? 'selected' : ''}>${k === 'all' ? '全部类型' : esc(k)}</option>`
    ).join('');
    const groups = groupBy(materials, (m) => m.chapter || '课程资料');

    return `<div class="cmpy-material-tools">
        <input class="cmpy-input" type="search" placeholder="搜索资料名称或章节…" data-material-search value="${esc(ui.materialSearch)}">
        <select class="cmpy-select" data-material-kind>${kindOptions}</select>
      </div>
      <div class="cmpy-materials">${Object.entries(groups).map(([chapter, list]) => `
        <section class="cmpy-material-group">
          <h3 class="cmpy-material-chapter">${esc(chapter)}</h3>
          <div class="cmpy-list">${list.map((m) => `<a class="cmpy-item cmpy-material-row"
            data-kind="${esc(m.kind || '')}"
            data-search="${esc(`${m.title} ${chapter}`.toLowerCase())}"
            href="${esc(safeHref(m.href))}" target="_blank" rel="noopener">
            <span class="cmpy-file-kind">${esc(m.kind || '文件')}</span>
            <span class="cmpy-item-main">
              <span class="cmpy-item-title">${esc(m.title || '未命名资料')}</span>
              <span class="cmpy-item-sub">${esc(chapter)}</span>
            </span>
            <span class="cmpy-chev">↓</span>
          </a>`).join('')}</div>
        </section>`).join('')}</div>
      <p class="cmpy-empty" data-material-none hidden>没有匹配的资料。</p>`;
  }

  function renderSections(container, data) {
    const course = (window.CMPY_DATA && window.CMPY_DATA.currentCourse()) ||
      (data.courses || []).find((c) => (c.chapters || []).length);
    if (!course || !(course.chapters || []).length) {
      container.innerHTML = empty('正在读取课程目录…');
      document.body.classList.remove('cmpy-view-ready');
      return;
    }

    const openState = new Map();
    $$('.cmpy-chapter', container).forEach((node) => openState.set(node.dataset.chapter, node.open));

    const p = progressOf(course);
    const t = taskOf(course);
    const materials = course.materials || [];
    const filter = ui.sectionFilter;
    const chapters = (course.chapters || []).map((chapter) => ({
      ...chapter,
      items: (chapter.items || []).filter((item) => {
        if (filter === 'video') return /视频/.test(item.type || '');
        if (filter === 'homework') return /作业/.test(item.type || '');
        return true;
      }),
    })).filter((chapter) => chapter.items.length);

    container.innerHTML = `
      <header class="cmpy-page-head">
        <p class="cmpy-kicker">${esc([course.termLabel, course.school, course.teacher].filter(Boolean).join(' · '))}</p>
        <h1 class="cmpy-page-title">${esc(course.title || '课程')}</h1>
        <p class="cmpy-page-sub">${esc([fmtRange(course.dateRange), course.status].filter(Boolean).join(' · '))}</p>
      </header>
      <div class="cmpy-cards">
        ${card(p.total ? `${p.done}/${p.total}` : '—', '视频进度', p.total ? `${p.percent}%` : '')}
        ${card(t.pending, '待交作业', t.total || '')}
        ${card(materials.length || '—', '课程资料', '')}
        ${card((course.chapters || []).length, '章节', '')}
      </div>
      <div class="cmpy-toolbar-row">
        ${seg('section-filter', [['all', '全部'], ['video', '视频'], ['homework', '作业'], ['materials', '资料']], filter)}
        <span class="cmpy-muted">${p.total ? `${p.done}/${p.total} 节` : ''}${t.total ? ` · ${t.pending}/${t.total} 作业待交` : ''}</span>
      </div>
      ${filter === 'materials' ? materialsView(course) : chaptersView(course, chapters, openState)}
      ${footer(data)}`;

    bindCommon(container);
    bindSeg(container);
    bindChapters(container);
    bindMaterials(container);
    document.body.classList.add('cmpy-view-ready');
  }

  /* ----------------------------- 视频页 ----------------------------- */
  function videoGroups(course, videos) {
    const groups = [];
    const map = new Map();
    videos.forEach((video) => {
      const num = String(video.section || '').split('.')[0] || '';
      if (!map.has(num)) {
        map.set(num, { num, items: [] });
        groups.push(map.get(num));
      }
      map.get(num).items.push(video);
    });
    return groups.map((group) => `<div class="cmpy-video-group">
      <div class="cmpy-video-group-title">${esc(chapterTitleFor(course, group.num))}</div>
      ${group.items.map((video) => {
        const href = safeHref(video.href);
        const tag = href ? 'a' : 'div';
        return `<${tag} class="cmpy-video-item${video.active ? ' active' : ''}"${href ? ` href="${esc(href)}"` : ''} title="${esc(video.describe || video.title || '')}">
          <span class="cmpy-video-item-name">${esc(video.describe || video.title || '未命名视频')}</span>
          <span class="cmpy-video-item-time">${esc(video.time || '')}</span>
        </${tag}>`;
      }).join('')}
    </div>`).join('');
  }

  function renderVideo(data) {
    const current = window.CMPY_DATA ? window.CMPY_DATA.parseCurrentPage() : null;
    const currentCourse = current && current.courses && current.courses[0];
    const course = (window.CMPY_DATA && window.CMPY_DATA.currentCourse()) || currentCourse;
    const videos = (course && course.videos && course.videos.length ? course.videos : (currentCourse && currentCourse.videos)) || [];
    if (!videos.length) return;

    const info = $('.student-video-info');
    if (!info) return;

    const active = videos.find((v) => v.active) || current?.currentVideo || videos[0];
    const center = $('.student-video-center') || info.parentElement;

    let head = $('.cmpy-video-head');
    if (head) head.remove();
    head = el('div', 'cmpy-video-head');
    head.innerHTML = `
      <p class="cmpy-kicker">${esc(course?.title || '视频')}</p>
      <h1 class="cmpy-video-title">${esc(active?.describe || active?.title || document.title)}</h1>`;
    const breadcrumb = $('.breadcrumb', center || document);
    if (breadcrumb) breadcrumb.insertAdjacentElement('afterend', head);
    else info.parentElement.insertBefore(head, info);

    let rail = $('.cmpy-video-rail');
    if (!rail) {
      rail = el('aside', 'cmpy-video-rail');
      info.appendChild(rail);
    }
    rail.innerHTML = `
      <div class="cmpy-video-rail-head">
        <span class="cmpy-video-rail-title">课程目录</span>
        <span class="cmpy-video-rail-count">${videos.length} 节</span>
      </div>
      <div class="cmpy-video-rail-list">${videoGroups(course, videos)}</div>`;

    const list = $('.cmpy-video-rail-list', rail);
    const activeNode = $('.cmpy-video-item.active', rail);
    if (list && activeNode) {
      requestAnimationFrame(() => {
        const itemRect = activeNode.getBoundingClientRect();
        const listRect = list.getBoundingClientRect();
        list.scrollTop += itemRect.top - listRect.top
          - (list.clientHeight - itemRect.height) / 2;
      });
    }

    let summary = $('.cmpy-video-summary');
    if (!summary) {
      summary = el('div', 'cmpy-video-summary');
      info.insertAdjacentElement('afterend', summary);
    }
    const p = course ? progressOf(course) : null;
    const t = course ? taskOf(course) : null;
    summary.innerHTML = `
      <span class="cmpy-video-summary-item"><i>本课进度</i><b>${p && p.total ? `${p.done}/${p.total} 节` : '—'}</b></span>
      <span class="cmpy-video-summary-item"><i>待交作业</i><b>${t && t.total ? `${t.pending}/${t.total}` : '—'}</b></span>
      ${course && course.id ? `<a class="cmpy-video-summary-link" href="${esc(safeHref(materialsUrl(course)))}" target="_blank" rel="noopener">课程资料 →</a>
      <a class="cmpy-video-summary-link" href="${esc(safeHref(courseUrl(course)))}" target="_blank" rel="noopener">课程目录 →</a>` : ''}`;

    document.body.classList.add('cmpy-video-ready');
  }

  /* ----------------------------- 交互 ----------------------------- */
  function exportData() {
    const data = state();
    const text = JSON.stringify({
      exportedAt: new Date().toISOString(),
      data,
    }, null, 2);
    try {
      chrome.runtime.sendMessage({
        type: 'cmpy-download-json',
        filename: 'chinesemooc-learning-data.json',
        text,
      }, () => void chrome.runtime.lastError);
    } catch (e) { /* 忽略 */ }
  }

  function bindCommon(container) {
    $$('[data-act="refresh"]', container).forEach((button) => {
      button.addEventListener('click', async () => {
        const old = button.textContent;
        button.disabled = true;
        button.textContent = '刷新中…';
        try {
          await window.CMPY_DATA.refresh(true);
        } finally {
          button.disabled = false;
          button.textContent = old;
        }
      });
    });
    $$('[data-act="export"]', container).forEach((button) => {
      button.addEventListener('click', exportData);
    });
  }

  function bindSeg(container) {
    $$('.cmpy-seg', container).forEach((bar) => {
      bar.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (!button || !bar.dataset.seg) return;
        const value = button.dataset.value;
        if (bar.dataset.seg === 'course-filter') ui.courseFilter = value;
        if (bar.dataset.seg === 'section-filter') ui.sectionFilter = value;
        render();
      });
    });
  }

  function bindChapters(container) {
    $$('.cmpy-chapter', container).forEach((details) => {
      details.addEventListener('toggle', () => {
        const num = details.dataset.chapter;
        if (!num) return;
        // 打开状态在下一次 render 时从 DOM 读取，因此这里不需要额外状态
      });
    });
  }

  function applyMaterialFilter(container) {
    const input = $('[data-material-search]', container);
    const select = $('[data-material-kind]', container);
    const q = (input ? input.value : ui.materialSearch).trim().toLowerCase();
    const kind = select ? select.value : ui.materialKind;
    let visible = 0;

    $$('.cmpy-material-row', container).forEach((row) => {
      const text = row.dataset.search || '';
      const show = (!q || text.includes(q)) && (kind === 'all' || row.dataset.kind === kind);
      row.hidden = !show;
      if (show) visible += 1;
    });
    $$('.cmpy-material-group', container).forEach((group) => {
      group.hidden = !Array.from(group.querySelectorAll('.cmpy-material-row')).some((row) => !row.hidden);
    });
    const none = $('[data-material-none]', container);
    if (none) none.hidden = visible > 0;
  }

  function bindMaterials(container) {
    const input = $('[data-material-search]', container);
    if (!input) return;
    const select = $('[data-material-kind]', container);
    input.addEventListener('input', () => {
      ui.materialSearch = input.value;
      applyMaterialFilter(container);
    });
    if (select) {
      select.addEventListener('change', () => {
        ui.materialKind = select.value;
        applyMaterialFilter(container);
      });
    }
    applyMaterialFilter(container);
  }

  /* ----------------------------- 调度 ----------------------------- */
  function render() {
    const kind = document.body.dataset.cmpyStudent;
    if (!kind) return;
    if (kind === 'video') {
      renderVideo(state());
      return;
    }

    const container = ensureRoot(kind);
    if (!container) return;
    const data = state();
    if (kind === 'index') renderIndex(container, data);
    else if (kind === 'courses') renderCourses(container, data);
    else if (kind === 'sections') renderSections(container, data);
  }

  async function init() {
    const kind = document.body.dataset.cmpyStudent;
    if (!kind || kind === 'other') return;
    if (!window.CMPY_DATA) return;

    window.CMPY_DATA.subscribe(render);
    window.CMPY_DATA.mergeCurrentPage();
    try { await window.CMPY_DATA.load(); } catch (e) { /* 忽略 */ }
    window.CMPY_DATA.mergeCurrentPage();
    render();
    try {
      await window.CMPY_DATA.refresh();
    } catch (e) {
      console.warn('[华文慕课 Plus] 同步学习数据失败', e && e.message);
    }
  }

  window.CMPY_VIEW = { init, render };
})();
