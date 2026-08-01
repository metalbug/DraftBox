import { t } from './i18n.js';

/**
 * 统一 UI 组件模块
 * @module ui-components
 * @description 整合了主题切换、回到顶部、确认弹窗、窗口控制和自定义滚动条功能
 */

// ==================== 1. 主题切换 (原 theme.js) ====================
export function initThemeToggle() {
  const html = document.documentElement;
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;

  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
  const sun = btn.querySelector('.sun-icon');
  const moon = btn.querySelector('.moon-icon');

  const applyTheme = (isDark) => {
    html.classList.toggle('dark', isDark);
    if (sun && moon) {
      sun.style.display = isDark ? 'inline-block' : 'none';
      moon.style.display = isDark ? 'none' : 'inline-block';
    }
  };

  applyTheme(prefersDark.matches);
  prefersDark.addEventListener('change', e => applyTheme(e.matches));

  btn.addEventListener('click', () => {
    const newDark = !html.classList.contains('dark');
    const toggle = () => applyTheme(newDark);
    document.startViewTransition ? document.startViewTransition(toggle) : toggle();
  });
}

// ==================== 2. 回到顶部 (原 go-to-top.js) ====================
export function initGoToTopButton() {
  const wrap = document.querySelector('.progress-wrap');
  if (!wrap) return;

  const path = wrap.querySelector('path');
  if (!path) return;

  const pathLength = path.getTotalLength();
  path.style.transition = 'none';
  path.style.strokeDasharray = `${pathLength} ${pathLength}`;
  path.style.strokeDashoffset = pathLength;
  path.getBoundingClientRect();
  path.style.transition = 'stroke-dashoffset 10ms linear';

  const scrollContainer = document.querySelector('.main-scroll') || document.documentElement;
  const isWindow = scrollContainer === document.documentElement;

  const updateProgress = () => {
    const scrollTop = isWindow ? window.scrollY : scrollContainer.scrollTop;
    const scrollHeight = isWindow ? document.documentElement.scrollHeight : scrollContainer.scrollHeight;
    const clientHeight = isWindow ? window.innerHeight : scrollContainer.clientHeight;
    const height = scrollHeight - clientHeight;
    const progress = height > 0 ? pathLength - (scrollTop * pathLength / height) : pathLength;

    path.style.strokeDashoffset = progress;
    wrap.classList.toggle('active-progress', scrollTop > 50);
  };

  (isWindow ? window : scrollContainer).addEventListener('scroll', updateProgress);
  updateProgress();

  wrap.addEventListener('click', e => {
    e.preventDefault();
    scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// ==================== 3. 确认弹窗 (原 confirm.js) ====================
let confirmCallback = null;

export function showConfirm(msg, x, y, callback) {
  const dialog = document.getElementById('confirm-dialog');
  if (!dialog) return;

  document.getElementById('confirm-msg').textContent = msg;
  confirmCallback = callback;

  const w = 260, h = 120;
  let left = x + 10, top = y + 10;
  if (left + w > window.innerWidth) left = x - w - 10;
  if (top + h > window.innerHeight) top = y - h - 10;

  dialog.style.left = `${left}px`;
  dialog.style.top = `${top}px`;
  dialog.classList.add('active');
}

export function closeConfirm() {
  const dialog = document.getElementById('confirm-dialog');
  if (dialog) dialog.classList.remove('active');
  confirmCallback = null;
}

export function initConfirmDialog() {
  const cancel = document.getElementById('confirm-cancel');
  const ok = document.getElementById('confirm-ok');

  cancel?.addEventListener('click', closeConfirm);
  ok?.addEventListener('click', () => {
    if (confirmCallback) confirmCallback();
    closeConfirm();
  });

  document.addEventListener('mousedown', (e) => {
    const dialog = document.getElementById('confirm-dialog');
    if (!dialog?.classList.contains('active')) return;
    const box = dialog.querySelector('.confirm-box');
    if (box && !box.contains(e.target)) closeConfirm();
  });
}

// ==================== 4. 窗口控制 (原 window-controls.js) ====================
export function initWindowControls() {
  const tauri = window.__TAURI__;
  if (!tauri) return;

  const appWindow = tauri.window.getCurrentWindow();
  const minimizeBtn = document.getElementById('titlebar-minimize');
  const maximizeBtn = document.getElementById('titlebar-maximize');
  const closeBtn = document.getElementById('titlebar-close');
  const titlebar = document.querySelector('.titlebar');

  minimizeBtn?.addEventListener('click', () => appWindow.minimize());
  maximizeBtn?.addEventListener('click', () => appWindow.toggleMaximize());
  closeBtn?.addEventListener('click', () => appWindow.close());

  // 监听窗口状态动态切换最大化/还原图标
  const updateMaximizeIcon = async () => {
    if (!maximizeBtn) return;
    const isMaximized = await appWindow.isMaximized();
    const iconMax = maximizeBtn.querySelector('.icon-maximize');
    const iconRestore = maximizeBtn.querySelector('.icon-restore');

    if (iconMax && iconRestore) {
      iconMax.style.display = isMaximized ? 'none' : 'block';
      iconRestore.style.display = isMaximized ? 'block' : 'none';
    }
    maximizeBtn.title = isMaximized ? t('restore_title') : t('maximize_title');
  };

  updateMaximizeIcon();
  appWindow.onResized(() => {
    updateMaximizeIcon();
  });

  // 💡 核心修复：精准分离原生拉伸、JS拖拽与JS双击
  let lastClickTime = 0;

  // 彻底抛弃 dblclick 事件，全权使用 mousedown 统一管理生命周期
  titlebar?.addEventListener('mousedown', async (e) => {
    // 💡 致命修复 1：将拦截区域严格锁定为 Windows 标准原生边缘的 5px！
    // 0~5px 区域：光标必定是上下箭头 ↕。JS 绝对放行，0 干扰！
    // 让操作系统 100% 完美接管双击高度最大化和拖拽边缘拉伸。
    if (e.clientY <= 5) return;

    // 💡 致命修复 2：只要大于 5px，光标必定是“小手”，开始处理 JS 逻辑，消灭所有死区！
    if (e.buttons === 1 &&
      !e.target.closest('.titlebar-button') &&
      !e.target.closest('.titlebar-toolbar') &&
      !e.target.closest('aside')) {

      const now = Date.now();
      // 时间差判定双击（400ms内）
      if (now - lastClickTime < 400) {
        lastClickTime = 0; // 重置时间，防止疯狂连击
        await appWindow.toggleMaximize(); // 执行窗口全局最大化
        return;
      }
      lastClickTime = now;

      // 只要是小手状态点击，100% 触发窗口拖拽！
      appWindow.startDragging();
    }
  });
}

// ==================== 侧边栏逻辑 ====================

let currentActiveId = null;
let isManualScrolling = false;
let manualScrollTimer = null;

function getSidebarFirstBlockText(storyJson) {
  try {
    const blocks = JSON.parse(storyJson);
    const textBlock = blocks.find(b => b.type === 'text' && b.content?.trim());
    if (!textBlock) return null;

    // 1. 获取原始内容
    let cleanContent = textBlock.content;

    // 2. 核心清洗逻辑：彻底剔除代码与干扰符号
    cleanContent = cleanContent
      .replace(/```[\s\S]*?```/g, '') // 彻底剔除多行代码块
      .replace(/`[^`]+`/g, '')        // 剔除行内代码
      .replace(/<[^>]+>/g, '')        // 剔除 HTML 标签
      .replace(/^[#\*\->\s]+/gm, '')  // 剔除 Markdown 的标题、列表等语法前缀符号
      .trim();

    // 如果清洗完发现这块全是代码没别的字了，给个兜底
    if (!cleanContent) return "代码片段";

    // 3. 提取第一句话作为标题
    const match = cleanContent.match(/^(.+?)[。！？\n]/);
    return match ? match[1].slice(0, 30) : cleanContent.slice(0, 30);
  } catch { return null; }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function initSidebarProximity() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  const MAX_DIST = 150, MIN_W = 3, MAX_W = 20;

  document.addEventListener('mousemove', e => {
    if (!sidebar.classList.contains('collapsed')) return;
    const dist = e.clientX;
    if (dist < MAX_DIST) {
      const progress = Math.max(0, Math.min(1, dist / MAX_DIST));
      const w = MIN_W + (MAX_W - MIN_W) * Math.pow(1 - progress, 1.5);
      sidebar.style.setProperty('--collapsed-w', `${w}px`);
      sidebar.style.transition = 'none';
    } else if (sidebar.style.getPropertyValue('--collapsed-w')) {
      sidebar.style.removeProperty('--collapsed-w');
      sidebar.style.removeProperty('transition');
    }
  });
}

export function initSidebarToggle() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  sidebar.addEventListener('mouseenter', () => {
    sidebar.style.removeProperty('--collapsed-w');
    sidebar.style.removeProperty('transition');
    sidebar.classList.remove('collapsed');
    document.body.classList.add('sidebar-expanded');
  });
  sidebar.addEventListener('mouseleave', () => {
    sidebar.classList.add('collapsed');
    document.body.classList.remove('sidebar-expanded');
  });
}

function updateIndicator(item) {
  const list = document.getElementById('nav-list');
  if (!list) return;
  let indicator = list.querySelector('.nav-active-indicator');
  if (!indicator) {
    indicator = Object.assign(document.createElement('div'), { className: 'nav-active-indicator' });
    list.appendChild(indicator);
  }
  indicator.style.top = `${item.offsetTop}px`;
  indicator.style.height = `${item.offsetHeight}px`;
}

export function highlightSidebarItem(id) {
  const targetId = String(id);
  currentActiveId = targetId;
  const list = document.getElementById('nav-list');
  if (!list) return;
  let activeItem = null;
  list.querySelectorAll('.nav-item').forEach(item => {
    const isActive = item.dataset.postId == targetId;
    item.classList.toggle('active', isActive);
    if (isActive) activeItem = item;
  });
  activeItem && updateIndicator(activeItem);
}

export function renderSidebar(posts) {
  const list = document.getElementById('nav-list');
  if (!list) return;
  list.innerHTML = '';
  const indicator = Object.assign(document.createElement('div'), { className: 'nav-active-indicator' });
  list.appendChild(indicator);

  posts.forEach(p => {
    const div = Object.assign(document.createElement('div'), { className: 'nav-item' });
    div.dataset.postId = p.id;
    const date = new Date(p.created_at);
    const dateStr = date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) +
      ' ' + date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    // 💡 核心逻辑：只认官方标题，不再解析文本内容！
    const titleText = p.title ? p.title.trim() : "";

    div.innerHTML = titleText
      ? `<span class="nav-title">${escapeHtml(titleText)}</span><span class="nav-date">${dateStr}</span>`
      : `<span class="nav-title">${dateStr}</span>`;
    div.onclick = () => {
      const target = document.querySelector(`[data-id="${p.id}"]`);
      if (!target) return;
      isManualScrolling = true;
      clearTimeout(manualScrollTimer);
      highlightSidebarItem(p.id);
      target.scrollIntoView({ behavior: 'auto', block: 'start' });
      manualScrollTimer = setTimeout(() => {
        if (isManualScrolling) {
          target.scrollIntoView({ behavior: 'auto', block: 'start' });
          isManualScrolling = false;
        }
      }, 150);
    };
    list.appendChild(div);
  });
  currentActiveId && setTimeout(() => highlightSidebarItem(currentActiveId), 0);
}

export function renderTagCloud(posts) {
  const container = document.getElementById('tag-cloud-container');
  if (!container) return;
  container.innerHTML = '';
  const counts = {};
  posts.forEach(p => {
    if (!p.tags) return;
    (typeof p.tags === 'string' ? p.tags.split(',') : p.tags).forEach(tag => {
      tag = tag.trim();
      if (tag) counts[tag] = (counts[tag] || 0) + 1;
    });
  });
  Object.keys(counts).sort((a, b) => counts[b] - counts[a]).forEach(tag => {
    const chip = Object.assign(document.createElement('span'), { className: 'tag-chip' });
    chip.textContent = counts[tag] > 1 ? `${tag} (${counts[tag]})` : tag;
    chip.onclick = () => {
      const input = document.getElementById('search-input');
      if (input) {
        input.value = '#' + tag;
        input.dispatchEvent(new Event('input'));
      }
    };
    container.appendChild(chip);
  });
}

export function initScrollSpy() {
  const scrollContainer = document.querySelector('.main-scroll');
  const container = document.getElementById('feed-container');
  if (!scrollContainer || !container) return;

  let ticking = false;
  let hoveredPost = null; // 💡 追踪当前鼠标悬停的帖子

  // 💡 全局代理：监听鼠标移入
  container.addEventListener('mouseover', (e) => {
    const post = e.target.closest('.post');
    if (post && post !== hoveredPost) {
      hoveredPost = post;
      // 鼠标悬停立刻激活该帖子
      if (typeof window.setActivePost === 'function') window.setActivePost(post);
      // 同步高亮侧边栏
      if (post.dataset.id) highlightSidebarItem(post.dataset.id);
    }
  });

  // 💡 全局代理：监听鼠标移出
  container.addEventListener('mouseout', (e) => {
    const post = e.target.closest('.post');
    // 确保鼠标是真的移出了帖子边界，而不是在子元素之间穿梭
    if (post && !post.contains(e.relatedTarget)) {
      hoveredPost = null;
      // 鼠标移出后，立刻交还给视口雷达重新计算
      updateActivePost();
    }
  });

  const updateActivePost = () => {
    if (isManualScrolling) { ticking = false; return; }

    // 💡 优先级绝对拦截：如果当前有悬停的帖子，视口雷达直接休眠，绝不抢焦点！
    if (hoveredPost) { ticking = false; return; }

    const posts = container.querySelectorAll('.post');
    if (!posts.length) { ticking = false; return; }

    const viewTop = scrollContainer.getBoundingClientRect().top;
    const viewBottom = viewTop + scrollContainer.clientHeight;

    let maxVisibleHeight = 0;
    let activePost = null;

    for (const post of posts) {
      const rect = post.getBoundingClientRect();
      if (rect.bottom < viewTop || rect.top > viewBottom) continue;

      const visibleTop = Math.max(rect.top, viewTop);
      const visibleBottom = Math.min(rect.bottom, viewBottom);
      const visibleHeight = visibleBottom - visibleTop;

      if (visibleHeight > maxVisibleHeight) {
        maxVisibleHeight = visibleHeight;
        activePost = post;
      }
    }

    if (activePost) {
      activePost.dataset.id && highlightSidebarItem(activePost.dataset.id);
      if (typeof window.setActivePost === 'function') {
        window.setActivePost(activePost);
      }
    }
    ticking = false;
  };

  scrollContainer.addEventListener('scroll', () => {
    if (!ticking) { requestAnimationFrame(updateActivePost); ticking = true; }
  }, { passive: true });

  const resetManual = () => {
    if (isManualScrolling) {
      isManualScrolling = false;
      clearTimeout(manualScrollTimer);
      manualScrollTimer = null;
      updateActivePost();
    }
  };
  scrollContainer.addEventListener('wheel', resetManual, { passive: true });
  scrollContainer.addEventListener('touchmove', resetManual, { passive: true });
  setTimeout(updateActivePost, 100);
}

// ==================== 右键上下文菜单逻辑 ====================
export function initContextMenu(handlers) {
  const menu = document.getElementById('context-menu');
  const linkPopover = document.getElementById('link-input-popover');
  const linkInput = document.getElementById('link-input');
  const linkOk = document.getElementById('link-input-ok');
  if (!menu) return;

  let currentPost = null;
  let insertPosition = null;
  let clickX = 0, clickY = 0;

  // 监听右键呼出菜单
  document.addEventListener('contextmenu', e => {
    // 确保右键是在帖子区域内触发的，且不在标题栏等受保护区域
    const post = e.target.closest('.post');
    if (!post || e.target.closest('.titlebar, aside, .block-text')) {
      menu.classList.remove('active');
      return;
    }

    e.preventDefault();
    currentPost = post;
    clickX = e.clientX;
    clickY = e.clientY;

    // 计算插入画布的相对坐标
    const flow = post.querySelector('.editor-flow');
    if (flow) {
      const r = flow.getBoundingClientRect();
      insertPosition = { x: Math.max(20, e.clientX - r.left), y: Math.max(20, e.clientY - r.top) };
    }

    // 智能定位：防止菜单超出屏幕右侧或下方
    menu.style.display = 'block'; // 临时显示以获取真实宽高
    const menuWidth = menu.offsetWidth || 160;
    const menuHeight = menu.offsetHeight || 220;

    let left = e.clientX;
    let top = e.clientY;

    if (left + menuWidth > window.innerWidth) left = window.innerWidth - menuWidth - 10;
    if (top + menuHeight > window.innerHeight) top = window.innerHeight - menuHeight - 10;

    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.style.transformOrigin = `${e.clientX - left}px ${e.clientY - top}px`;
    menu.classList.add('active');
  });

  // 监听左键关闭菜单
  document.addEventListener('mousedown', e => {
    if (!menu.contains(e.target) && !linkPopover?.contains(e.target)) {
      menu.classList.remove('active');
      linkPopover?.classList.remove('active');
    }
  });

  // 处理外链输入
  const showLinkPopover = (rect) => {
    if (!linkPopover) return;
    let left = rect.right + 5;
    if (left + 320 > window.innerWidth) left = rect.left - 325; // 屏幕右侧放不下就在左侧弹出
    linkPopover.style.left = `${left}px`;
    linkPopover.style.top = `${rect.top}px`;
    linkPopover.classList.add('active');
    linkInput.value = '';
    linkInput.focus();
    linkPopover._insertPos = insertPosition;
  };

  const submitLink = async () => {
    const val = linkInput?.value.trim();
    if (val && currentPost && handlers.onAddSmartBlock) {
      await handlers.onAddSmartBlock(currentPost.querySelector('.editor-flow'), val, currentPost, linkPopover._insertPos);
    }
    linkPopover?.classList.remove('active');
    menu.classList.remove('active');
  };

  linkOk?.addEventListener('click', submitLink);
  linkInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') submitLink();
    if (e.key === 'Escape') {
      linkPopover.classList.remove('active');
      menu.classList.remove('active');
    }
  });

  // 绑定菜单各项点击事件
  menu.querySelectorAll('.menu-items li').forEach(li => {
    li.addEventListener('click', async (e) => {
      const action = li.dataset.action;
      if (!currentPost) return;
      const flow = currentPost.querySelector('.editor-flow');

      const menuActions = {
        text: () => handlers.onAddBlock?.('text', flow, currentPost, insertPosition),
        upload: () => handlers.onUpload?.(flow, currentPost, insertPosition),
        link: () => showLinkPopover(li.getBoundingClientRect()),
        h5: () => handlers.onAddBlock?.('h5', flow, currentPost, insertPosition),
        'map-folder': () => handlers.onMapFolder?.(currentPost),
        delete: () => {
          menu.classList.remove('active'); // 必须先收起菜单再弹窗
          handlers.onDelete?.(currentPost, { clientX: clickX, clientY: clickY });
        }
      };

      if (action !== 'link' && action !== 'delete') {
        menu.classList.remove('active');
      }
      await menuActions[action]?.();
    });
  });
}



// ==================== 5. 自定义滚动条 (原 scrollbar.js) ====================
export class OverlayScrollbar {
  constructor(target, host = null) {
    this.target = target;
    this.host = host || target.parentElement;
    this.vBar = this.hBar = this.vThumb = this.hThumb = null;
    this.hideTimer = null;
    this.dragging = false;

    this.initDOM();
    this.bindEvents();
    this.update();
    this.target._osInstance = this;
  }

  initDOM() {
    this.host.classList.add('os-host');
    this.vBar = Object.assign(document.createElement('div'), { className: 'os-scrollbar os-scrollbar-vertical' });
    this.vThumb = Object.assign(document.createElement('div'), { className: 'os-thumb' });
    this.vBar.appendChild(this.vThumb);
    this.host.appendChild(this.vBar);

    this.hBar = Object.assign(document.createElement('div'), { className: 'os-scrollbar os-scrollbar-horizontal' });
    this.hThumb = Object.assign(document.createElement('div'), { className: 'os-thumb' });
    this.hBar.appendChild(this.hThumb);
    this.host.appendChild(this.hBar);
  }

  bindEvents() {
    this.target.addEventListener('scroll', () => { this.updateThumbs(); this.show(); }, { passive: true });
    new ResizeObserver(() => this.update()).observe(this.target);
    
    // 监听 DOM 树内容变化（例如异步加载帖子导致高度撑开），并更新滚动条
    new MutationObserver(() => this.update()).observe(this.target, {
      childList: true,
      subtree: true,
      characterData: true
    });

    this.host.addEventListener('mouseenter', () => this.show());
    this.host.addEventListener('mouseleave', () => !this.dragging && this.scheduleHide());
    this.bindDrag(this.vThumb, 'v');
    this.bindDrag(this.hThumb, 'h');
  }

  bindDrag(thumb, axis) {
    let startPos = 0, startScroll = 0;
    const onDown = (e) => {
      e.preventDefault();
      this.dragging = true;
      thumb.classList.add('dragging');
      startPos = axis === 'v' ? e.clientY : e.clientX;
      startScroll = axis === 'v' ? this.target.scrollTop : this.target.scrollLeft;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };
    const onMove = (e) => {
      const delta = (axis === 'v' ? e.clientY : e.clientX) - startPos;
      const trackSize = axis === 'v' ? this.vBar.clientHeight : this.hBar.clientWidth;
      const scrollSize = axis === 'v'
        ? this.target.scrollHeight - this.target.clientHeight
        : this.target.scrollWidth - this.target.clientWidth;
      const ratio = scrollSize / trackSize || 0;
      axis === 'v' ? this.target.scrollTop = startScroll + delta * ratio : this.target.scrollLeft = startScroll + delta * ratio;
    };
    const onUp = () => {
      this.dragging = false;
      thumb.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      this.scheduleHide();
    };
    thumb.addEventListener('mousedown', onDown);
  }

  update() {
    const hasV = this.target.scrollHeight > this.target.clientHeight;
    const hasH = this.target.scrollWidth > this.target.clientWidth;
    this.vBar.style.display = hasV ? 'block' : 'none';
    this.hBar.style.display = hasH ? 'block' : 'none';
    this.updateThumbs();
  }

  updateThumbs() {
    if (this.vBar.style.display !== 'none') {
      const { clientHeight: ch, scrollHeight: sh, scrollTop: st } = this.target;
      const trackH = this.vBar.clientHeight;
      const thumbH = Math.max(20, (ch / sh) * trackH);
      const thumbTop = sh > ch ? (st / (sh - ch)) * (trackH - thumbH) : 0;
      this.vThumb.style.height = `${thumbH}px`;
      this.vThumb.style.top = `${thumbTop}px`;
    }
    if (this.hBar.style.display !== 'none') {
      const { clientWidth: cw, scrollWidth: sw, scrollLeft: sl } = this.target;
      const trackW = this.hBar.clientWidth;
      const thumbW = Math.max(20, (cw / sw) * trackW);
      const thumbLeft = sw > cw ? (sl / (sw - cw)) * (trackW - thumbW) : 0;
      this.hThumb.style.width = `${thumbW}px`;
      this.hThumb.style.left = `${thumbLeft}px`;
    }
  }

  show() {
    clearTimeout(this.hideTimer);
    this.vBar.classList.add('active');
    this.hBar.classList.add('active');
  }

  scheduleHide() {
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      if (!this.dragging) {
        this.vBar.classList.remove('active');
        this.hBar.classList.remove('active');
      }
    }, 1000);
  }
}

export function initScrollbars() {
  const sidebar = document.querySelector('.sidebar-scroll');
  sidebar && new OverlayScrollbar(sidebar, document.getElementById('sidebar'));
  const main = document.querySelector('.main-scroll');
  main && new OverlayScrollbar(main, document.querySelector('main'));
}


// ==================== 5. 极速全局提示框引擎 ====================
export function initGlobalTooltip() {
  const tooltip = document.createElement('div');
  tooltip.className = 'global-tooltip';
  document.body.appendChild(tooltip);

  // 监听全站的鼠标悬停事件
  document.addEventListener('mouseover', (e) => {
    // 自动捕获任何带有 title 或 data-tooltip 的元素
    const target = e.target.closest('[title], [data-tooltip]');
    if (!target) return;

    // 💡 致命拦截：将原生的 title 转移到 data-tooltip，彻底抹杀系统的1秒延迟！
    if (target.hasAttribute('title')) {
      const titleText = target.getAttribute('title');
      if (titleText) {
        target.setAttribute('data-tooltip', titleText);
      }
      target.removeAttribute('title'); // 移除原生属性
    }

    const text = target.getAttribute('data-tooltip');
    if (!text) return;

    tooltip.textContent = text;
    tooltip.classList.add('active');

    // 智能定位算法（优先显示在上方，防超出屏幕边界）
    const rect = target.getBoundingClientRect();
    let top = rect.top - tooltip.offsetHeight - 8;
    let left = rect.left + (rect.width / 2) - (tooltip.offsetWidth / 2);

    // 边界碰撞检测
    if (top < 0) top = rect.bottom + 8; // 上边挡住就掉头去下面
    if (left < 4) left = 4;
    if (left + tooltip.offsetWidth > window.innerWidth) left = window.innerWidth - tooltip.offsetWidth - 4;

    tooltip.style.top = top + 'px';
    tooltip.style.left = left + 'px';
  });

  // 鼠标移出或点击时，瞬间隐藏提示框
  const hideTooltip = () => tooltip.classList.remove('active');
  document.addEventListener('mouseout', (e) => {
    if (e.target.closest('[data-tooltip]')) hideTooltip();
  });
  document.addEventListener('mousedown', hideTooltip);
  window.addEventListener('scroll', hideTooltip, { passive: true });
}
