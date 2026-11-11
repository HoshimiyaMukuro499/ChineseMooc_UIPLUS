/* ==========================================================================
   华文慕课 Plus — 学习中心数据层
   在已登录的页面里用同源 fetch 读取站点自己的页面，解析成规范化数据。
   不读取、不复制、不上传 Cookie；只缓存解析后的结构化数据。
   ========================================================================== */
(() => {
  if (window.CMPY_DATA) return;

  const STORAGE_KEY = 'cmpyData';
  const TTL = 10 * 60 * 1000;
  const MAX_COURSES = 30;
  const CONCURRENCY = 6;

  const listeners = new Set();
  let state = emptyState();
  let loading = null;

  function emptyState() {
    return { updatedAt: 0, stale: false, user: null, courses: [] };
  }

  /* ----------------------------- 基础工具 ----------------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function text(el, sel) {
    const node = sel ? el?.querySelector(sel) : el;
    return (node?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function int(v, fallback = 0) {
    const m = String(v ?? '').match(/-?\d+/);
    return m ? parseInt(m[0], 10) : fallback;
  }

  function fraction(v) {
    const m = String(v ?? '').match(/(\d+)\s*\/\s*(\d+)/);
    return m ? { done: parseInt(m[1], 10), total: parseInt(m[2], 10) } : null;
  }

  function clean(obj) {
    const out = {};
    Object.entries(obj || {}).forEach(([k, v]) => {
      if (v === undefined || v === null || v === '') return;
      out[k] = v;
    });
    return out;
  }

  function abs(href, base) {
    if (!href) return '';
    try { return new URL(href, base || location.href).href; } catch (e) { return href; }
  }

  function idsFromUrl(url) {
    // 没有 href 时不能退回 location.href，否则“当前课程”会被当成卡片自己的课程
    if (!url) return {};
    try {
      const u = new URL(url, location.href);
      const id = u.searchParams.get('courseid');
      const termId = u.searchParams.get('termid');
      return id && termId ? { id, termId } : (id ? { id } : {});
    } catch (e) {
      return {};
    }
  }

  function keyOf(c) {
    return c && c.id && c.termId ? `${c.id}:${c.termId}` : '';
  }

  function courseHref(c) {
    if (!c || !c.id || !c.termId) return '';
    return `/student/term_section_list.php?courseid=${encodeURIComponent(c.id)}&termid=${encodeURIComponent(c.termId)}`;
  }

  function homeHref(c) {
    if (!c || !c.id || !c.termId) return '';
    return `/student/student_download_courseware.php?courseid=${encodeURIComponent(c.id)}&termid=${encodeURIComponent(c.termId)}`;
  }

  /* ----------------------------- 解析：个人中心 ----------------------------- */
  function parseIndex(doc, base) {
    const user = {};
    const welcome = text(doc, '.welcome-wrap-strong');
    const name = welcome.replace(/^欢迎回来[，,]\s*/, '').trim();
    if (name) user.name = name;

    $$('.welcome-wrap-item', doc).forEach((item) => {
      const label = text(item, '.welcome-wrap-item__right-text');
      const value = int(text(item, '.welcome-wrap-item__right-strong'));
      if (label.includes('已学习')) user.minutes = value;
      else if (label.includes('进行中')) user.activeCourses = value;
      else if (label.includes('证书')) user.certificates = value;
    });

    if (!user.name) {
      const headerName = text(doc, '.header-user-name');
      if (headerName) user.name = headerName;
    }

    const courses = [];
    $$('.mycourse-wrap-list__item', doc).forEach((card) => {
      const link = $('a[href*="term_section_list.php"]', card);
      const ids = idsFromUrl(link?.getAttribute('href') || '');
      if (!ids.id || !ids.termId) return;
      const progressText = text(card, '.progress-row span');
      const fr = fraction(progressText);
      const value = int($('.progress-row progress', card)?.getAttribute('value'), NaN);
      const course = {
        ...ids,
        title: text(card, '.title-row-text a') || text(card, '.title-row-text'),
        kind: text(card, '.title-row-tag'),
        termLabel: text(card, '.calendar-row-text'),
        mode: text(card, '.calendar-row-tag'),
        dateRange: text(card, '.daterange-row-text'),
        status: text(card, '[class*="daterange-row-status"]') || '正在进行',
        progress: fr ? { done: fr.done, total: fr.total, percent: Number.isFinite(value) ? value : Math.round((fr.done / Math.max(1, fr.total)) * 100) } : undefined,
        href: courseHref({ ...ids }),
      };
      courses.push(clean(course));
    });

    // 主页的“我的任务”卡片给出每门课的待交作业数（3/8）
    $$('.task-wrap-item', doc).forEach((task) => {
      const title = text(task, '.task-wrap-item__title');
      const fr = fraction(text(task, '.task-wrap-item__progress span'));
      if (!fr) return;
      const taskIds = idsFromUrl(task.getAttribute('href') || '');
      const course =
        (taskIds.id && courses.find((c) => c.id === taskIds.id && c.termId === taskIds.termId)) ||
        courses.find((c) => c.title === title) ||
        courses.find((c) => title && (c.title.includes(title) || title.includes(c.title)));
      if (!course) return;
      // 卡片上的 3/8 是“已完成/总数”，待交要取差值
      course.tasks = {
        pending: Math.max(0, fr.total - fr.done),
        done: fr.done,
        total: fr.total,
      };
    });

    return { user: clean(user), courses };
  }

  /* ----------------------------- 解析：我的课程 ----------------------------- */
  function parseCourseList(doc, base) {
    const courses = [];
    $$('ul.student-course-list > li', doc).forEach((li) => {
      const link = $('.course-right a[href*="term_section_list.php"]', li);
      const ids = idsFromUrl(link?.getAttribute('href') || '');
      if (!ids.id || !ids.termId) return;
      const progressText = text(li, '.course-middle .value span');
      const fr = fraction(progressText);
      const width = $('.course-time.time i', li)?.textContent || '';
      const statusTag = $('.course-time.time i', li);
      const schedule = int(($('.schedule', li)?.getAttribute('style') || '').match(/width\s*:\s*(\d+)/)?.[1], NaN);
      courses.push(clean({
        ...ids,
        title: text(li, '.course-title h4'),
        kind: text(li, '.course-flag i'),
        termLabel: text(li, '.course-time.semester span').replace(/\s+/g, ' '),
        mode: text(li, '.course-time.semester i'),
        dateRange: text(li, '.course-time.time span'),
        status: text(statusTag) || '正在进行',
        progress: fr ? {
          done: fr.done,
          total: fr.total,
          percent: Number.isFinite(schedule) ? schedule : Math.round((fr.done / Math.max(1, fr.total)) * 100),
        } : undefined,
        href: courseHref({ ...ids }),
      }));
    });
    return { courses };
  }

  /* ----------------------------- 解析：课程页头 ----------------------------- */
  function parseCourseHeader(doc) {
    const titleFull = text(doc, '.subheader-info-title__text');
    let title = titleFull;
    let termLabel = '';
    const m = titleFull.match(/^(.*?)\s*-\s*(.+)$/);
    if (m) {
      title = m[1].trim();
      termLabel = m[2].trim();
    }
    const tags = $$('.subheader-info-tag', doc).map((e) => text(e)).filter(Boolean);
    const desc = $$('.subheader-info-desc__text', doc).map((e) => text(e)).filter(Boolean);
    let school = '';
    let teacher = '';
    if (desc[0]) {
      const parts = desc[0].split(/\s+/);
      school = parts.shift() || '';
      teacher = parts.join(' ');
    }
    const totals = {};
    $$('.subheader-statis-item', doc).forEach((item) => {
      const label = text(item, '.subheader-statis-item__text');
      const value = int(text(item, '.subheader-statis-item__num'));
      if (label.includes('视频')) totals.videos = value;
      else if (label.includes('作业')) totals.assignments = value;
    });
    return clean({
      title,
      termLabel,
      kind: tags[0] || '',
      mode: tags[1] || '',
      school,
      teacher,
      startDate: desc[1] ? desc[1].replace(/\s*开课$/, '') : '',
      totals: Object.keys(totals).length ? totals : undefined,
    });
  }

  /* ----------------------------- 解析：课程目录 ----------------------------- */
  const FILE_RE = /\.(pdf|ppt|pptx|doc|docx|xls|xlsx|zip|rar|7z|mp4|mov|avi|txt|md|csv)(\?|#|$)/i;

  function materialKind(href, label) {
    const m = String(href || '').match(FILE_RE);
    if (m) {
      const ext = m[1].toLowerCase();
      if (ext === 'pdf') return 'PDF';
      if (ext === 'ppt' || ext === 'pptx') return 'PPT';
      if (ext === 'doc' || ext === 'docx') return 'Word';
      if (ext === 'xls' || ext === 'xlsx') return '表格';
      if (ext === 'zip' || ext === 'rar' || ext === '7z') return '压缩包';
      if (ext === 'mp4' || ext === 'mov' || ext === 'avi') return '视频';
      return ext.toUpperCase();
    }
    if (/课件|讲义|材料|资料/.test(label)) return '课件';
    return '文件';
  }

  function parseChapters(doc, base, ids) {
    const chapters = [];
    const assignments = { pending: 0, ongoing: 0, graded: 0, total: 0 };
    const materials = [];

    $$('dl.first-card', doc).forEach((dl) => {
      const head = $('dt.first-head', dl);
      const chapter = {
        num: text(head, '.num'),
        title: text(head, '.tag'),
        items: [],
      };
      if (!chapter.title && !chapter.num) return;

      let section = { num: '', title: '' };
      $$('dd.second-card > ul > li', dl).forEach((li) => {
        if (li.classList.contains('second-head')) {
          section = { num: text(li, '.num'), title: text(li, '.tag') };
          return;
        }
        if (!li.classList.contains('second-list')) return;

        const type = text(li, '.type');
        const title = text(li, '.title-name') || text(li, '.list-top .title') || text(li, '.list-left a');
        const a = $('.list-left a[href], .list-top a[href], a[href]', li);
        let href = a ? a.getAttribute('href') : '';
        if (href.startsWith('javascript:gopaper')) {
          const m = href.match(/gopaper\((\d+)\s*,\s*(\d+)\)/);
          if (m) {
            href = `/student/term_coursetask_detail_start.php?courseid=${encodeURIComponent(ids.id || '')}&termid=${encodeURIComponent(ids.termId || '')}&homeworkid=${m[1]}&sort=${m[2]}`;
          }
        } else if (href) {
          href = abs(href, base);
        }

        const times = $$('.list-right .time', li).map((e) => text(e));
        const tips = $$('.list-right .tips', li).map((e) => ({ text: text(e), cls: e.className }));
        const deadline = (times.find((t) => t.includes('截止')) || '').replace(/^提交截止时间\s*[:：]\s*/, '');
        const submit = (times.find((t) => t.includes('提交次数')) || '').replace(/^提交次数\s*[:：]\s*/, '');

        let status = null;
        if (tips.some((t) => /作业待完成|未提交/.test(t.text))) status = 'pending';
        else if (tips.some((t) => /成绩已公布|已完成/.test(t.text))) status = 'graded';
        else if (tips.some((t) => /已结束|已关闭/.test(t.text))) status = 'closed';
        else if (tips.some((t) => /正在进行/.test(t.text))) status = 'open';

        const isHomework = /作业/.test(type);
        if (isHomework) {
          assignments.total += 1;
          if (status === 'pending') assignments.pending += 1;
          if (status === 'graded') assignments.graded += 1;
          if (tips.some((t) => /正在进行/.test(t.text))) assignments.ongoing += 1;
        }

        const item = clean({
          type,
          title,
          sectionNum: section.num,
          sectionTitle: section.title,
          href,
          status,
          deadline,
          submit,
          tips,
        });
        chapter.items.push(item);

        // 目录里的课件/材料行，以及带文件扩展名的链接，都收进资料
        const isMaterialType = /课件|材料|资料|讲义/.test(type);
        const links = $$('a[href]', li).filter((x) => {
          const h = x.getAttribute('href') || '';
          return h && !h.startsWith('javascript') && (FILE_RE.test(h) || isMaterialType);
        });
        links.forEach((x) => {
          const h = abs(x.getAttribute('href'), base);
          const label = text(x) || title;
          materials.push(clean({
            chapter: chapter.title,
            title: label,
            href: h,
            kind: materialKind(h, label),
          }));
        });
      });

      if (chapter.items.length) chapters.push(chapter);
    });

    return { chapters, assignments, materials: dedupeMaterials(materials) };
  }

  function dedupeMaterials(list) {
    const seen = new Set();
    return list.filter((m) => {
      const k = m.href || `${m.chapter}|${m.title}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /* ----------------------------- 解析：资源下载页 ----------------------------- */
  function parseMaterialsPage(doc, base) {
    const out = [];
    $$('a[href]', doc).forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (!href || href.startsWith('javascript') || href === '#') return;
      const label = text(a) || a.getAttribute('title') || '';
      const nearby = a.closest('.download-item, .detail-download-list, .item-material, .material-item, .second-list, .course-list-wrap');
      const isFile = FILE_RE.test(href);
      if (!isFile && !nearby) return;
      if (!isFile && !/下载|附件|课件|资料|讲义/.test(label)) return;
      if (/登录|退出|课程公告|课程内容|课程任务|课后作业|综合考试|评阅任务|课程社区|学习结果|我的课程|作业|考试/.test(label)) return;

      const card = a.closest('dl.first-card');
      const chapter = card ? (text(card, '.first-head .tag') || text(card, '.first-head .tag-wrap')) : '课程资料';
      const title = label || decodeURIComponent((href.split('/').pop() || '').split('?')[0]);
      out.push(clean({
        chapter: chapter || '课程资料',
        title,
        href: abs(href, base),
        kind: materialKind(href, label),
      }));
    });
    return dedupeMaterials(out);
  }

  /* ----------------------------- 解析：视频目录 ----------------------------- */
  function parseVideoDirectory(doc, base) {
    // 页面同时存在非全屏（#pageOper）和全屏（#dragOperate）两份目录，只取一份
    const scope = $('#pageOper', doc) || $('#dragOperate', doc);
    const nodes = (scope && $$('.oper-directory .directory-item', scope).length)
      ? $$('.oper-directory .directory-item', scope)
      : $$('.oper-directory .directory-item', doc);
    const items = [];
    const seen = new Map();
    nodes.forEach((li) => {
      const a = li.closest('a[href]');
      const name = text(li, '.name') || text(li, '.title');
      if (!name) return;
      const timeText = text(li, '.time');
      const time = (timeText.match(/\d{1,2}:\d{2}(?::\d{2})?/) || [timeText])[0];
      const describe = text(li, '.describe');
      const section = (describe.match(/^(\d+(?:\.\d+)?)/) || [])[1] || '';
      const href = a ? abs(a.getAttribute('href'), base) : '';
      const key = href || `${describe}|${time}`;
      if (seen.has(key)) {
        if (li.classList.contains('active')) seen.get(key).active = true;
        return;
      }
      const item = clean({
        title: name,
        time,
        describe,
        section,
        href,
        active: li.classList.contains('active'),
      });
      seen.set(key, item);
      items.push(item);
    });
    return items;
  }

  /* ----------------------------- 当前页解析 ----------------------------- */
  function parseCurrentPage() {
    const kind = document.body.dataset.cmpyStudent;
    if (!kind) return null;
    try {
      if (kind === 'index') return parseIndex(document, location.href);
      if (kind === 'courses') return { courses: parseCourseList(document, location.href).courses };
      if (kind === 'sections') {
        const ids = idsFromUrl(location.href);
        const meta = parseCourseHeader(document);
        const parsed = parseChapters(document, location.href, ids);
        return { courses: [clean({ ...ids, ...meta, ...parsed, href: courseHref(ids) })] };
      }
      if (kind === 'video') {
        const ids = idsFromUrl(location.href);
        const meta = parseCourseHeader(document);
        const videos = parseVideoDirectory(document, location.href);
        return {
          courses: [clean({ ...ids, ...meta, videos, href: courseHref(ids) })],
          currentVideo: videos.find((v) => v.active) || null,
        };
      }
    } catch (e) {
      console.warn('[华文慕课 Plus] 解析当前页失败', e && e.message);
    }
    return null;
  }

  /* ----------------------------- 合并 ----------------------------- */
  function mergeCourse(base, patch) {
    if (!base) return clean({ ...patch });
    if (!patch) return base;
    const out = { ...base };
    Object.entries(clean(patch)).forEach(([k, v]) => {
      if (k === 'progress' || k === 'tasks' || k === 'totals' || k === 'assignments') {
        out[k] = clean({ ...(base[k] || {}), ...(v || {}) });
      } else if (k === 'chapters' || k === 'materials' || k === 'videos') {
        // 交给下面的“取更完整的一份”，避免当前页的空数组覆盖已抓到的数据
      } else {
        out[k] = v;
      }
    });

    // 章节、资料、视频目录取“更完整”的一份，避免被首屏片段覆盖
    for (const k of ['chapters', 'materials', 'videos']) {
      if (Array.isArray(patch[k]) && patch[k].length >= (base[k] || []).length) out[k] = patch[k];
    }
    return out;
  }

  function mergeData(base, patch) {
    const out = {
      updatedAt: base?.updatedAt || 0,
      stale: base?.stale || false,
      user: { ...(base?.user || {}), ...(patch?.user || {}) },
      courses: [...(base?.courses || [])],
    };
    if (patch?.currentVideo) out.currentVideo = patch.currentVideo;

    const map = new Map(out.courses.map((c) => [keyOf(c), c]));
    (patch?.courses || []).forEach((c) => {
      const k = keyOf(c);
      if (!k) return;
      if (map.has(k)) map.set(k, mergeCourse(map.get(k), c));
      else map.set(k, clean(c));
    });
    out.courses = [...map.values()].filter((c) => c.title || (c.chapters || []).length);
    return out;
  }

  /* ----------------------------- 网络 ----------------------------- */
  async function fetchDoc(path) {
    try {
      const res = await fetch(path, { credentials: 'include' });
      if (!res.ok) return null;
      if (/login\.php/i.test(res.url)) return null;
      const html = await res.text();
      if (html.length < 200) return null;
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const title = (doc.title || '').trim();
      if (/登录/.test(title) && !/个人中心|学习中心|我的课程|课程内容|视频/.test(title)) return null;
      return { doc, html, title, url: res.url };
    } catch (e) {
      return null;
    }
  }

  async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let index = 0;
    const workers = Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
      while (index < items.length) {
        const i = index++;
        out[i] = await fn(items[i], i);
      }
    });
    await Promise.all(workers);
    return out;
  }

  /* ----------------------------- 状态与订阅 ----------------------------- */
  function get() { return state; }
  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  function notify() {
    listeners.forEach((fn) => {
      try { fn(state); } catch (e) { console.warn('[华文慕课 Plus] 渲染失败', e && e.message); }
    });
  }

  function currentCourse() {
    const ids = idsFromUrl(location.href);
    if (!ids.id) return null;
    return state.courses.find((c) => c.id === ids.id && (!ids.termId || c.termId === ids.termId)) || null;
  }

  function mergeCurrentPage() {
    const current = parseCurrentPage();
    if (!current) return state;
    state = mergeData(state, current);
    notify();
    return state;
  }

  async function load() {
    try {
      const got = await chrome.storage.local.get({ [STORAGE_KEY]: null });
      const cached = got[STORAGE_KEY];
      if (cached && Array.isArray(cached.courses)) {
        state = mergeData(cached, {});
        notify();
        return state;
      }
    } catch (e) { /* 忽略 */ }
    return null;
  }

  function isFresh() {
    return state.updatedAt && Date.now() - state.updatedAt < TTL;
  }

  /* 打开某门课时，保证这门课的目录与资料就绪。
     总览抓取按性能优先只取进行中的课程，缓存里可能缺当前课程的详情；
     这里只补当前这门，两个请求并行，并且按课程记录时间戳避免重复抓。 */
  let detailsLoading = null;

  async function ensureCourseDetails(force = false) {
    if (detailsLoading) return detailsLoading;
    const ids = idsFromUrl(location.href);
    if (!ids.id) return state;

    const existing = currentCourse();
    const course = existing || clean({ id: ids.id, termId: ids.termId || '' });
    if (!course.termId) return state;

    const now = Date.now();
    const needTerm = force || !(course.chapters || []).length
      || !course.termAt || now - course.termAt > TTL;
    const needMaterials = force || !course.materialsAt || now - course.materialsAt > TTL;
    if (!needTerm && !needMaterials) return state;

    detailsLoading = (async () => {
      const termPath = `/student/term_section_list.php?courseid=${encodeURIComponent(course.id)}&termid=${encodeURIComponent(course.termId)}`;
      const matPath = `/student/student_download_courseware.php?courseid=${encodeURIComponent(course.id)}&termid=${encodeURIComponent(course.termId)}`;
      const [termRes, matRes] = await Promise.all([
        needTerm ? fetchDoc(termPath) : Promise.resolve(null),
        needMaterials ? fetchDoc(matPath) : Promise.resolve(null),
      ]);

      if (termRes || matRes) {
        const patch = {};
        if (termRes) {
          Object.assign(patch, parseCourseHeader(termRes.doc));
          Object.assign(patch, parseChapters(termRes.doc, termRes.url, course));
          patch.termAt = Date.now();
        }
        if (matRes) {
          patch.materials = parseMaterialsPage(matRes.doc, matRes.url);
          patch.materialsAt = Date.now();
        }
        const merged = mergeCourse(course, clean(patch));
        if (existing) Object.assign(existing, merged);
        else state = mergeData(state, { courses: [merged] });
        notify();
        try { await chrome.storage.local.set({ [STORAGE_KEY]: state }); } catch (e) { /* 忽略 */ }
      }
      return state;
    })().finally(() => { detailsLoading = null; });

    return detailsLoading;
  }

  async function refresh(force = false) {
    if (loading) return loading;
    const kind = document.body.dataset.cmpyStudent || 'other';
    const ids = idsFromUrl(location.href);
    const onCoursePage = (kind === 'sections' || kind === 'video') && !!ids.id;

    if (!force && isFresh()) {
      // 课程页即使总数据还新鲜，也要确保当前课程的目录/资料已经拿到
      if (kind === 'sections') return ensureCourseDetails();
      return state;
    }

    loading = (async () => {
      // 从已有缓存出发，只替换这次真正请求到的部分
      let data = mergeData(state, {});
      let failed = 0;

      const [indexRes, coursesRes] = await Promise.all([
        fetchDoc('/student/index.php'),
        fetchDoc('/student/my_course_list.php'),
      ]);

      if (indexRes) data = mergeData(data, parseIndex(indexRes.doc, indexRes.url));
      else failed += 1;

      if (coursesRes) data = mergeData(data, parseCourseList(coursesRes.doc, coursesRes.url));
      else failed += 1;

      // 个人中心 + 课程列表已经够画首屏，先更新一轮，别让课程详情阻塞
      if (indexRes || coursesRes) {
        state = { ...data, updatedAt: Date.now(), stale: failed > 0 };
        notify();
      }

      /* 按页面类型决定要抓哪些课程：
         - 课程页 / 视频页只处理当前这一门；
         - 总览与课程列表抓进行中的课程（已结束课程等真正打开时再取）；
         - 视频页的视频目录来自当前 DOM，不需要再请求课程页；
         - 资料页只在课程页抓，其它页面复用缓存。 */
      let targets;
      if (onCoursePage) {
        targets = data.courses.filter((c) => c.id === ids.id && (!ids.termId || c.termId === ids.termId));
        if (!targets.length && ids.termId) targets = [{ id: ids.id, termId: ids.termId }];
      } else {
        targets = data.courses
          .slice(0, MAX_COURSES)
          .filter((c) => !/结束/.test(c.status || ''));
      }

      // 总览需要章节里的截止日期来排待办；课程页只需要个人中心/课程列表的进度
      const needTerm = kind === 'index' || kind === 'sections';
      const needMaterials = kind === 'sections';

      await mapLimit(targets, CONCURRENCY, async (course) => {
        if (!course.id || !course.termId) return;
        const termPath = `/student/term_section_list.php?courseid=${encodeURIComponent(course.id)}&termid=${encodeURIComponent(course.termId)}`;
        const matPath = `/student/student_download_courseware.php?courseid=${encodeURIComponent(course.id)}&termid=${encodeURIComponent(course.termId)}`;

        // 课程目录与资料页互不依赖，并行请求
        const [termRes, matRes] = await Promise.all([
          needTerm ? fetchDoc(termPath) : Promise.resolve(null),
          needMaterials ? fetchDoc(matPath) : Promise.resolve(null),
        ]);

        if (termRes) {
          const meta = parseCourseHeader(termRes.doc);
          const parsed = parseChapters(termRes.doc, termRes.url, course);
          Object.assign(course, mergeCourse(course, clean({ ...meta, ...parsed, termAt: Date.now() })));
        } else if (needTerm) {
          failed += 1;
        }

        if (matRes) {
          const mats = parseMaterialsPage(matRes.doc, matRes.url);
          // 解析为空时保留之前抓到的资料，避免一次解析失败把列表清空
          if (mats.length || !(course.materials || []).length) course.materials = mats;
          course.materialsAt = Date.now();
        }
      });

      // 当前页 DOM 是最新、最准确的，最后合并
      const current = parseCurrentPage();
      if (current) data = mergeData(data, current);

      state = {
        ...data,
        updatedAt: Date.now(),
        stale: failed > 0,
      };
      notify();
      try { await chrome.storage.local.set({ [STORAGE_KEY]: state }); } catch (e) { /* 忽略 */ }
      return state;
    })().finally(() => { loading = null; });

    return loading;
  }

  /* ----------------------------- 导出接口 ----------------------------- */
  window.CMPY_DATA = {
    get,
    load,
    refresh,
    subscribe,
    currentCourse,
    mergeCurrentPage,
    parseCurrentPage,
    isFresh,
    courseHref,
    materialsHref: homeHref,
    keyOf,
  };
})();
