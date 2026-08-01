const core = window.__TAURI__?.core || {};
const { invoke } = core;
const convertFileSrc = core.convertFileSrc || (p => p);

// Helper: Toggle Bold in Textarea
function toggleBold(ta) {
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;

    // 如果没有选区，尝试选中当前光标所在的单词? 暂时保持原逻辑：无选区不操作
    if (start === end) return;

    const val = ta.value;
    const selected = val.substring(start, end);
    const before = val.substring(0, start);
    const after = val.substring(end);

    if (before.endsWith('**') && after.startsWith('**')) {
        // 取消加粗
        ta.value = before.slice(0, -2) + selected + after.slice(2);
        ta.setSelectionRange(start - 2, end - 2);
    } else {
        // 加粗
        ta.value = before + '**' + selected + '**' + after;
        ta.setSelectionRange(start + 2, end + 2);
    }
    ta.focus();
    // 触发 input 事件以确保 autosize 和 save
    ta.dispatchEvent(new Event('input'));
}

// Helper: Toggle Heading (Inline Style: # text # <-> text)
function toggleHeading(ta) {
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;

    // 如果没有选区，就什么都不做
    if (start === end) return;

    const val = ta.value;
    const selected = val.substring(start, end);
    const before = val.substring(0, start);
    const after = val.substring(end);

    // Toggle H1 (# ... #)
    if (before.endsWith("# ") && after.startsWith(" #")) {
        // Remove
        ta.value = before.slice(0, -2) + selected + after.slice(2);
        ta.setSelectionRange(start - 2, end - 2);
    } else {
        // Add
        ta.value = before + "# " + selected + " #" + after;
        ta.setSelectionRange(start + 2, end + 2);
    }

    ta.focus();
    ta.dispatchEvent(new Event('input'));
}

function parseMarkdown(text) {
    if (!text) return '';
    // 简单的 Markdown 解析器
    const lines = text.split('\n');
    let html = '';
    let inList = false;

    const processInline = (str) => {
        return str
            .replace(/</g, '&lt;').replace(/>/g, '&gt;') // 防XSS
            // Inline Headings (Non-standard)
            .replace(/#\s(.*?)\s#/g, '<span class="inline-h1">$1</span>')
            .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
            .replace(/\*(.*?)\*/g, '<i>$1</i>')
            .replace(/~~(.*?)~~/g, '<s>$1</s>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    };

    lines.forEach((line, i) => {
        const trimmed = line;
        const l = trimmed.replace(/\s+$/, '');

        // 列表检测
        if (l.trim().startsWith('- ')) {
            if (!inList) { html += '<ul>'; inList = true; }
            html += `<li data-src-line="${i}">${processInline(l.trim().slice(2))}</li>`;
            return;
        } else {
            if (inList) { html += '</ul>'; inList = false; }
        }

        // 标题
        if (l.startsWith('# ')) {
            html += `<h1 data-src-line="${i}">${processInline(l.slice(2))}</h1>`;
        } else if (l.startsWith('> ')) {
            html += `<blockquote data-src-line="${i}">${processInline(l.slice(2))}</blockquote>`;
        } else if (l.startsWith('---')) {
            html += `<hr data-src-line="${i}">`;
        } else {
            // 普通段落
            if (l.trim() === '') {
                html += `<div style="min-height:1.6em" data-src-line="${i}"></div>`;
            } else {
                html += `<div data-src-line="${i}">${processInline(l)}</div>`;
            }
        }
    });

    if (inList) html += '</ul>';
    return html;
}

let allPosts = [];
let confirmCallback = null;
let videoObserver = null;

document.addEventListener("DOMContentLoaded", async () => {
    bindGlobalEvents();
    await loadPosts();
});

function bindGlobalEvents() {
    const sidebar = document.getElementById('sidebar');
    // const menuBtn = document.getElementById('menu-btn'); // Removed
    // menuBtn.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
    // menuBtn.addEventListener('mouseenter', () => sidebar.classList.remove('collapsed'));

    // Sidebar interaction: hover 10px edge to expand
    sidebar.addEventListener('mouseenter', () => {
        // 清除动态样式，恢复 CSS transition 以便平滑展开
        sidebar.style.removeProperty('--collapsed-w');
        sidebar.style.removeProperty('transition');
        sidebar.classList.remove('collapsed');
    });
    sidebar.addEventListener('mouseleave', () => sidebar.classList.add('collapsed'));

    document.getElementById('btn-create-new').addEventListener('click', createNewPost);
    // document.getElementById('btn-map-folder').addEventListener('click', mapFolderToPost); // Removed
    document.getElementById('search-input').addEventListener('input', handleSearch);

    // Confirm
    document.getElementById('confirm-cancel').addEventListener('click', closeConfirm);
    document.getElementById('confirm-ok').addEventListener('click', () => {
        if (confirmCallback) confirmCallback();
        closeConfirm();
    });

    // 点击外部关闭 Confirm
    document.addEventListener('mousedown', (e) => {
        const dialog = document.getElementById('confirm-dialog');
        const box = dialog.querySelector('.confirm-box');
        if (dialog.classList.contains('active') && !box.contains(e.target)) {
            closeConfirm();
        }
    });

    // 主题切换逻辑
    initThemeToggle();

    // 浮动菜单逻辑
    initFloatMenu();

    // 画布缩放和拖拽
    initCanvasControls();

    // 框选功能
    initSelectionBox();

    // 视频性能优化
    initVideoOptimization();

    // 浮动加粗按钮
    initFloatingBoldButton();

    // 帖子虚拟化
    initPostVirtualization();

    // 回到顶部功能
    initGoToTop();

    // 侧边栏感应互动
    initSidebarProximity();
}

function initGoToTop() {
    const wrap = document.querySelector('.progress-wrap');
    if (!wrap) return;
    const path = wrap.querySelector('path');
    const pathLength = path.getTotalLength();

    // 1. 初始化 SVG 绘制状态
    path.style.transition = 'none';
    path.style.strokeDasharray = `${pathLength} ${pathLength}`;
    path.style.strokeDashoffset = pathLength;
    path.getBoundingClientRect();
    path.style.transition = 'stroke-dashoffset 10ms linear';

    // 获取滚动容器
    const scrollContainer = document.querySelector('.main-scroll') || document.documentElement;

    // 2. 核心逻辑：滚动处理
    const updateProgress = () => {
        let scrollTop, scrollHeight, clientHeight;

        if (scrollContainer === document.documentElement) {
            scrollTop = window.scrollY;
            scrollHeight = document.documentElement.scrollHeight;
            clientHeight = window.innerHeight;
        } else {
            scrollTop = scrollContainer.scrollTop;
            scrollHeight = scrollContainer.scrollHeight;
            clientHeight = scrollContainer.clientHeight;
        }

        const height = scrollHeight - clientHeight;
        const progress = pathLength - (scrollTop * pathLength / height);

        path.style.strokeDashoffset = progress;
        wrap.classList.toggle('active-progress', scrollTop > 50);
    };

    // 3. 事件监听
    if (scrollContainer === document.documentElement) {
        window.addEventListener('scroll', updateProgress);
    } else {
        scrollContainer.addEventListener('scroll', updateProgress);
    }

    // 4. 点击回顶
    wrap.addEventListener('click', (e) => {
        e.preventDefault();
        scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

function initFloatingBoldButton() {
    const toolbar = document.createElement('div');
    toolbar.className = 'block-float-toolbar';
    document.body.appendChild(toolbar);

    // Bold Button
    const boldBtn = document.createElement('div');
    boldBtn.className = 'block-float-btn';
    boldBtn.textContent = 'B';
    boldBtn.title = '加粗 (Bold)';
    toolbar.appendChild(boldBtn);

    // Heading Button
    const headingBtn = document.createElement('div');
    headingBtn.className = 'block-float-btn';
    headingBtn.textContent = 'H';
    headingBtn.title = '标题 (H1-H3)';
    toolbar.appendChild(headingBtn);

    let activeTa = null;

    // Use mouseup to capture end of selection
    document.addEventListener('mouseup', (e) => {
        if (toolbar.contains(e.target)) return;

        // Wait next tick to clear selection checks
        setTimeout(() => {
            const sel = window.getSelection();
            const ta = document.activeElement;

            // Check if we selected text inside a textarea
            if (ta && (ta.tagName === 'TEXTAREA') && ta.selectionStart !== ta.selectionEnd) {
                if (!ta.closest('.block-text') && !ta.classList.contains('todo-text')) return;

                activeTa = ta;
                toolbar.style.display = 'flex';
                // Show above mouse
                toolbar.style.left = (e.clientX + 5) + 'px';
                toolbar.style.top = (e.clientY - 45) + 'px';
            } else {
                toolbar.style.display = 'none';
            }
        }, 10);
    });

    // Hide on keyup (typing)
    document.addEventListener('keyup', () => {
        toolbar.style.display = 'none';
    });

    // Hide on scroll
    document.addEventListener('scroll', () => {
        // toolbar.style.display = 'none';
    }, true);

    // Prevent focus loss on toolbar click
    toolbar.onmousedown = (e) => {
        e.preventDefault();
    };

    boldBtn.onclick = (e) => {
        e.stopPropagation();
        if (activeTa) {
            toggleBold(activeTa);
        }
    };

    headingBtn.onclick = (e) => {
        e.stopPropagation();
        if (activeTa) {
            toggleHeading(activeTa);
        }
    };
}

function initThemeToggle() {
    const html = document.documentElement;
    const btn = document.getElementById('theme-toggle');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

    const applyTheme = (isDark) => {
        html.classList.toggle('dark', isDark);
        btn.textContent = isDark ? '☀️' : '🌙';
    };

    // 初始化：跟随系统主题
    applyTheme(prefersDark.matches);

    // 监听系统主题变化 - 始终跟随系统
    prefersDark.addEventListener('change', (e) => {
        applyTheme(e.matches);
    });

    // 点击切换（临时切换，不保存偏好，系统变化时仍会同步）
    btn.addEventListener('click', () => {
        const isDark = html.classList.contains('dark');
        const newDark = !isDark;

        const toggle = () => {
            applyTheme(newDark);
        };

        if (document.startViewTransition) {
            document.startViewTransition(toggle);
        } else {
            toggle();
        }
    });
}

function showConfirm(msg, x, y, callback) {
    const dialog = document.getElementById('confirm-dialog');
    document.getElementById('confirm-msg').textContent = msg;
    confirmCallback = callback;

    // 定位（确保在视口内）
    const w = 260; // 大致宽度
    const h = 120; // 大致高度
    let left = x + 10;
    let top = y + 10;

    if (left + w > window.innerWidth) left = x - w - 10;
    if (top + h > window.innerHeight) top = y - h - 10;

    dialog.style.left = left + 'px';
    dialog.style.top = top + 'px';
    dialog.classList.add('active');
}

function closeConfirm() {
    document.getElementById('confirm-dialog').classList.remove('active');
}

function initSidebarProximity() {
    const sidebar = document.getElementById('sidebar');
    // 最大感应距离 (px)
    const MAX_DIST = 150;
    // 最小和最大宽度
    const MIN_W = 5;
    const MAX_W = 20;

    document.addEventListener('mousemove', (e) => {
        // 只有折叠状态下才动态调整
        if (!sidebar.classList.contains('collapsed')) return;

        const x = e.clientX;

        // 如果在感应范围内
        if (x < MAX_DIST) {
            // 计算进度 0.0 ~ 1.0 (0是边缘, 1是远处)
            const progress = Math.max(0, Math.min(1, x / MAX_DIST));
            // 越近越宽: width = MIN + (MAX - MIN) * (1 - progress)
            // 使用 Math.pow 让变化曲线更自然 (非线性)
            const w = MIN_W + (MAX_W - MIN_W) * Math.pow(1 - progress, 1.5);

            sidebar.style.setProperty('--collapsed-w', `${w}px`);

            // 关键：禁用 transition 以便无延迟跟随鼠标
            sidebar.style.transition = 'none';
        } else {
            // 超出范围，如果还残留有样式，则清理
            if (sidebar.style.getPropertyValue('--collapsed-w')) {
                sidebar.style.removeProperty('--collapsed-w');
                sidebar.style.removeProperty('transition');
            }
        }
    });
}

// 浮动菜单状态和配置
let floatMenuState = {
    mouseX: -200, mouseY: -200,
    menuX: -200, menuY: -200,
    isExpanded: false,
    isHovering: false,
    isCoolingDown: false,
    currentPost: null,       // 当前鼠标所在的 post
    insertPosition: null,    // 插入位置（相对于 flow）
    repelX: 0, repelY: 0     // 排斥偏移
};

window.isGlobalDragging = false;

const floatMenuConfig = {
    friction: 0.06,
    offsetX: 30, offsetY: 30,
    closeDelay: 500,
    autoCloseWait: 800,
    cooldownTime: 800
};

let floatCloseTimer = null;
let floatCooldownTimer = null;

function initFloatMenu() {
    const menu = document.getElementById('float-menu');
    const linkPopover = document.getElementById('link-input-popover');
    const linkInput = document.getElementById('link-input');
    const linkOk = document.getElementById('link-input-ok');

    // 鼠标移动 - 更新位置和检测当前 post
    document.addEventListener('mousemove', (e) => {
        // 如果鼠标在菜单上或外链弹窗上，保持当前 post 状态，不进行更新
        if (e.target.closest('#float-menu') || e.target.closest('.link-input-popover')) {
            return;
        }

        // 如果鼠标在 Block 内部，停止跟随，但更新 currentPost 以便右键可用
        if (e.target.closest('.block')) {
            const post = e.target.closest('.post');
            if (post) floatMenuState.currentPost = post;
            return;
        }

        floatMenuState.mouseX = e.clientX;
        floatMenuState.mouseY = e.clientY;

        // 检测鼠标当前所在的 post
        const postElement = e.target.closest('.post');
        if (postElement) {
            floatMenuState.currentPost = postElement;
            // 计算在 editor-flow 内的相对位置
            const flow = postElement.querySelector('.editor-flow');
            if (flow) {
                const flowRect = flow.getBoundingClientRect();
                floatMenuState.insertPosition = {
                    x: e.clientX - flowRect.left,
                    y: e.clientY - flowRect.top
                };
            }
            menu.classList.remove('hidden');
        } else {
            // 只有当真正离开 post 且也不在菜单上时，才清除
            // 但为了防止误操作，这里我们其实可以保留 currentPost，
            // 直到通过点击或其他方式明确切换。
            // 不过为了 UI 逻辑（比如隐藏菜单），还是需要判断。

            // 如果不在任何 post 内，且当前不在菜单交互中
            if (!floatMenuState.isExpanded && !floatMenuState.isHovering) {
                menu.classList.add('hidden');
                // 离开区域才清空，防止意外
                floatMenuState.currentPost = null;
                floatMenuState.insertPosition = null;
            }
        }
    });

    // 菜单跟随动画 (Repel Logic Removed)
    function animateMenu() {
        if (!floatMenuState.isExpanded) {
            let targetX = floatMenuState.mouseX + floatMenuConfig.offsetX;
            let targetY = floatMenuState.mouseY + floatMenuConfig.offsetY;

            if (window.isGlobalDragging) {
                // 拖拽时禁止交互，防止展开
                menu.style.pointerEvents = 'none';
            } else {
                // 非拖拽且非冷却非隐藏时，恢复交互
                if (!menu.classList.contains('cooling-down') && !menu.classList.contains('hidden')) {
                    menu.style.pointerEvents = '';
                }
            }

            floatMenuState.menuX += (targetX - floatMenuState.menuX) * floatMenuConfig.friction;
            floatMenuState.menuY += (targetY - floatMenuState.menuY) * floatMenuConfig.friction;

            menu.style.transform = `translate3d(${floatMenuState.menuX}px, ${floatMenuState.menuY}px, 0)`;
        }
        requestAnimationFrame(animateMenu);
    }
    animateMenu();

    function startCollapseTimer(delay) {
        clearTimeout(floatCloseTimer);
        floatCloseTimer = setTimeout(() => {
            if (!floatMenuState.isHovering) collapseFloatMenu();
        }, delay);
    }

    function expandFloatMenu() {
        floatMenuState.isExpanded = true;
        menu.classList.add('expanded');
    }

    function collapseFloatMenu() {
        if (!floatMenuState.isExpanded) return;
        floatMenuState.isExpanded = false;
        menu.classList.remove('expanded');
        floatMenuState.isCoolingDown = true;
        menu.classList.add('cooling-down');
        clearTimeout(floatCooldownTimer);
        floatCooldownTimer = setTimeout(() => {
            floatMenuState.isCoolingDown = false;
            menu.classList.remove('cooling-down');
        }, floatMenuConfig.cooldownTime);
    }

    // 菜单悬停事件
    menu.addEventListener('mouseenter', () => {
        if (floatMenuState.isCoolingDown) return;
        clearTimeout(floatCloseTimer);
        floatMenuState.isHovering = true;
        expandFloatMenu();
    });

    menu.addEventListener('mouseleave', () => {
        floatMenuState.isHovering = false;
        if (!floatMenuState.isCoolingDown) startCollapseTimer(floatMenuConfig.closeDelay);
    });

    // 右键点击展开菜单
    document.addEventListener('contextmenu', (e) => {
        // 只在 post 区域内响应右键
        if (!floatMenuState.currentPost) return;

        e.preventDefault();
        if (floatMenuState.isCoolingDown) {
            floatMenuState.isCoolingDown = false;
            menu.classList.remove('cooling-down');
            clearTimeout(floatCooldownTimer);
        }
        expandFloatMenu();
        const rect = menu.getBoundingClientRect();
        const isInside = e.clientX >= rect.left && e.clientX <= rect.right &&
            e.clientY >= rect.top && e.clientY <= rect.bottom;
        if (!isInside) {
            floatMenuState.isHovering = false;
            startCollapseTimer(floatMenuConfig.autoCloseWait);
        } else {
            floatMenuState.isHovering = true;
        }
    });

    // 点击其他位置收起菜单
    document.addEventListener('mousedown', (e) => {
        if (floatMenuState.isExpanded && !menu.contains(e.target) && !linkPopover.contains(e.target)) {
            collapseFloatMenu();
            linkPopover.classList.remove('active');
        }
    });

    // 菜单项点击事件
    menu.querySelectorAll('.menu-items li').forEach(li => {
        li.addEventListener('click', async () => {
            const action = li.dataset.action;
            const post = floatMenuState.currentPost;
            if (!post) return;

            const flow = post.querySelector('.editor-flow');
            const insertPos = floatMenuState.insertPosition;

            if (action === 'text') {
                addBlock(flow, 'text', '', post, insertPos);
            } else if (action === 'upload') {
                await handleUpload(flow, post, insertPos);
            } else if (action === 'link') {
                // 显示外链输入弹窗
                showLinkPopover(insertPos);
            } else if (action === 'h5') {
                addBlock(flow, 'h5', { h: '', c: '', j: '' }, post, insertPos);
            } else if (action === 'todo') {
                addBlock(flow, 'todo', [{ text: '', status: 'empty', important: false }], post, insertPos);
            } else if (action === 'map-folder') {
                mapFolderToPost(post);
            } else if (action === 'delete') {
                confirmDeletePost(floatMenuState.currentPost, { clientX: floatMenuState.menuX, clientY: floatMenuState.menuY });
            }

            collapseFloatMenu();
        });
    });

    // 外链弹窗逻辑
    function showLinkPopover(insertPos) {
        // 定位在鼠标位置
        linkPopover.style.left = (floatMenuState.mouseX + 20) + 'px';
        linkPopover.style.top = (floatMenuState.mouseY + 20) + 'px';
        linkPopover.classList.add('active');
        linkInput.value = '';
        linkInput.focus();
        linkPopover._insertPos = insertPos;
    }

    async function submitLink() {
        const val = linkInput.value.trim();
        if (val && floatMenuState.currentPost) {
            const flow = floatMenuState.currentPost.querySelector('.editor-flow');
            await addSmartBlock(flow, val, floatMenuState.currentPost, linkPopover._insertPos);
        }
        linkPopover.classList.remove('active');
    }

    linkOk.addEventListener('click', submitLink);
    linkInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitLink();
        if (e.key === 'Escape') linkPopover.classList.remove('active');
    });
}

// 通用块添加函数（合并了 addBlockAtPosition/appendBlock/addBlock）
function addBlock(container, type, content, card, insertPos = null) {
    const blockData = { type, isNew: true };

    // 处理不同类型的 content
    if ((type === 'img' || type === 'video') && content && content.src) {
        blockData.src = content.src;
    } else {
        blockData.content = content;
    }

    // H5 默认内容结构
    if (type === 'h5' && !blockData.content) {
        blockData.content = { h: '', c: '', j: '' };
    }

    // 计算位置
    calcBlockPosition(container, blockData, insertPos);

    // 默认尺寸
    calcDefaultSize(blockData);

    renderBlock(container, blockData, card);
    updateContainerHeight(container);
    if (card) scheduleSave(card);

    // 滚动到新块
    scrollToNewBlock(container);
}

// 计算块位置（网格吸附）
function calcBlockPosition(container, blockData, insertPos) {
    const GRID_SIZE = 20;
    if (insertPos) {
        blockData.x = Math.max(20, Math.round(insertPos.x / GRID_SIZE) * GRID_SIZE);
        blockData.y = Math.max(20, Math.round(insertPos.y / GRID_SIZE) * GRID_SIZE);
    } else {
        // 追加到底部
        let maxY = 0;
        Array.from(container.children).forEach(b => {
            const y = parseInt(b.style.top || 0);
            const h = parseInt(b.style.height || 200);
            if (y + h > maxY) maxY = y + h;
        });
        blockData.x = 20;
        blockData.y = maxY > 0 ? maxY + 20 : 60;
    }
}

// 计算默认尺寸，文本块 和 H5块，默认大小 300x200px
function calcDefaultSize(blockData) {
    if (!blockData.w) {
        blockData.w = (blockData.type === 'h5' || blockData.type === 'text') ? 300 :
            (blockData.type === 'todo') ? 300 : 200;
    }
    if (!blockData.h) {
        blockData.h = (blockData.type === 'todo') ? 50 : 200;
    }
}

// 滚动到新添加的块
function scrollToNewBlock(container) {
    const newBlock = container.lastElementChild;
    if (newBlock) {
        setTimeout(() => newBlock.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    }
}

// 统一的上传处理函数
async function handleUpload(flow, card, insertPos = null) {
    try {
        const paths = await invoke("upload_media");
        if (paths && paths.length) {
            if (paths.length === 1) {
                await addSmartBlock(flow, paths[0], card, insertPos);
            } else {
                // 上传多图/多视频，使用 700px 宽度
                await addFolderBlock(flow, paths, card, insertPos, 700);
            }
        }
    } catch (e) { console.error(e); }
}

// 提取的文件夹创建逻辑
async function addFolderBlock(container, files, card, insertPos, targetWidth = null) {
    // 0. 准备：计算 Folder 尺寸和网格
    //let FOLDER_W_OUTER = targetWidth || (window.innerWidth - 100); //填满
    let FOLDER_W_OUTER = targetWidth || ((window.innerWidth - 100) * 0.5); //一半
    // 初始高度
    let FOLDER_H_OUTER = 200;

    // 1. 先创建并显示空的 Folder Block
    const folderBlockData = {
        type: 'folder',
        w: FOLDER_W_OUTER,
        h: FOLDER_H_OUTER,
        children: []
    };

    // 使用公共的位置计算函数
    calcBlockPosition(container, folderBlockData, insertPos);

    // 渲染 Empty Folder
    const folderEl = renderBlock(container, folderBlockData, card);
    updateContainerHeight(container);
    scrollToNewBlock(container);

    // 获取 Inner Container 用于插入子元素
    const folderInner = folderEl.querySelector('.folder-inner-container');

    const items = [];

    // 2. 循环处理文件并实时添加到 Folder
    for (const filePath of files) {
        const ext = filePath.split('.').pop().toLowerCase();
        let item = null;
        let src = convertLocalPath(filePath);

        if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) {
            try {
                const size = await measureMedia(src, 'img');
                item = { type: 'img', src: filePath, w: size.w, h: size.h, aspect: size.w / size.h };
            } catch {
                item = { type: 'img', src: filePath, w: 200, h: 200, aspect: 1 };
            }
        } else if (['mp4', 'webm', 'mov', 'avi'].includes(ext)) {
            try {
                const size = await measureMedia(src, 'video');
                item = { type: 'video', src: filePath, w: size.w, h: size.h, aspect: size.w / size.h };
            } catch {
                item = { type: 'video', src: filePath, w: 200, h: 150, aspect: 1.33 };
            }
        } else if (['mp3', 'wav', 'ogg', 'flac'].includes(ext)) {
            item = { type: 'video', src: filePath, w: 300, h: 80, aspect: 300 / 80 };
        } else if (['txt', 'md', 'json'].includes(ext)) {
            try {
                const content = await invoke('read_text_file', { path: filePath });
                const h = content.length > 500 ? 300 : 200;
                item = { type: 'text', content: content, w: 300, h: h, aspect: 300 / h, src: filePath };
            } catch (err) {
                const fileName = filePath.split(/[/\\]/).pop();
                item = { type: 'text', content: `📄 ${fileName}\n(无法读取内容)`, w: 200, h: 100, aspect: 2 };
            }
        }

        if (item) {
            // 渲染 Item 到 Folder Inner
            renderBlock(folderInner, item, card);
            items.push(item);

            // 实时重排并更新高度 (传入 null height 强制自适应)
            // 使用当前宽度，防止用户已经调整了宽度
            const currentW = parseInt(folderEl.style.width) || FOLDER_W_OUTER;
            const newH = reflowFolderContent(folderEl, currentW, null);
            if (newH) {
                folderEl.style.height = newH + 'px';
                updateContainerHeight(container);
            }
        }

        // 让JS事件循环和后端有机会处理资源回收，同时提供视觉反馈
        await new Promise(r => setTimeout(r, 10));
    }

    // 最终保存
    if (card) scheduleSave(card);
}

// 独立的布局计算函数 (纯数据)
// targetItemWidth: 期望的每个元素的宽度 (density control)
function calculateFolderLayout(items, containerWidth, containerHeight, targetItemWidth = 300) {
    const PADDING = 20;
    const GAP = 20;
    const N = items.length;

    // 1. 准备数据，确保有 aspect
    const pool = items.map(item => ({
        ...item,
        aspect: item.aspect || (item.w / item.h) || 1
    }));

    // 有效内容宽度
    const contentAvailableWidth = containerWidth - 2 * PADDING;
    if (contentAvailableWidth <= 0) {
        return { height: containerHeight, totalNaturalHeight: 2 * PADDING, children: [] };
    }

    const totalAspect = pool.reduce((sum, item) => sum + item.aspect, 0);

    // 2. 估算行数 (基于 Column Density)
    // 规则: containerWidth / targetItemWidth = cols
    // rows = ceil(N / cols)
    let cols = Math.round(contentAvailableWidth / targetItemWidth);
    if (cols < 1) cols = 1;

    let k = Math.ceil(N / cols);
    if (k < 1) k = 1;
    if (k > N) k = N;

    // 原来的 Greedy Partition 逻辑
    const idealRowAspect = totalAspect / k;
    const rows = [];
    let currentItems = [...pool];

    // 3. 分行 (Greedy Partition)
    for (let r = 0; r < k; r++) {
        let currentRow = [];
        let currentAspectSum = 0;

        while (currentItems.length > 0) {
            // 最后一行全收
            if (r === k - 1) {
                currentRow.push(currentItems.shift());
                continue;
            }

            const item = currentItems[0];
            const diffBefore = Math.abs(currentAspectSum - idealRowAspect);
            const diffAfter = Math.abs((currentAspectSum + item.aspect) - idealRowAspect);

            if (currentRow.length === 0 || diffAfter <= diffBefore) {
                currentRow.push(currentItems.shift());
                currentAspectSum += item.aspect;
            } else {
                break;
            }
        }
        if (currentRow.length > 0) rows.push({ items: currentRow });
    }

    // 4. 计算坐标
    let layoutItems = [];
    let currentY = PADDING; // Y轴起始位置

    rows.forEach(row => {
        const n = row.items.length;
        // 当前行总 Gap 宽度
        const totalGapWidth = (n - 1) * GAP;
        // 图片实际可用总宽度
        const widthForImages = contentAvailableWidth - totalGapWidth;

        const rowAspectSum = row.items.reduce((s, i) => s + i.aspect, 0);
        // 自然行高
        row.height = widthForImages / rowAspectSum;

        let currentX = PADDING; // X轴起始位置

        row.items.forEach(item => {
            // 计算自然宽度
            const itemW = row.height * item.aspect;

            layoutItems.push({
                ...item,
                x: currentX,
                y: currentY,
                w: itemW,
                h: row.height
            });

            currentX += itemW + GAP;
        });

        currentY += row.height + GAP;
    });

    // 计算总自然高度
    const totalH = rows.length > 0 ? (currentY - GAP + PADDING) : (2 * PADDING);

    return {
        height: containerHeight,
        totalNaturalHeight: totalH,
        children: layoutItems
    };
}

// DOM 重排函数
function reflowFolderContent(folderBlock, width, height) {
    const PADDING = 20;
    const inner = folderBlock.querySelector('.folder-inner-container');
    if (!inner) return;

    // 收集所有子块并提取信息
    const childrenEls = Array.from(inner.children).filter(el => el.classList.contains('block'));
    const items = childrenEls.map(el => {
        let w = el.offsetWidth;
        let h = el.offsetHeight;

        // 尝试获取保存的 aspect
        let aspect = parseFloat(el.dataset.aspect);

        // 如果没有 aspect，尝试计算
        if (!aspect || isNaN(aspect)) {
            // 优先使用 style.width/height (如果存在且非0)
            const styleW = parseFloat(el.style.width);
            const styleH = parseFloat(el.style.height);
            if (styleW && styleH) {
                aspect = styleW / styleH;
            } else if (w && h) {
                // 最后使用 offsetWidth
                aspect = w / h;
            } else {
                // 实在没有，默认 1 (防止 NaN)
                aspect = 1;
            }
            // 保存 aspect 以便后续重排保持比例
            el.dataset.aspect = aspect;
        }

        return {
            element: el,
            aspect: aspect,
            w: 100, // 仅 aspect 用于计算
            h: 100
        };
    });

    if (items.length === 0) return;

    // Detect auto height mode
    const isAutoHeight = !height;
    // Use fallback height for layout calculation only
    const layoutHeight = height || (width * 0.75);

    // 读取布局密度参数
    const targetItemWidth = parseInt(folderBlock.dataset.layoutSize) || 300;

    // 1. 计算布局
    const result = calculateFolderLayout(items, width, layoutHeight, targetItemWidth);

    // 2. 计算缩放因子 (为了填满高度)
    let scaleFactor = 1;
    // Only apply scaling if height was explicitly provided (not auto mode)
    if (!isAutoHeight) {
        const contentNaturalH = result.totalNaturalHeight - 2 * PADDING;
        const contentTargetH = height - 2 * PADDING;
        // 避免除以0
        if (contentNaturalH > 1) {
            scaleFactor = contentTargetH / contentNaturalH;
        }
    }

    // 3. 应用样式
    result.children.forEach(childLayout => {
        if (childLayout.element) {
            // 计算最终几何
            // 保持 Y 的 Padding 部分不缩放，只缩放内容部分的偏移
            const contentDiffY = childLayout.y - PADDING;
            const finalY = PADDING + contentDiffY * scaleFactor;

            // 高度也受到缩放影响
            const finalH = childLayout.h * scaleFactor;
            const finalW = childLayout.w; // 宽度由 calculateFolderLayout 计算决定 (已填满行)
            const finalX = childLayout.x;

            // 使用 transform 定位以配合 CSS transition
            childLayout.element.style.transform = `translate(${finalX}px, ${finalY}px)`;
            childLayout.element.style.width = finalW + 'px';
            childLayout.element.style.height = finalH + 'px';

            // 归零 left/top，完全依赖 transform
            childLayout.element.style.left = '0px';
            childLayout.element.style.top = '0px';
        }
    });

    // 4. Snap Logic
    // 返回自然高度，使 Folder 高度吸附内容
    return result.totalNaturalHeight;
}



// 智能添加块（根据 URL 自动识别类型）
async function addSmartBlock(container, url, card, insertPos = null) {
    const trimmed = url.trim();
    const lower = trimmed.toLowerCase();

    // 识别类型
    let type, content;
    if (trimmed.startsWith('<iframe')) {
        type = 'embed';
        content = { html: trimmed };
    } else if (/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(lower)) {
        type = 'img';
    } else if (/\.(mp4|webm|mov|mkv)$/i.test(lower)) {
        type = 'video';
    } else if (/\.(mp3|wav|ogg|flac)$/i.test(lower)) {
        // Audio treat as video player
        type = 'video';
    } else if (/\.(txt|md|json)$/i.test(lower)) {
        try {
            const text = await invoke('read_text_file', { path: url });
            type = 'text';
            content = text;
        } catch (e) {
            console.error("Read text failed", e);
            type = 'text';
            content = url + '\n(Read Failed)';
        }
    } else {
        type = 'embed';
        content = { html: `<iframe src="${url}" style="width:100%;height:100%;border:none"></iframe>` };
    }

    // 计算尺寸
    let w = 200, h = 200;
    if (type === 'img' || type === 'video') {
        if (/\.(mp3|wav|ogg|flac)$/i.test(lower)) {
            w = 300; h = 80;
        } else {
            try {
                const dims = await measureMedia(convertLocalPath(url), type);
                [w, h] = dims.w < dims.h ? [200, (dims.h / dims.w) * 200] : [(dims.w / dims.h) * 200, 200];
            } catch (e) { console.warn("Measure failed", e); }
        }
    } else if (type === 'text') {
        w = 300; h = 300;
    } else {
        w = 400; h = 300;
    }

    const blockData = { type, w: Math.round(w), h: Math.round(h) };
    calcBlockPosition(container, blockData, insertPos);

    if (type === 'embed') {
        blockData.content = content;
    } else if (type === 'text') {
        blockData.content = content;
        // 如果是上传的文件，记录 src 以便后续删除
        if (url && !content.includes(url)) { // 简单判断非直接内容
            blockData.src = url;
        }
    } else {
        blockData.src = url;
    }

    renderBlock(container, blockData, card);
    updateContainerHeight(container);
    if (card) scheduleSave(card);
    scrollToNewBlock(container);
}



function measureMedia(src, type) {
    return new Promise((resolve, reject) => {
        if (type === 'img') {
            const img = new Image();
            img.onload = () => resolve({ w: img.width, h: img.height });
            img.onerror = reject;
            img.src = src;
        } else {
            const vid = document.createElement('video');
            vid.onloadedmetadata = () => {
                const w = vid.videoWidth;
                const h = vid.videoHeight;
                // 立即释放资源，防止大量文件句柄耗尽导致 crush
                vid.removeAttribute('src');
                vid.load();
                resolve({ w, h });
            };
            vid.onerror = (e) => {
                vid.removeAttribute('src');
                vid.load();
                reject(e);
            };
            vid.src = src;
        }
    });
}

async function loadPosts() {
    try {
        const posts = await invoke("get_posts");
        // 按创建时间倒序排列
        allPosts = (posts || []).sort((a, b) => b.created_at - a.created_at);
        renderFeed(allPosts);
        renderSidebar(allPosts);
        renderTagCloud(allPosts);
    } catch (e) { console.error("Load failed", e); }
}

function renderSidebar(posts) {
    const list = document.getElementById('nav-list');
    list.innerHTML = '';
    posts.forEach(p => {
        const div = document.createElement('div');
        div.className = 'nav-item';

        // 格式化日期时间
        const date = new Date(p.created_at);
        const dateStr = date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) +
            ' ' + date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

        // 获取首句文字
        const firstText = getFirstBlockText(p.story);

        if (firstText) {
            // 有文字：显示首句 + 小号日期
            div.innerHTML = `
        <span class="nav-title">${escapeHtml(firstText)}</span>
        <span class="nav-date">${dateStr}</span>
      `;
        } else {
            // 无文字：直接用日期时间做标题
            div.innerHTML = `<span class="nav-title">${dateStr}</span>`;
        }

        div.onclick = () => {
            document.querySelector(`[data-id="${p.id}"]`)?.scrollIntoView({ behavior: 'smooth' });
        };
        list.appendChild(div);
    });
}

function renderTagCloud(posts) {
    const counts = {};
    posts.forEach(p => {
        if (!p.tags) return;
        p.tags.split(',').forEach(tag => {
            tag = tag.trim();
            if (tag) counts[tag] = (counts[tag] || 0) + 1;
        });
    });

    const container = document.getElementById('tag-cloud-container');
    container.innerHTML = '';

    const sorted = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    sorted.forEach(tag => {
        const el = document.createElement('span');
        el.className = 'tag-chip';
        el.textContent = `${tag}`; // 简单显示
        if (counts[tag] > 1) el.textContent += ` (${counts[tag]})`;

        el.onclick = () => {
            const input = document.getElementById('search-input');
            input.value = "#" + tag; // 使用 #tag 进行精确搜索
            input.dispatchEvent(new Event('input')); // 触发搜索
        };
        container.appendChild(el);
    });
}

function getFirstBlockText(storyJson) {
    try {
        const blocks = JSON.parse(storyJson);
        const textBlock = blocks.find(b => b.type === 'text' && b.content && b.content.trim());
        if (!textBlock) return null;

        // 提取第一句话（以句号、问号、感叹号、换行结尾）
        const content = textBlock.content.trim();
        const match = content.match(/^(.+?)[。！？\n]/);
        if (match) {
            return match[1].slice(0, 30); // 最多30字
        }
        return content.slice(0, 30); // 无标点则取前30字
    } catch (e) { return null; }
}

function renderFeed(posts) {
    const container = document.getElementById('feed-container');
    container.innerHTML = '';
    posts.forEach(post => {
        container.appendChild(createPostElement(post));
    });
}

// 创建并插入新帖子（公共逻辑）
function createAndInsertPost() {
    const newPost = {
        id: Date.now(),
        created_at: Date.now(),
        story: '[]',
        isNew: true
    };
    allPosts.unshift(newPost);
    renderSidebar(allPosts);

    const el = createPostElement(newPost);
    // 强制加载内容，确保 editor-flow 存在
    mountPostContent(el);

    el.classList.add('animate-slide-up');
    document.getElementById('feed-container').prepend(el);
    el.scrollIntoView({ behavior: 'smooth' });

    return { el, flow: el.querySelector('.editor-flow') };
}

function createNewPost() {
    const { el, flow } = createAndInsertPost();
    addBlock(flow, 'text', '', el);
}

async function mapFolderToPost(targetPost = null) {
    try {
        const files = await invoke('pick_folder');
        if (!files || files.length === 0) return;

        let card, flow;
        if (targetPost) {
            card = targetPost;
            flow = targetPost.querySelector('.editor-flow');
        } else {
            const result = createAndInsertPost();
            card = result.el;
            flow = result.flow;
        }

        await addFolderBlock(flow, files, card, null);
    } catch (e) {
        console.error('映射文件夹失败', e);
    }
}

// 按比例缩放到指定最大宽高
function scaleToFit(origW, origH, maxW, maxH) {
    if (origW <= maxW && origH <= maxH) {
        return { w: origW, h: origH };
    }
    const ratio = Math.min(maxW / origW, maxH / origH);
    return {
        w: Math.round(origW * ratio),
        h: Math.round(origH * ratio)
    };
}

function confirmDeletePost(card, event) {
    const cb = async () => {
        try {
            await invoke("delete_post", { id: parseInt(card.dataset.id), attachments: [] });
            card.style.opacity = '0';
            setTimeout(() => card.remove(), 300);
            allPosts = allPosts.filter(p => p.id !== parseInt(card.dataset.id));
            renderSidebar(allPosts); // Sync Sidebar
        } catch (e) { console.error(e); alert("删除失败"); }
    };

    // 使用事件坐标或中心回退
    const x = event ? event.clientX : window.innerWidth / 2;
    const y = event ? event.clientY : window.innerHeight / 2;
    showConfirm("确定要删除这篇文章吗？", x, y, cb);
}

async function savePost(card) {
    const id = parseInt(card.dataset.id);

    // ... (block collection logic) ...
    // Recursive Block Serializer
    const serializeBlock = (b) => {
        const x = parseInt(b.style.left) || 0;
        const y = parseInt(b.style.top) || 0;
        const w = parseInt(b.style.width) || 200;
        const h = parseInt(b.style.height) || 200;
        const base = { x, y, w, h };

        if (b.classList.contains('block-text')) {
            const data = { ...base, type: 'text', content: b.querySelector('textarea').value };
            if (b.dataset.src) data.src = b.dataset.src;
            return data;
        } else if (b.classList.contains('block-img') || b.classList.contains('block-video')) {
            // Determine type precisely based on class or extension, though class is reliable here
            const isVideo = b.classList.contains('block-video');
            const blockData = { ...base, type: isVideo ? 'video' : 'img', src: b.dataset.src };
            if (b.dataset.displayName) blockData.displayName = b.dataset.displayName;
            if (b.dataset.aspect) blockData.aspect = parseFloat(b.dataset.aspect); // Save Aspect Ratio
            return blockData;
        } else if (b.classList.contains('h5-block')) {
            return {
                ...base,
                type: 'h5',
                content: {
                    h: b.querySelector('[data-type="html"] textarea').value,
                    c: b.querySelector('[data-type="css"] textarea').value,
                    j: b.querySelector('[data-type="js"] textarea').value
                }
            };
        } else if (b.classList.contains('block-todo')) {
            return { ...base, type: 'todo', content: b._todoItems || [] };
        } else if (b.classList.contains('block-embed')) {
            return { ...base, type: 'embed', content: { html: b.dataset.embedHtml || '' } };
        } else if (b.classList.contains('block-folder')) {
            const children = [];
            const inner = b.querySelector('.folder-inner-container');
            if (inner) {
                Array.from(inner.children).forEach(child => {
                    if (child.classList.contains('block')) {
                        const childData = serializeBlock(child);
                        if (childData) children.push(childData);
                    }
                });
            }
            if (b.dataset.layoutSize) {
                // Ensure number
                const ls = parseInt(b.dataset.layoutSize);
                if (!isNaN(ls)) base.layoutSize = ls;
            }
            return { ...base, type: 'folder', children: children };
        }
        return null;
    };

    const blocks = [];
    const flow = card.querySelector('.editor-flow');
    if (flow) {
        Array.from(flow.children).forEach(b => {
            // Only process direct children blocks
            if (b.classList.contains('block')) {
                const data = serializeBlock(b);
                if (data) blocks.push(data);
            }
        });
    }

    // Extract tags from text blocks (Recursive)
    const uniqueTags = new Set();
    const collectTags = (list) => {
        list.forEach(b => {
            if (b.type === 'text') {
                const matches = b.content.match(/#([^\s,;，；]+)/g);
                if (matches) matches.forEach(m => uniqueTags.add(m.substring(1)));
            }
            if (b.children && Array.isArray(b.children)) {
                collectTags(b.children);
            }
        });
    };
    collectTags(blocks);
    const tagsStr = Array.from(uniqueTags).join(',');

    const storyJson = JSON.stringify(blocks);
    try {
        const existing = allPosts.find(p => p.id === id);
        const postData = {
            id,
            created_at: existing ? existing.created_at : Date.now(),
            title: '', // Title logic could be improved too
            tags: tagsStr,
            story: storyJson,
            html: '', css: '', js: ''
        };


        await invoke("save_post", { post: postData });

        // Visual Feedback: Flash Menu Btn
        const menuBtn = document.getElementById("float-menu");
        if (menuBtn) {
            menuBtn.classList.remove("saving-pulse");
            void menuBtn.offsetWidth; // Trigger reflow
            menuBtn.classList.add("saving-pulse");
        }

        // Quietly update local state
        if (!existing) {
            allPosts.unshift(postData);
            card.classList.remove('is-new');
        } else {
            existing.story = storyJson;
            existing.tags = tagsStr;
        }

        card.classList.remove('is-new');
        renderSidebar(allPosts); // Sync Sidebar
        renderTagCloud(allPosts); // Sync Tags

    } catch (e) {
        console.error(e);
    }
}

function createPostElement(post) {
    const card = document.createElement('div');
    card.className = 'post';
    card.dataset.id = post.id;
    if (post.isNew) card.classList.add('is-new');

    // 存储原始数据供 mount 使用
    card._postData = post;

    // 初始状态：未加载内容
    // 但为了不仅显示空白，如果是新创建的（isNew），立即 mount
    // 或者依靠 Observer 立即发现它在视口内从而 mount
    // 为了防止闪烁，我们可以默认创建结构，然后由 VirtualizationObserver 接管
    // 但为了极致性能，我们只创建一个空的占位壳子，或者带有一个初始高度的壳子

    // 这里我们先创建一个空的 editor-flow 容器，方便定位
    // 但不 populate contents regarding blocks
    // 实际上 mountPostContent 会负责填充

    // 如果是新发布的帖子，可能不在视口内（例如排在很后面），但也可能在。
    // 我们先不 mount，让 Observer 决定。
    // 但是，如果没有初始高度，通过 scrollIntoView 可能有问题？
    // 通常 Post 至少有一些高度。
    card.style.minHeight = '400px';

    if (virtualizationObserver) virtualizationObserver.observe(card);

    return card;
}

// --- Post Virtualization ---
let virtualizationObserver = null;

function initPostVirtualization() {
    virtualizationObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const card = entry.target;
            if (entry.isIntersecting) {
                // 进入视口：加载内容
                if (!card.classList.contains('mounted')) {
                    mountPostContent(card);
                }
            } else {
                // 离开视口：卸载内容
                if (card.classList.contains('mounted')) {
                    unmountPostContent(card);
                }
            }
        });
    }, {
        root: document.querySelector('.main-scroll'),
        rootMargin: '1000px 0px 1000px 0px', // 视口外 1000px (约1-2屏幕) 开始虚拟化
        threshold: 0
    });
}

function mountPostContent(card) {
    if (card.classList.contains('mounted')) return;

    const post = card._postData;
    if (!post) return;

    // 恢复内容
    const flow = document.createElement('div');
    flow.className = 'editor-flow';
    card.appendChild(flow);

    let blocks = [];
    try {
        blocks = JSON.parse(post.story || '[]');
    } catch (e) { }

    if (blocks.length > 0 && typeof blocks[0].x === 'undefined') {
        calculateInitialGrid(blocks);
    }

    blocks.forEach(b => renderBlock(flow, b, card));
    updateContainerHeight(flow);

    // 如果之前被冻结了高度，现在解冻（让内容撑开，或者保持 min-height）
    // 但要注意，如果我们之前 set 了 style.height，现在应该移除它，
    // 让 css min-height: 400px 生效，或者由 updateContainerHeight 决定及其 editor-flow 决定
    // card.style.height = ''; // 让 flow 的高度撑开它?
    // .post 目前样式是 min-height: 400px; height: auto? 
    // css: .post { min-height: 400px; overflow: hidden; }
    // flow: .editor-flow { position: relative; min-height: 400px; }
    // flow 是 relative，card 是容器。card 高度应该随 flow。
    // 当 unmount 时，我们把 card 高度固定死。mount 时去掉固定。
    card.style.height = '';

    card.classList.add('mounted');
}

function unmountPostContent(card) {
    if (!card.classList.contains('mounted')) return;

    // Force save if pending to persist changes before destroying DOM
    if (card._saveTimer) {
        clearTimeout(card._saveTimer);
        card._saveTimer = null;
        // savePost reads DOM synchronously at start, so it's safe to call here
        savePost(card);
    }

    // 记录当前高度，防止滚动条跳动
    const rect = card.getBoundingClientRect();
    card.style.height = rect.height + 'px';

    // 清空内容
    card.innerHTML = '';
    card.classList.remove('mounted');
}

function calculateInitialGrid(blocks) {
    const colWidth = 220; // 200 + 20 gap
    const rowHeight = 220;
    const maxCols = 4;

    blocks.forEach((b, i) => {
        const col = i % maxCols;
        const row = Math.floor(i / maxCols);
        b.x = col * colWidth + 20;
        b.y = row * rowHeight + 60; // 留出顶部工具栏空间
        b.w = b.type === 'h5' ? 300 : 200;
        b.h = 200;
    });
}

function scheduleSave(card) {
    if (card._saveTimer) clearTimeout(card._saveTimer);
    card._saveTimer = setTimeout(() => {
        savePost(card);
    }, 1000);
}

function renderBlock(container, blockData, card) {
    const block = document.createElement('div');
    block.className = `block block-${blockData.type}`;
    if (blockData.type === 'h5') block.classList.add('h5-block');

    // 坐标与尺寸
    const x = blockData.x || 20;
    const y = blockData.y || 60;
    const w = blockData.w || (blockData.type === 'h5' ? 300 : 200);
    const h = blockData.h || 200;

    block.style.left = x + 'px';
    block.style.top = y + 'px';
    block.style.width = w + 'px';
    block.style.height = h + 'px';

    // 保存 Aspect Ratio 以避免重排积累误差
    if (blockData.aspect) {
        block.dataset.aspect = blockData.aspect;
    } else if (w && h) {
        block.dataset.aspect = w / h;
    }

    block.innerHTML = `<div class="block-handle"></div><div class="resize-handle"></div><div class="resize-handle-right"></div>`;

    const triggerSave = () => {
        updateContainerHeight(container);
        if (card) scheduleSave(card);
    };

    // 拖拽逻辑
    const handle = block.querySelector('.block-handle');
    makeDraggable(block, handle, container, triggerSave);

    // 缩放逻辑
    const resizer = block.querySelector('.resize-handle');
    makeResizable(block, resizer, container, triggerSave);

    // 右侧缩放逻辑
    const resizerRight = block.querySelector('.resize-handle-right');
    makeResizable(block, resizerRight, container, triggerSave, 'width');

    // 删除按钮
    const del = document.createElement('span');
    del.className = 'block-del';
    del.textContent = '✕';
    del.onclick = (e) => {
        e.stopPropagation();

        const cb = async () => {
            // 如果是媒体块，删除本地文件
            if (block.dataset.src && block.dataset.src.includes('uploads')) {
                try {
                    const localPath = convertToLocalPath(block.dataset.src);
                    await invoke('delete_media_file', { path: localPath });
                } catch (err) { console.warn('删除媒体文件失败', err); }
            }
            block.remove();
            triggerSave();
        };

        // 检测块是否有内容
        const hasContent = checkBlockHasContent(block);
        if (hasContent) {
            showConfirm("确定要删除这个块吗？", e.clientX, e.clientY, cb);
        } else {
            cb(); // 空块直接删除
        }
    };
    block.appendChild(del);

    // 内容渲染
    if (blockData.type === 'folder') {
        if (blockData.layoutSize) {
            block.dataset.layoutSize = blockData.layoutSize;
        }

        const folderInner = document.createElement('div');
        folderInner.className = 'folder-inner-container';
        // Remove padding to match box.html edge-to-edge layout
        // folderInner.style.padding = '20px';
        // folderInner.style.boxSizing = 'border-box';

        // Render children
        if (blockData.children && Array.isArray(blockData.children)) {
            // 暂时禁用 transition 以避免初始散开动画
            folderInner.classList.add('no-transition');

            blockData.children.forEach(childData => {
                // 确保子元素有 aspect
                if (!childData.aspect && childData.w && childData.h) {
                    childData.aspect = childData.w / childData.h;
                }
                const child = renderBlock(folderInner, childData, card);
                // 确保 dataset 有 aspect
                if (child && childData.aspect) {
                    child.dataset.aspect = childData.aspect;
                }
            });
        }

        block.appendChild(folderInner);

        // 关键修复：确保初始加载时触发布局计算
        // 使用 setTimeout 确保 DOM 已插入文档流，能获取宽度
        setTimeout(() => {
            reflowFolderContent(block, w, h);
            // 恢复 transition
            requestAnimationFrame(() => {
                folderInner.classList.remove('no-transition');
            });
        }, 0);

        // Override delete handler for folder to clean up children media
        del.onclick = (e) => {
            e.stopPropagation();
            const cb = async () => {
                // Find all inner blocks
                const innerBlocks = block.querySelectorAll('.block');
                for (const child of innerBlocks) {
                    if (child.dataset.src && child.dataset.src.includes('uploads')) {
                        try {
                            const localPath = convertToLocalPath(child.dataset.src);
                            await invoke('delete_media_file', { path: localPath });
                        } catch (err) { console.warn('删除文件夹内媒体文件失败', err); }
                    }
                }

                // Cleanup scroll listener
                if (block._cleanupBackToTop) block._cleanupBackToTop();

                block.remove();
                triggerSave();
            };

            const hasContent = checkBlockHasContent(block);
            if (hasContent) {
                showConfirm("确定要删除这个文件夹及其内容吗？", e.clientX, e.clientY, cb);
            } else {
                cb();
            }
        };
    } else {
        renderBlockContent(block, blockData, triggerSave);
    }

    // 排序按钮 (仅 Folder)
    if (blockData.type === 'folder') {
        // Create Sidebar Container
        const sidebar = document.createElement('div');
        sidebar.className = 'folder-sidebar';
        const sidebarContent = document.createElement('div');
        sidebarContent.className = 'folder-sidebar-content';
        sidebar.appendChild(sidebarContent);
        block.appendChild(sidebar);

        const createBtn = (cls, html, title, clickHandler) => {
            const btn = document.createElement('span');
            btn.className = cls + ' folder-action-btn'; // Add common class
            btn.innerHTML = html;
            btn.title = title;
            btn.onclick = (e) => {
                e.stopPropagation();
                clickHandler(e, block, btn);
            };
            return btn;
        };

        // 0. 布局尺寸切换按钮 (+)
        // 0. 布局尺寸减少按钮 (-)
        const shrinkBtn = createBtn('block-layout-minus', '-', '缩小显示', (e, b, btn) => {
            let current = parseInt(b.dataset.layoutSize) || 300;
            // Min limit 100
            let next = Math.max(100, current - 100);

            if (current !== next) {
                b.dataset.layoutSize = next;

                // 触发重排 (保持当前高度，或者如果自适应则自适应)
                const currentW = parseInt(b.style.width);
                const currentH = parseInt(b.style.height);

                // 如果是自适应高度模式(height not set on style? no, it is set), 
                // reflowFolderContent needs to know if we want to snap
                const newH = reflowFolderContent(b, b.offsetWidth, b.offsetHeight);
                if (newH) {
                    b.style.height = newH + 'px';
                    // Re-render to settle
                    reflowFolderContent(b, b.offsetWidth, newH);
                    updateContainerHeight(container);
                }
                if (triggerSave) triggerSave();
            }
        });
        sidebarContent.appendChild(shrinkBtn);

        // 0.5 布局尺寸增加按钮 (+)
        const expandBtn = createBtn('block-layout-plus', '+', '放大显示', (e, b, btn) => {
            let current = parseInt(b.dataset.layoutSize) || 300;
            // Max limit 1000
            let next = Math.min(1000, current + 100);

            if (current !== next) {
                b.dataset.layoutSize = next;

                const newH = reflowFolderContent(b, b.offsetWidth, b.offsetHeight);
                if (newH) {
                    b.style.height = newH + 'px';
                    reflowFolderContent(b, b.offsetWidth, newH);
                    updateContainerHeight(container);
                }
                if (triggerSave) triggerSave();
            }
        });
        sidebarContent.appendChild(expandBtn);

        // 1. 倍速按钮
        // 顺序: 1x -> 1.5x -> 2x -> 0.5x -> 1x
        const speedBtn = createBtn('block-speed', '1x', '倍速', (e, b, btn) => {
            let current = parseFloat(b.dataset.playbackSpeed || '1');
            const speeds = [1, 1.5, 2, 0.5];
            let nextIdx = (speeds.indexOf(current) + 1) % speeds.length;
            let next = speeds[nextIdx];

            b.dataset.playbackSpeed = next;
            btn.textContent = next + 'x';

            // 更新所有视频
            b.querySelectorAll('video').forEach(v => {
                v.playbackRate = next;
                v.dataset.manualSpeed = 'true'; // 标记为手动，防止被全局优化覆盖
            });
        });
        sidebarContent.appendChild(speedBtn);

        // 2. 喇叭按钮
        const muteBtn = createBtn('block-mute', '🔇', '静音控制', (e, b, btn) => {
            const isSoundOn = b.dataset.soundMode === 'on';

            if (isSoundOn) {
                // 切换到关闭
                b.dataset.soundMode = 'off';
                btn.textContent = '🔇';
                // 立即静音所有
                b.querySelectorAll('video').forEach(v => v.muted = true);
            } else {
                // 切换到开启 (Hover 模式)
                b.dataset.soundMode = 'on';
                btn.textContent = '🔊';
            }
        });
        sidebarContent.appendChild(muteBtn);

        // 3. 排序按钮
        const sortBtn = createBtn('block-sort', '⇅', '排序', (e, b) => {
            showSortMenu(e, b, triggerSave);
        });
        sidebarContent.appendChild(sortBtn);

        // --- Back to Top Button ---
        const sidebarBottom = document.createElement('div');
        sidebarBottom.className = 'folder-sidebar-bottom';
        sidebar.appendChild(sidebarBottom);

        const backToTopBtn = document.createElement('span');
        backToTopBtn.className = 'block-back-to-top';
        backToTopBtn.innerHTML = '⬆'; // Or SVG icon
        backToTopBtn.title = '回到顶部';

        backToTopBtn.onclick = (e) => {
            e.stopPropagation();
            // Scroll to ensure block top is at 60px (header height) from viewport top
            const headerOffset = 30;
            const rect = block.getBoundingClientRect();
            // Using scrollBy on the container
            // If rect.top is 100, we need to scroll DOWN by 40 (100 - 60)
            // If rect.top is -100, we need to scroll UP by -160 (-100 - 60)
            const diff = rect.top - headerOffset;

            const scrollContainer = document.querySelector('.main-scroll') || window;
            scrollContainer.scrollBy({ top: diff, behavior: 'smooth' });
        };
        sidebarBottom.appendChild(backToTopBtn);

        // Scroll Listener for Visibility
        // Fix: Explicitly target the scroll container (closest might fail if detached during init)
        const scrollTarget = document.querySelector('.main-scroll') || window;

        let ticking = false;
        const updateVisibility = () => {
            if (!block.isConnected) return;

            const rect = block.getBoundingClientRect();
            // Header approx 60px.
            // Condition 1: Folder must be taller than viewport (meaningful to scroll)
            // Condition 2: Top is above viewport (rect.top < -60) AND Bottom is still in viewport
            if (block.offsetHeight > window.innerHeight && rect.top < -60 && rect.bottom > 100) {
                backToTopBtn.classList.add('visible');
            } else {
                backToTopBtn.classList.remove('visible');
            }
            ticking = false;
        };

        const onScroll = () => {
            if (!ticking) {
                window.requestAnimationFrame(updateVisibility);
                ticking = true;
            }
        };

        scrollTarget.addEventListener('scroll', onScroll, { passive: true });

        // Initial check after mount (give it a tick to settle layout)
        setTimeout(updateVisibility, 100);

        // Cleanup on remove
        // We override the delete handler above, but we also need to ensure cleanup if removed externally?
        // JS GC handles listener if target is removed (scrollTarget is persistent though).
        // So we MUST remove listener.
        // We can attach a method to the block to cleanup? Or MutationObserver?
        // Let's hook into the existing delete logic.

        // Store cleanup on block
        block._cleanupBackToTop = () => {
            scrollTarget.removeEventListener('scroll', onScroll);
        };


        // Folder Hover 声音逻辑
        // 使用事件委托监听内部视频
        const inner = block.querySelector('.folder-inner-container');
        if (inner) {
            inner.addEventListener('mouseover', (e) => {
                if (block.dataset.soundMode !== 'on') return;
                // 检测进入 video-wrapper (包含 video 或 controls)
                const wrapper = e.target.closest('.video-wrapper');
                if (wrapper) {
                    const video = wrapper.querySelector('video');
                    if (video) video.muted = false;
                }
            }, true); // Capture phase or bubble? Bubble is fine if target is video. closest handles bubble.
            // Using listener on inner, e.target is the video element (or wrapper)

            inner.addEventListener('mouseout', (e) => {
                if (block.dataset.soundMode !== 'on') return;
                const wrapper = e.target.closest('.video-wrapper');
                // 如果是从 wrapper 内的元素移出 (e.target inside wrapper)，并且移到了 wrapper 外部 (relatedTarget outside)
                if (wrapper && (!e.relatedTarget || !wrapper.contains(e.relatedTarget))) {
                    const video = wrapper.querySelector('video');
                    if (video) video.muted = true;
                }
            }, true);
        }
    }

    // 恢复 src 到 dataset (用于删除逻辑)
    if (blockData.src) {
        block.dataset.src = blockData.src;
    }

    container.appendChild(block);
    return block;
}

// 显示排序菜单
function showSortMenu(e, folderBlock, triggerSave) {
    // 移除旧菜单
    const old = document.querySelector('.sort-menu-popover');
    if (old) old.remove();

    const menu = document.createElement('div');
    menu.className = 'sort-menu-popover';

    const options = [
        { label: '按名称排列', value: 'name' },
        { label: '按日期排列', value: 'date' },
        { label: '按大小排列', value: 'size' },
        { label: '按类型排列', value: 'type' }
    ];

    options.forEach(opt => {
        const item = document.createElement('div');
        item.className = 'sort-menu-item';
        item.textContent = opt.label;
        item.onclick = async () => {
            await sortFolderContent(folderBlock, opt.value, triggerSave);
            menu.remove();
        };
        menu.appendChild(item);
    });

    // 定位
    menu.style.left = (e.clientX - 100) + 'px'; // 简单定位左侧
    menu.style.top = (e.clientY + 10) + 'px';

    document.body.appendChild(menu);

    // 点击其他地方关闭
    setTimeout(() => {
        const close = () => {
            menu.remove();
            document.removeEventListener('click', close);
        };
        document.addEventListener('click', close);
    }, 0);
}

// 文件夹内容排序逻辑
async function sortFolderContent(folderBlock, criteria, triggerSave) {
    const inner = folderBlock.querySelector('.folder-inner-container');
    if (!inner) return;

    const childrenEls = Array.from(inner.children).filter(el => el.classList.contains('block'));
    if (childrenEls.length === 0) return;

    // 获取上一次的排序状态
    const prevSort = folderBlock.dataset.sortCriteria;
    let order = 'asc'; // 默认升序 (Name, Type)

    // 默认方向策略：
    // Name, Type: 默认 asc
    // Date, Size: 默认 desc
    if (criteria === 'date' || criteria === 'size') {
        order = 'desc';
    }

    // 如果点击的是同一个排序标准，则反转顺序
    if (prevSort === criteria) {
        const prevOrder = folderBlock.dataset.sortOrder;
        order = (prevOrder === 'asc') ? 'desc' : 'asc';
    }

    // 保存新状态
    folderBlock.dataset.sortCriteria = criteria;
    folderBlock.dataset.sortOrder = order;

    // 收集信息
    const items = childrenEls.map(el => {
        let src = el.dataset.src || '';
        if (src.includes('asset.localhost')) {
            try { src = decodeURIComponent(src); } catch { }
        }

        // 尝试从 displayName 获取文件名
        const name = el.dataset.displayName || src.split(/[/\\]/).pop() || '';

        // 提取扩展名作为类型
        const ext = name.split('.').pop().toLowerCase();

        return {
            element: el,
            name: name.toLowerCase(),
            type: ext,
            path: el.dataset.src ? convertToLocalPath(el.dataset.src) : null,
            w: parseInt(el.style.width) || 100,
            h: parseInt(el.style.height) || 100
        };
    });

    // 预获取元数据 (Date, Size)
    if (criteria === 'date' || criteria === 'size') {
        const paths = items.filter(i => i.path).map(i => i.path);
        if (paths.length > 0) {
            try {
                const metadata = await invoke('get_files_metadata', { paths });
                const metaMap = {};
                metadata.forEach(m => metaMap[m.path] = m);

                items.forEach(item => {
                    if (item.path && metaMap[item.path]) {
                        item.size = metaMap[item.path].size;
                        item.modified = metaMap[item.path].modified;
                    } else {
                        item.size = 0;
                        item.modified = 0;
                    }
                });
            } catch (err) {
                console.error("Fetch metadata failed", err);
            }
        }
    }

    // 执行排序
    items.sort((a, b) => {
        let cmp = 0;
        switch (criteria) {
            case 'name':
                cmp = a.name.localeCompare(b.name, 'zh-CN');
                break;
            case 'type':
                // 先按类型，同类型按名称
                if (a.type !== b.type) cmp = a.type.localeCompare(b.type);
                else cmp = a.name.localeCompare(b.name, 'zh-CN');
                break;
            case 'date':
                cmp = (a.modified || 0) - (b.modified || 0);
                break;
            case 'size':
                cmp = (a.size || 0) - (b.size || 0);
                break;
        }

        // 应用顺序
        // 如果是 asc: cmp
        // 如果是 desc: -cmp
        return order === 'asc' ? cmp : -cmp;
    });

    // DOM 重排顺序
    items.forEach(item => {
        inner.appendChild(item.element);
    });

    // 触发自适应重排
    // 使用当前 folder 宽度
    const folderWidth = parseInt(folderBlock.style.width);
    const folderHeight = parseInt(folderBlock.style.height);

    const newHeight = reflowFolderContent(folderBlock, folderWidth, folderHeight);

    // 更新高度（吸附）
    if (newHeight) {
        folderBlock.style.height = newHeight + 'px';
    }

    if (triggerSave) triggerSave();
}


function makeDraggable(el, handle, container, onEnd) {
    let isDragging = false;
    let startX, startY;
    let startLeft, startTop;
    let groupOffsets = []; // 存储多选块的初始偏移
    let originalContainer = container;

    const onMouseMove = (e) => {
        if (!isDragging) return;
        const rawDx = e.clientX - startX;
        const rawDy = e.clientY - startY;

        // 基础位置变化
        let newLeft = startLeft + rawDx;
        let newTop = startTop + rawDy;

        // 网格吸附 (10px)
        const GRID_SIZE = 10;
        newLeft = Math.round(newLeft / GRID_SIZE) * GRID_SIZE;
        newTop = Math.round(newTop / GRID_SIZE) * GRID_SIZE;

        // 计算实际移动量
        const actualDx = newLeft - startLeft;
        const actualDy = newTop - startTop;

        // 移动当前块
        el.style.left = newLeft + 'px';
        el.style.top = newTop + 'px';

        // 如果当前块是选中的，同步移动其他选中的块
        if (el.classList.contains('selected') && selectedBlocks.size > 1) {
            groupOffsets.forEach(item => {
                if (item.block !== el) {
                    item.block.style.left = (item.startLeft + actualDx) + 'px';
                    item.block.style.top = (item.startTop + actualDy) + 'px';
                }
            });
        }

        // --- 拖拽出文件夹检测 ---
        if (container.classList.contains('folder-inner-container')) {
            const folderBlock = container.closest('.block-folder');
            if (folderBlock) {
                const folderRect = folderBlock.getBoundingClientRect();
                const BUFFER = 30; // 拖出判定缓冲距离

                // 检测是否拖出文件夹范围
                if (e.clientX < folderRect.left - BUFFER || e.clientX > folderRect.right + BUFFER ||
                    e.clientY < folderRect.top - BUFFER || e.clientY > folderRect.bottom + BUFFER) {

                    // 寻找上层容器 (通常是 editor-flow)
                    const parentContainer = folderBlock.parentElement;
                    // 确保上层容器存在且是合法的容器（拥有 .editor-flow 或 .folder-inner-container）
                    if (parentContainer && (parentContainer.classList.contains('editor-flow') || parentContainer.classList.contains('folder-inner-container'))) {

                        // 计算相对于新容器的坐标
                        const blockRect = el.getBoundingClientRect();
                        const parentRect = parentContainer.getBoundingClientRect();

                        // 考虑到容器可能有滚动
                        const scrollLeft = parentContainer.scrollLeft || 0;
                        const scrollTop = parentContainer.scrollTop || 0;

                        const newRelLeft = blockRect.left - parentRect.left + scrollLeft;
                        const newRelTop = blockRect.top - parentRect.top + scrollTop;

                        // Reparent DOM
                        parentContainer.appendChild(el);

                        // Update Position to maintain visual consistency
                        el.style.left = newRelLeft + 'px';
                        el.style.top = newRelTop + 'px';

                        // Update State
                        container = parentContainer; // 更新当前上下文容器

                        // 重置拖拽起始点，防止突变
                        startX = e.clientX;
                        startY = e.clientY;
                        startLeft = newRelLeft;
                        startTop = newRelTop;

                        // 如果是多选，清空跟随
                        if (groupOffsets.length > 0) {
                            groupOffsets = [];
                        }
                    }
                }
            }
        }

        // --- 拖拽入文件夹检测 ---
        // 只有当前不在文件夹内（即在 editor-flow 中）时才检测
        else if (container.classList.contains('editor-flow')) {
            // 获取当前容器下的所有文件夹块
            const folders = Array.from(container.children).filter(child => child.classList.contains('block-folder') && child !== el);

            for (const folder of folders) {
                const folderRect = folder.getBoundingClientRect();
                const PADDING = 20; // 内缩一点，防止在边缘反复跳变

                // 检测鼠标是否在文件夹内部区域
                if (e.clientX > folderRect.left + PADDING && e.clientX < folderRect.right - PADDING &&
                    e.clientY > folderRect.top + PADDING && e.clientY < folderRect.bottom - PADDING) {

                    const innerContainer = folder.querySelector('.folder-inner-container');
                    if (innerContainer) {
                        // Reparent to Folder
                        const parentContainer = innerContainer;

                        const blockRect = el.getBoundingClientRect();
                        const parentRect = parentContainer.getBoundingClientRect();
                        const scrollLeft = parentContainer.scrollLeft || 0;
                        const scrollTop = parentContainer.scrollTop || 0;

                        const newRelLeft = blockRect.left - parentRect.left + scrollLeft;
                        const newRelTop = blockRect.top - parentRect.top + scrollTop;

                        parentContainer.appendChild(el);
                        el.style.left = newRelLeft + 'px';
                        el.style.top = newRelTop + 'px';

                        container = parentContainer;

                        startX = e.clientX;
                        startY = e.clientY;
                        startLeft = newRelLeft;
                        startTop = newRelTop;

                        if (groupOffsets.length > 0) groupOffsets = [];

                        // Break loop once moved
                        break;
                    }
                }
            }
        }
    };

    const onMouseUp = () => {
        if (isDragging) {
            isDragging = false;
            el.style.zIndex = '';
            document.body.style.cursor = '';
            handle.style.cursor = 'grab';

            if (container) container.classList.remove('dragging');
            if (originalContainer && originalContainer !== container) originalContainer.classList.remove('dragging');

            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            // 恢复所有 iframe 鼠标事件
            if (container) container.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = '');
            if (originalContainer && originalContainer !== container) originalContainer.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = '');

            window.isGlobalDragging = false;
            groupOffsets = [];

            if (onEnd) onEnd();

            // 如果更换了容器，更新新容器的高度
            if (container !== originalContainer) {
                // 1. 如果是从文件夹拖出去的 -> 重排原文件夹（填补空缺）
                if (originalContainer.classList.contains('folder-inner-container')) {
                    const folderBlock = originalContainer.closest('.block-folder');
                    if (folderBlock) {
                        const w = folderBlock.offsetWidth;
                        const h = reflowFolderContent(folderBlock, w); // reflow 会自动处理布局和高度
                        folderBlock.style.height = h + 'px';
                    }
                }

                // 2. 如果是拖入文件夹的 -> 重排新文件夹（加入布局）
                if (container.classList.contains('folder-inner-container')) {
                    const folderBlock = container.closest('.block-folder');
                    if (folderBlock) {
                        const w = folderBlock.offsetWidth;
                        const h = reflowFolderContent(folderBlock, w);
                        folderBlock.style.height = h + 'px';
                    }
                } else {
                    // 如果是拖到普通容器，更新高度
                    updateContainerHeight(container);
                }

                // 原容器如果是 editor-flow，也要更新高度
                if (originalContainer.classList.contains('editor-flow')) {
                    updateContainerHeight(originalContainer);
                }
            } else {
                // 同容器移动
                if (container.classList.contains('folder-inner-container')) {
                    const folderBlock = container.closest('.block-folder');
                    if (folderBlock) {
                        const w = folderBlock.offsetWidth;
                        const h = reflowFolderContent(folderBlock, w);
                        folderBlock.style.height = h + 'px';
                    }
                } else {
                    updateContainerHeight(container);
                }
            }
        }
    };

    handle.addEventListener('mousedown', e => {
        if (e.ctrlKey) return;
        e.preventDefault();
        e.stopPropagation();
        isDragging = true;
        window.isGlobalDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        startLeft = parseInt(el.style.left) || 0;
        startTop = parseInt(el.style.top) || 0;

        // 重新获取容器
        if (el.parentElement) {
            container = el.parentElement;
            originalContainer = container;
        }

        // 如果当前块是选中的多选块之一，记录所有选中块的初始位置
        if (el.classList.contains('selected') && selectedBlocks.size > 1) {
            groupOffsets = [];
            selectedBlocks.forEach(block => {
                groupOffsets.push({
                    block: block,
                    startLeft: parseInt(block.style.left) || 0,
                    startTop: parseInt(block.style.top) || 0
                });
            });
        }

        container.classList.add('dragging');
        document.body.style.cursor = 'grabbing';
        handle.style.cursor = 'grabbing';

        el.style.zIndex = 100;

        container.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = 'none');

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}

// --- Magnetic & Group Helpers ---
// (Removed: Simplified logic uses Grid Snap only)

function makeResizable(el, handle, container, onEnd, resizeMode = 'both') {
    let isResizing = false;
    let startX, startY, initialW, initialH;

    const onMouseMove = (e) => {
        if (!isResizing) return;
        let dx = e.clientX - startX;
        let dy = e.clientY - startY;

        if (resizeMode === 'width') dy = 0;
        if (resizeMode === 'height') dx = 0;

        let newW = initialW + dx;
        let newH = initialH + dy;

        // 媒体保持宽高比
        if (el.classList.contains('block-img') || el.classList.contains('block-video')) {
            const ratio = initialW / initialH;

            // 1. Maintain Aspect Ratio based on dominant axis
            if (resizeMode === 'width') {
                newH = newW / ratio;
            } else if (resizeMode === 'height') {
                newW = newH * ratio;
            } else {
                if (Math.abs(dx) > Math.abs(dy)) {
                    newH = newW / ratio;
                } else {
                    newW = newH * ratio;
                }
            }

            // 2. Apply "Smallest Edge >= 200px" constraint
            // 如果宽 < 高 (Tall), 则宽受限；如果高 < 宽 (Wide), 则高受限
            const isTall = ratio < 1;
            const minSize = 200;

            if (isTall) {
                // Tall: Width is the smallest edge
                if (newW < minSize) {
                    newW = minSize;
                    newH = newW / ratio;
                }
            } else {
                // Wide: Height is the smallest edge (or Square)
                if (newH < minSize) {
                    newH = minSize;
                    newW = newH * ratio;
                }
            }

        } else {
            // 普通块限制
            let minW = 100;
            let minH = 50;

            if (el.classList.contains('block-folder')) {
                minW = 300; minH = 300;
            } else if (el.classList.contains('h5-block') || el.classList.contains('block-embed')) {
                minW = 200; minH = 200;
            }

            if (newW < minW) newW = minW;
            if (newH < minH) newH = minH;
        }

        if (el.classList.contains('block-folder')) {
            // 实时重排 Folder 内容
            reflowFolderContent(el, newW, newH);
        }

        el.style.width = newW + 'px';
        el.style.height = newH + 'px';

        if (container && typeof updateContainerHeight === 'function') {
            updateContainerHeight(container);
        }
    };

    const onMouseUp = () => {
        // 如果是文件夹块，释放时进行吸附 (Snap to Natural Height)
        if (isResizing && el.classList.contains('block-folder')) {
            el.classList.remove('resizing'); // 移除 resizing 类
            // 关键修正：传入当前高度 (el.offsetHeight) 而不是 0，
            // 这样 calculateFolderLayout 才能根据当前拖拽的高度估算正确的行数 k，从而计算出正确的 totalNaturalHeight
            const naturalH = reflowFolderContent(el, parseInt(el.style.width), el.offsetHeight);
            if (naturalH) {
                // 吸附到计算出的自然高度
                el.style.height = naturalH + 'px';
                // 再次渲染，传入最终高度，此时 scaleFactor 应接近 1
                reflowFolderContent(el, parseInt(el.style.width), naturalH);
                // 更新容器高度
                if (container && typeof updateContainerHeight === 'function') {
                    updateContainerHeight(container);
                }
            }
        }

        if (isResizing) {
            isResizing = false;
            el.classList.remove('resizing'); // 确保移除
            el.style.zIndex = '';
            el.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = '');
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            window.isGlobalDragging = false;
            if (onEnd) onEnd();
        }
    };

    handle.addEventListener('mousedown', e => {
        if (e.ctrlKey) return;
        e.stopPropagation();
        e.preventDefault();
        isResizing = true;
        if (el.classList.contains('block-folder')) {
            el.classList.add('resizing'); // 添加 resizing 类
        }
        window.isGlobalDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        initialW = el.offsetWidth;
        initialH = el.offsetHeight;

        el.style.zIndex = 100;
        el.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = 'none');
        document.body.style.userSelect = 'none';

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}

function updateContainerHeight(container) {
    // 忽略 folder-inner-container，它们的高度由父级 .block-folder 控制 (CSS height: 100%)
    if (container.classList.contains('folder-inner-container')) return;

    // Find lowest block
    let maxBottom = 400; // Min height
    Array.from(container.children).forEach(block => {
        const top = parseInt(block.style.top) || 0;
        const h = parseInt(block.style.height) || 0;
        if ((top + h) > maxBottom) maxBottom = top + h;
    });
    container.style.height = (maxBottom + 100) + 'px';
}

// 创建媒体文件名编辑器（图片和视频共用）
function createMediaFilenameEditor(blockData, block, wrapper, triggerSave) {
    // 获取文件名
    let filename = blockData.displayName;
    if (!filename) {
        let decodedSrc = blockData.src;
        try { decodedSrc = decodeURIComponent(decodedSrc); } catch { }
        const rawFilename = decodedSrc.split('/').pop().split('\\').pop();
        filename = rawFilename.replace(/^\d+_/, ''); // 移除时间戳前缀
    }

    const dotIdx = filename.lastIndexOf('.');
    const baseName = dotIdx > 0 ? filename.slice(0, dotIdx) : filename;
    const ext = dotIdx > 0 ? filename.slice(dotIdx) : '';

    const nameContainer = document.createElement('div');
    nameContainer.className = 'media-filename';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'media-filename-input';
    nameInput.value = baseName;
    nameInput.dataset.originalSrc = blockData.src;

    const extSpan = document.createElement('span');
    extSpan.className = 'media-filename-ext';
    extSpan.textContent = ext;

    nameContainer.appendChild(nameInput);
    nameContainer.appendChild(extSpan);
    wrapper.appendChild(nameContainer);

    // 动态调整 input 宽度
    const autoResizeInput = () => {
        const measure = document.createElement('span');
        measure.style.cssText = 'visibility:hidden;position:absolute;white-space:pre;font-size:12px';
        measure.textContent = nameInput.value || 'W';
        nameContainer.appendChild(measure);
        nameInput.style.width = Math.max(10, measure.offsetWidth) + 'px';
        measure.remove();
    };
    setTimeout(autoResizeInput, 0);
    nameInput.addEventListener('input', autoResizeInput);

    // 失焦时重命名
    nameInput.addEventListener('blur', async () => {
        const newName = nameInput.value.trim();
        if (!newName || newName === baseName) return;
        const srcPath = block.dataset.src;
        if (srcPath && srcPath.includes('uploads')) {
            try {
                const localPath = convertToLocalPath(srcPath);
                const newPath = await invoke('rename_media_file', { oldPath: localPath, newName });
                block.dataset.src = newPath;
                nameInput.dataset.originalSrc = newPath;
            } catch (err) {
                console.error('重命名失败', err);
                nameInput.value = baseName;
                return;
            }
        } else {
            block.dataset.displayName = newName + ext;
        }
        triggerSave();
    });

    nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') nameInput.blur(); });
    nameInput.addEventListener('mousedown', e => { if (!e.ctrlKey) e.stopPropagation(); });
}

function renderBlockContent(block, blockData, triggerSave) {
    if (blockData.type === 'text') {
        const ta = document.createElement('textarea');
        ta.value = blockData.content;
        ta.placeholder = "输入正文...";
        ta.addEventListener('mousedown', e => {
            if (e.ctrlKey) return;
            e.stopPropagation();
        });
        ta.addEventListener('input', triggerSave);
        block.appendChild(ta);

        // Markdown 预览层
        const preview = document.createElement('div');
        preview.className = 'markdown-preview';
        // 初始同步内容
        preview.innerHTML = parseMarkdown(ta.value);
        block.appendChild(preview);

        const showEdit = (cursorPos = -1) => {
            const currentScroll = preview.scrollTop;
            ta.style.display = 'block';
            preview.style.display = 'none';
            ta.scrollTop = currentScroll;

            ta.focus();
            if (cursorPos >= 0) {
                const max = ta.value.length;
                ta.setSelectionRange(Math.min(cursorPos, max), Math.min(cursorPos, max));

                // 再次修正滚动，防止光标定位导致的强制跳动，优先保持之前的视觉位置
                if (ta.scrollTop !== currentScroll) {
                    ta.scrollTop = currentScroll;
                }
            }
            if (ta._osInstance) ta._osInstance.update();
        };

        const showPreview = () => {
            const currentScroll = ta.scrollTop;
            const val = ta.value;
            if (!val.trim()) {
                preview.innerHTML = '<span style="opacity:0.5; pointer-events: none;">输入正文...</span>';
            } else {
                preview.innerHTML = parseMarkdown(val);
            }
            ta.style.display = 'none';
            preview.style.display = 'block';
            preview.scrollTop = currentScroll;
        };

        // 事件绑定
        ta.addEventListener('blur', showPreview);

        // 单击编辑 (防止拖拽误触)
        let downX = 0, downY = 0;
        preview.addEventListener('mousedown', (e) => {
            downX = e.clientX;
            downY = e.clientY;
        });

        preview.addEventListener('click', (e) => {
            const dist = Math.sqrt(Math.pow(e.clientX - downX, 2) + Math.pow(e.clientY - downY, 2));
            if (dist < 5) {
                e.stopPropagation();

                let cursorPos = -1;

                // 计算光标位置
                if (document.caretRangeFromPoint) {
                    const range = document.caretRangeFromPoint(e.clientX, e.clientY);
                    if (range) {
                        // 1. 找到所在的行元素
                        let node = range.startContainer;
                        let lineEl = node.nodeType === 3 ? node.parentElement : node;
                        while (lineEl && lineEl !== preview && !lineEl.dataset.srcLine) {
                            lineEl = lineEl.parentElement;
                        }

                        if (lineEl && lineEl.dataset.srcLine) {
                            const lineIndex = parseInt(lineEl.dataset.srcLine);
                            const sourceLines = ta.value.split('\n');
                            if (lineIndex < sourceLines.length) {
                                const sourceLine = sourceLines[lineIndex];

                                // 2. 计算在当前行内的视觉偏移
                                const preCaretRange = range.cloneRange();
                                preCaretRange.selectNodeContents(lineEl);
                                preCaretRange.setEnd(range.startContainer, range.startOffset);
                                const visualOffset = preCaretRange.toString().length;

                                // 3. 映射到源码偏移
                                const getVisualLen = (str) => {
                                    return str
                                        .replace(/^\s*[-#>]+\s+/, '')
                                        .replace(/^\s*-\s+/, '')
                                        .replace(/\*\*([^*]+)\*\*/g, '$1')
                                        .replace(/\*([^*]+)\*/g, '$1')
                                        .replace(/~~([^~]+)~~/g, '$1')
                                        .replace(/`([^`]+)`/g, '$1')
                                        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
                                        .length;
                                };

                                let bestK = 0;
                                for (let k = 0; k <= sourceLine.length; k++) {
                                    if (getVisualLen(sourceLine.substring(0, k)) >= visualOffset) {
                                        bestK = k;
                                        break;
                                    }
                                }

                                // 4. 累加前置行
                                let totalPos = 0;
                                for (let i = 0; i < lineIndex; i++) {
                                    totalPos += sourceLines[i].length + 1;
                                }
                                cursorPos = totalPos + bestK;
                            }
                        }
                    }
                }

                showEdit(cursorPos);
            }
        });

        // 初始状态：有内容则预览，无内容则编辑
        if (ta.value.trim()) {
            showPreview();
        } else {
            if (blockData.isNew) {
                setTimeout(() => showEdit(), 0);
            } else {
                showEdit();
            }
        }

        setTimeout(() => {
            // 为 Textarea 初始化滚动条 (已存在)
            new OverlayScrollbar(ta, block);
            new OverlayScrollbar(preview, block);
        }, 50);
    } else if (blockData.type === 'img' || blockData.type === 'video') {
        const src = convertLocalPath(blockData.src);
        let mediaEl;
        if (blockData.type === 'video') {
            // 创建视频容器
            const videoWrapper = document.createElement('div');
            videoWrapper.className = 'video-wrapper';

            // 使用公共的文件名编辑器
            createMediaFilenameEditor(blockData, block, videoWrapper, triggerSave);


            mediaEl = document.createElement('video');
            // mediaEl.autoplay = true; // 由 Observer 接管
            mediaEl.muted = true;
            mediaEl.loop = true;
            mediaEl.playsInline = true;
            // 优化：初始不设置 src，存储在 data-src 中
            mediaEl.dataset.src = src;
            mediaEl.preload = 'none'; // 确保不预加载
            mediaEl.className = 'media-content';

            // 控件容器
            const controls = document.createElement('div');
            controls.className = 'video-controls';

            // 进度条
            const progressBar = document.createElement('div');
            progressBar.className = 'video-progress';
            const progressFill = document.createElement('div');
            progressFill.className = 'video-progress-fill';
            progressBar.appendChild(progressFill);




            // 静音按钮
            const muteBtn = document.createElement('button');
            muteBtn.className = 'video-mute-btn';
            muteBtn.textContent = '🔇';

            controls.appendChild(progressBar);
            controls.appendChild(muteBtn);

            videoWrapper.appendChild(mediaEl);
            videoWrapper.appendChild(controls);
            block.appendChild(videoWrapper);

            // 加入性能监控
            setTimeout(() => {
                if (preloadObserver) preloadObserver.observe(mediaEl);
                if (playbackObserver) playbackObserver.observe(mediaEl);
            }, 0);

            // 更新进度
            mediaEl.addEventListener('timeupdate', () => {
                const percent = (mediaEl.currentTime / mediaEl.duration) * 100;
                progressFill.style.width = percent + '%';
            });

            // 标记初始状态（自动播放且静音）
            mediaEl.dataset.initialState = 'true';

            // 点击视频：
            // 逻辑修正：初始状态下，点击总是为了"取消静音"。
            // 无论是否有干扰导致 mousedown 提前取消了静音，Click 事件都应强制确保"非静音且播放"，而不是切换到暂停。
            mediaEl.addEventListener('click', (e) => {
                if (e.ctrlKey) return;
                e.stopPropagation();

                // 如果还在初始自动静音阶段，且当前确实是静音状态
                if (mediaEl.dataset.initialState === 'true' && mediaEl.muted) {
                    mediaEl.muted = false;
                    mediaEl.dataset.initialState = 'false';
                    muteBtn.textContent = '🔊';

                    // 确保播放
                    if (mediaEl.paused) mediaEl.play();
                } else {
                    // 如果已经非静音（SoundMode已开启 或 已经点过），则执行暂停/播放切换
                    // 同时清除初始状态
                    mediaEl.dataset.initialState = 'false';

                    if (mediaEl.paused) {
                        mediaEl.play();
                    } else {
                        mediaEl.pause();
                    }
                }
            });

            // 静音按钮
            muteBtn.addEventListener('click', (e) => {
                if (e.ctrlKey) return;
                e.stopPropagation();
                mediaEl.muted = !mediaEl.muted;
                muteBtn.textContent = mediaEl.muted ? '🔇' : '🔊';
                // 人工干预后，退出初始状态模式
                mediaEl.dataset.initialState = 'false';
            });

            // 进度条点击定位
            progressBar.addEventListener('click', (e) => {
                if (e.ctrlKey) return;
                e.stopPropagation();
                const rect = progressBar.getBoundingClientRect();
                const percent = (e.clientX - rect.left) / rect.width;
                mediaEl.currentTime = percent * mediaEl.duration;

                // 点击进度条自动取消静音
                if (mediaEl.muted) {
                    mediaEl.muted = false;
                    muteBtn.textContent = '🔊';
                }
            });

            // 进度条拖拽
            let isDraggingProgress = false;
            progressBar.addEventListener('mousedown', (e) => {
                if (e.ctrlKey) return;
                e.stopPropagation();
                isDraggingProgress = true;
                const rect = progressBar.getBoundingClientRect();
                const percent = (e.clientX - rect.left) / rect.width;
                mediaEl.currentTime = percent * mediaEl.duration;

                // 拖拽进度条自动取消静音
                if (mediaEl.muted) {
                    mediaEl.muted = false;
                    muteBtn.textContent = '🔊';
                }
            });
            document.addEventListener('mousemove', (e) => {
                if (!isDraggingProgress) return;
                const rect = progressBar.getBoundingClientRect();
                let percent = (e.clientX - rect.left) / rect.width;
                percent = Math.max(0, Math.min(1, percent));
                mediaEl.currentTime = percent * mediaEl.duration;
            });
            document.addEventListener('mouseup', () => {
                isDraggingProgress = false;
            });

        } else {
            // 图片容器
            const imgWrapper = document.createElement('div');
            imgWrapper.className = 'img-wrapper';

            // 使用公共的文件名编辑器
            createMediaFilenameEditor(blockData, block, imgWrapper, triggerSave);

            mediaEl = document.createElement('img');
            mediaEl.src = src;
            mediaEl.className = 'media-content';
            imgWrapper.appendChild(mediaEl);
            block.appendChild(imgWrapper);
        }
        block.dataset.src = blockData.src;
        // 加载自定义显示名称到 DOM
        if (blockData.displayName) {
            block.dataset.displayName = blockData.displayName;
        }
    } else if (blockData.type === 'embed') {
        // 简洁嵌入块（无 tab，直接显示 iframe）
        const container = document.createElement('div');
        container.style.cssText = 'width:100%;height:100%;overflow:hidden';
        container.innerHTML = blockData.content.html || '';
        block.appendChild(container);
        block.dataset.embedHtml = blockData.content.html || '';
    } else if (blockData.type === 'h5') {
        const { h, c, j } = blockData.content;
        const ui = document.createElement('div');
        ui.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%';
        ui.innerHTML = `
           <div class="h5-tabs">
              <div class="h5-tab" data-tab="preview">预览</div>
              <div class="h5-tab" data-tab="html">HTML</div>
              <div class="h5-tab" data-tab="css">CSS</div>
              <div class="h5-tab" data-tab="js">JS</div>
           </div>
           <div class="h5-content-area">
              <div class="h5-preview-layer active"><iframe></iframe></div>
              <div class="h5-editor-layer" data-type="html">
                <div class="h5-line-numbers"></div>
                <textarea placeholder="HTML">${escapeHtml(h)}</textarea>
              </div>
              <div class="h5-editor-layer" data-type="css">
                <div class="h5-line-numbers"></div>
                <textarea placeholder="CSS">${escapeHtml(c)}</textarea>
              </div>
              <div class="h5-editor-layer" data-type="js">
                <div class="h5-line-numbers"></div>
                <textarea placeholder="JS">${escapeHtml(j)}</textarea>
              </div>
           </div>
        `;
        block.appendChild(ui);

        const tabs = ui.querySelectorAll('.h5-tab');
        const layers = ui.querySelectorAll('.h5-editor-layer, .h5-preview-layer');
        const frame = ui.querySelector('iframe');

        // 行号更新函数
        const updateLineNumbers = (textarea, lineNumEl) => {
            const lines = textarea.value.split('\n').length;
            const nums = [];
            for (let i = 1; i <= Math.max(lines, 20); i++) nums.push(i);
            lineNumEl.innerHTML = nums.join('<br>');
        };

        // 滚动同步
        const syncScroll = (textarea, lineNumEl) => {
            lineNumEl.scrollTop = textarea.scrollTop;
        };

        // 为每个编辑器层绑定行号逻辑
        ui.querySelectorAll('.h5-editor-layer').forEach(layer => {
            const ta = layer.querySelector('textarea');
            const ln = layer.querySelector('.h5-line-numbers');

            updateLineNumbers(ta, ln);
            ta.addEventListener('input', () => {
                updateLineNumbers(ta, ln);
                triggerSave();
            });
            ta.addEventListener('scroll', () => syncScroll(ta, ln));
            ta.addEventListener('mousedown', e => e.stopPropagation());
            // Init H5 Editor Scrollbar (Host is layer)
            setTimeout(() => new OverlayScrollbar(ta, layer), 50);
        });

        const runPreview = () => {
            const _h = ui.querySelector('[data-type="html"] textarea').value;
            const _c = ui.querySelector('[data-type="css"] textarea').value;
            const _j = ui.querySelector('[data-type="js"] textarea').value;

            // Inject scrollbar styles into the iframe
            const scrollbarStyles = `
                ::-webkit-scrollbar { width: 8px; height: 8px; background: transparent; }
                ::-webkit-scrollbar-track { background: transparent; }
                ::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.2); border-radius: 4px; border: 2px solid transparent; background-clip: content-box; }
                ::-webkit-scrollbar-thumb:hover { background-color: rgba(0, 0, 0, 0.4); }
                * { scrollbar-width: thin; scrollbar-color: rgba(0,0,0,0.2) transparent; }
            `;

            const src = `<!DOCTYPE html><html><head><style>${scrollbarStyles}</style><style>${_c}</style></head><body>${_h}<script>${_j}<\/script></body></html>`;
            frame.srcdoc = src;
        };

        tabs.forEach(t => t.onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            tabs.forEach(x => x.classList.remove('active'));
            t.classList.add('active');
            layers.forEach(l => l.classList.remove('active'));

            const tabName = t.dataset.tab;
            if (tabName === 'preview') {
                ui.querySelector('.h5-preview-layer').classList.add('active');
                runPreview();
            } else {
                const layer = ui.querySelector(`.h5-editor-layer[data-type="${tabName}"]`);
                layer.classList.add('active');
                // 激活时更新行号
                const ta = layer.querySelector('textarea');
                const ln = layer.querySelector('.h5-line-numbers');
                updateLineNumbers(ta, ln);
            }
        });

        runPreview();
        tabs[0].classList.add('active');

    } else if (blockData.type === 'todo') {
        const wrapper = document.createElement('div');
        wrapper.className = 'block-todo-wrapper';

        const items = (Array.isArray(blockData.content) ? blockData.content : []).map(item => {
            if (typeof item.status === 'undefined') {
                return { text: item.text || '', status: item.done ? 'done' : 'empty', important: false };
            }
            return item;
        });

        const statusCycle = ['empty', 'done', 'question', 'cancelled'];
        const statusIcons = { empty: '○', done: '✓', question: '?', cancelled: '✗' };

        const createRow = (item, insertAtEnd = true) => {
            // Status
            const statusEl = document.createElement('span');
            statusEl.className = 'todo-status ' + (item.status !== 'empty' ? 'status-' + item.status : '');
            statusEl.textContent = statusIcons[item.status];

            // Text Area
            const textEl = document.createElement('textarea');
            textEl.className = 'todo-text';
            textEl.placeholder = "待办...";
            textEl.rows = 1;
            textEl.value = item.text || '';
            if (item.status === 'cancelled') textEl.classList.add('status-cancelled');
            if (item.important) textEl.classList.add('important');

            // Preview Div
            const previewEl = document.createElement('div');
            previewEl.className = 'todo-text-preview markdown-preview'; // 复用 markdown-preview 样式
            previewEl.style.display = 'none';

            // Event: Status Cycle
            statusEl.onclick = () => {
                const idx = statusCycle.indexOf(item.status);
                item.status = statusCycle[(idx + 1) % statusCycle.length];

                statusEl.textContent = statusIcons[item.status];
                statusEl.className = 'todo-status';
                if (item.status !== 'empty') statusEl.classList.add('status-' + item.status);

                textEl.classList.toggle('status-cancelled', item.status === 'cancelled');

                // Update preview style as well
                previewEl.classList.toggle('status-cancelled', item.status === 'cancelled');

                triggerSave();
            };

            const autoResize = () => {
                const savedScroll = wrapper.scrollTop;
                textEl.style.height = 'auto';
                textEl.style.height = textEl.scrollHeight + 'px';
                wrapper.scrollTop = savedScroll;
            };

            // Logic: Show/Hide
            const showEdit = (cursorPos = -1) => {
                textEl.style.display = 'block';
                previewEl.style.display = 'none';
                textEl.focus();

                if (cursorPos >= 0) {
                    const max = textEl.value.length;
                    textEl.setSelectionRange(Math.min(cursorPos, max), Math.min(cursorPos, max));
                }

                autoResize();
            };

            const showPreview = () => {
                const val = textEl.value;
                if (!val.trim()) {
                    // 空内容保持显示 Textarea 或者显示占位? 
                    // Todo项通常较小，我们可以保持 Input 显示如果为空，或者显示默认文本
                    // 为了交互统一，如果为空，显示编辑状态比较方便输入
                    // 或者显示灰色占位
                    previewEl.innerHTML = '<span style="opacity:0.5; pointer-events:none">待办...</span>';
                } else {
                    previewEl.innerHTML = parseMarkdown(val);
                }
                textEl.style.display = 'none';
                previewEl.style.display = 'block';
            };

            // Initial State
            if (item.text && item.text.trim()) {
                showPreview();
            } else {
                if (blockData.isNew) {
                    setTimeout(() => showEdit(), 0);
                } else {
                    showEdit();
                }
            }

            // Events
            textEl.addEventListener('blur', showPreview);

            // Click preview to edit
            let downX = 0, downY = 0;
            previewEl.addEventListener('mousedown', (e) => {
                downX = e.clientX;
                downY = e.clientY;
            });

            previewEl.addEventListener('click', (e) => {
                const dist = Math.sqrt(Math.pow(e.clientX - downX, 2) + Math.pow(e.clientY - downY, 2));
                if (dist < 5) {
                    e.stopPropagation();

                    let cursorPos = -1;

                    // 计算光标位置
                    if (document.caretRangeFromPoint) {
                        const range = document.caretRangeFromPoint(e.clientX, e.clientY);
                        if (range) {
                            // 1. 找到所在的行元素
                            let node = range.startContainer;
                            let lineEl = node.nodeType === 3 ? node.parentElement : node;
                            while (lineEl && lineEl !== previewEl && !lineEl.dataset.srcLine) {
                                lineEl = lineEl.parentElement;
                            }

                            if (lineEl && lineEl.dataset.srcLine) {
                                const lineIndex = parseInt(lineEl.dataset.srcLine);
                                const sourceLines = textEl.value.split('\n');
                                if (lineIndex < sourceLines.length) {
                                    const sourceLine = sourceLines[lineIndex];

                                    // 2. 计算在当前行内的视觉偏移
                                    const preCaretRange = range.cloneRange();
                                    preCaretRange.selectNodeContents(lineEl);
                                    preCaretRange.setEnd(range.startContainer, range.startOffset);
                                    const visualOffset = preCaretRange.toString().length;

                                    // 3. 映射到源码偏移（简易版，Todo通常较简单，复用通用逻辑）
                                    const getVisualLen = (str) => {
                                        return str
                                            .replace(/^\s*[-#>]+\s+/, '')
                                            .replace(/^\s*-\s+/, '')
                                            .replace(/\*\*([^*]+)\*\*/g, '$1')
                                            .replace(/\*([^*]+)\*/g, '$1')
                                            .replace(/~~([^~]+)~~/g, '$1')
                                            .replace(/`([^`]+)`/g, '$1')
                                            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
                                            .length;
                                    };

                                    let bestK = 0;
                                    for (let k = 0; k <= sourceLine.length; k++) {
                                        if (getVisualLen(sourceLine.substring(0, k)) >= visualOffset) {
                                            bestK = k;
                                            break;
                                        }
                                    }

                                    // 4. 累加前置行
                                    let totalPos = 0;
                                    for (let i = 0; i < lineIndex; i++) {
                                        totalPos += sourceLines[i].length + 1;
                                    }
                                    cursorPos = totalPos + bestK;
                                }
                            }
                        }
                    }
                    showEdit(cursorPos);
                }
            });

            textEl.oninput = (e) => {
                item.text = e.target.value;
                autoResize();
                triggerSave();
            };
            textEl.addEventListener('mousedown', e => e.stopPropagation());

            setTimeout(() => {
                autoResize();
            }, 50);

            // Container for Text + Preview (to handle layout)
            const textContainer = document.createElement('div');
            textContainer.style.position = 'relative';
            // 重要：为了让 grid 正确计算高度，textContainer 需要 fit-content 或类似
            // 实际上 grid 是对 todo-wrapper 的 items (status, container, del)
            // textContainer 应包含 textarea(edit) 和 preview
            textContainer.appendChild(textEl);
            textContainer.appendChild(previewEl);

            if (insertAtEnd) {
                wrapper.appendChild(statusEl);
                wrapper.appendChild(textContainer);
            } else {
                wrapper.prepend(textContainer);
                wrapper.prepend(statusEl);
            }
        };

        items.forEach(it => createRow(it));

        block.appendChild(wrapper);
        new OverlayScrollbar(wrapper, block);

        // 存储 items 引用以供 savePost 使用
        block._todoItems = items;
        block._todoCreateRow = createRow;
    }
}

function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// 检测块是否有内容
function checkBlockHasContent(block) {
    // 文本块：检查 textarea 是否有内容
    if (block.classList.contains('block-text')) {
        const ta = block.querySelector('textarea');
        return ta && ta.value.trim().length > 0;
    }
    // 媒体块：有 src 就算有内容
    if (block.classList.contains('block-img') || block.classList.contains('block-video')) {
        return !!block.dataset.src;
    }
    // H5 块：检查三个编辑器是否有内容
    if (block.classList.contains('h5-block')) {
        const tas = block.querySelectorAll('.h5-editor-layer textarea');
        for (const ta of tas) {
            if (ta.value.trim().length > 0) return true;
        }
        return false;
    }
    // Todo 块：检查是否有待办项内容
    if (block.classList.contains('block-todo')) {
        const items = block._todoItems || [];
        return items.some(item => item.text && item.text.trim().length > 0);
    }
    // Embed 块：有 html 就算有内容
    if (block.classList.contains('block-embed')) {
        return !!block.dataset.embedHtml;
    }
    // Folder 块：有子块就算有内容
    if (block.classList.contains('block-folder')) {
        return block.querySelectorAll('.block').length > 0;
    }
    return false;
}

function convertLocalPath(path) {
    if (!path || path.startsWith('http') || path.startsWith('asset:') || path.startsWith('blob:')) return path;
    return convertFileSrc(path);
}

// 将 asset URL 或其他格式转换回本地路径（用于后端操作）
function convertToLocalPath(path) {
    if (!path) return path;
    // 已经是本地路径
    if (/^[a-zA-Z]:[\\\/]/.test(path) || path.startsWith('/')) {
        return path;
    }
    // Tauri asset URL 格式: https://asset.localhost/xxx 或 asset://localhost/xxx
    // 从 URL 中提取路径并解码
    try {
        if (path.includes('asset.localhost') || path.startsWith('asset://')) {
            const url = new URL(path);
            let localPath = decodeURIComponent(url.pathname);
            // Windows 路径修复：移除开头的 /
            if (localPath.startsWith('/') && /^\/[a-zA-Z]:/.test(localPath)) {
                localPath = localPath.slice(1);
            }
            return localPath;
        }
    } catch (e) {
        console.warn('路径转换失败', e);
    }
    return path;
}

function handleSearch() {
    const q = document.getElementById('search-input').value.toLowerCase();
    const filtered = allPosts.filter(p => (p.story || '').toLowerCase().includes(q));
    renderFeed(filtered);
}

// --- Custom Overlay Scrollbar Logic ---

class OverlayScrollbar {
    constructor(target, host = null) {
        this.target = target;
        this.host = host || target.parentElement; // Default to parent if not specified

        // Ensure host has relative positioning for absolute placement
        const hostStyle = window.getComputedStyle(this.host);
        if (hostStyle.position === 'static') {
            this.host.style.position = 'relative';
        }

        this.initDOM();
        this.bindEvents();
        this.update();

        // Save instance for potential cleanup or access
        this.target._osInstance = this;
    }

    initDOM() {
        // Vertical
        this.vTrack = document.createElement('div');
        this.vTrack.className = 'os-scrollbar os-scrollbar-vertical';
        this.vThumb = document.createElement('div');
        this.vThumb.className = 'os-thumb';
        this.vTrack.appendChild(this.vThumb);

        // Horizontal
        this.hTrack = document.createElement('div');
        this.hTrack.className = 'os-scrollbar os-scrollbar-horizontal';
        this.hThumb = document.createElement('div');
        this.hThumb.className = 'os-thumb';
        this.hTrack.appendChild(this.hThumb);

        this.host.appendChild(this.vTrack);
        this.host.appendChild(this.hTrack);
    }

    bindEvents() {
        // Sync scroll -> thumb position
        this.target.addEventListener('scroll', () => {
            this.updateThumbs();
            this.show();
        });

        // ResizeObserver -> update ratios
        this.observer = new ResizeObserver(() => this.update());
        this.observer.observe(this.target);
        this.observer.observe(this.host);

        // Content Change -> update ratios
        // 监听 input 事件，确保内容变化时立即更新滚动条
        this.target.addEventListener('input', () => this.update());

        // Dragging Logic
        this.bindDrag(this.vThumb, 'y');
        this.bindDrag(this.hThumb, 'x');

        // Hover effects (auto hide logic could go here)
        this.host.addEventListener('mouseenter', () => this.show());
        this.host.addEventListener('mouseleave', () => this.scheduleHide());
    }

    bindDrag(thumb, axis) {
        let start = 0;
        let startScroll = 0;

        const onDown = (e) => {
            e.preventDefault();
            e.stopPropagation();
            thumb.classList.add('dragging');
            start = axis === 'y' ? e.clientY : e.clientX;
            startScroll = axis === 'y' ? this.target.scrollTop : this.target.scrollLeft;

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        };

        const onMove = (e) => {
            const current = axis === 'y' ? e.clientY : e.clientX;
            const delta = current - start;

            if (axis === 'y') {
                const ratio = this.target.scrollHeight / this.host.clientHeight;
                this.target.scrollTop = startScroll + delta * ratio;
            } else {
                const ratio = this.target.scrollWidth / this.host.clientWidth;
                this.target.scrollLeft = startScroll + delta * ratio;
            }
        };

        const onUp = () => {
            thumb.classList.remove('dragging');
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };

        thumb.addEventListener('mousedown', onDown);
    }

    update() {
        // Calculate dimensions and visibility
        const { scrollHeight, scrollWidth, clientHeight, clientWidth } = this.target;

        // Vertical
        const vRatio = clientHeight / scrollHeight;
        if (vRatio < 1) {
            this.vTrack.style.display = 'block';
            const thumbH = Math.max(20, clientHeight * vRatio);
            this.vThumb.style.height = `${thumbH}px`;
        } else {
            this.vTrack.style.display = 'none';
        }

        // Horizontal
        const hRatio = clientWidth / scrollWidth;
        if (hRatio < 1) {
            this.hTrack.style.display = 'block';
            const thumbW = Math.max(20, clientWidth * hRatio);
            this.hThumb.style.width = `${thumbW}px`;
        } else {
            this.hTrack.style.display = 'none';
        }

        this.updateThumbs();
    }

    updateThumbs() {
        const { scrollTop, scrollLeft, scrollHeight, scrollWidth, clientHeight, clientWidth } = this.target;

        // Vertical
        if (this.vTrack.style.display !== 'none') {
            const vRatio = clientHeight / scrollHeight;
            // Effective track height allows thumb to go from 0 to 100% within the track
            // Thumb top = scrollTop * (trackHeight / contentHeight) ?? 
            // Simplified: percentage scrolled
            const vPercent = scrollTop / (scrollHeight - clientHeight);
            const trackH = this.host.clientHeight - 4; // Padding
            const thumbH = parseFloat(this.vThumb.style.height);
            const availableSpace = trackH - thumbH;
            const top = Math.min(Math.max(0, vPercent * availableSpace), availableSpace);
            this.vThumb.style.transform = `translateY(${top}px)`;
        }

        // Horizontal
        if (this.hTrack.style.display !== 'none') {
            const hPercent = scrollLeft / (scrollWidth - clientWidth);
            const trackW = this.host.clientWidth - 4;
            const thumbW = parseFloat(this.hThumb.style.width);
            const availableSpace = trackW - thumbW;
            const left = Math.min(Math.max(0, hPercent * availableSpace), availableSpace);
            this.hThumb.style.transform = `translateX(${left}px)`;
        }
    }

    show() {
        this.vTrack.classList.add('active');
        this.hTrack.classList.add('active');
        this.scheduleHide();
    }

    scheduleHide() {
        if (this.hideTimer) clearTimeout(this.hideTimer);
        this.hideTimer = setTimeout(() => {
            // Only hide if not hovering host
            if (!this.host.matches(':hover') && !this.vThumb.classList.contains('dragging') && !this.hThumb.classList.contains('dragging')) {
                this.vTrack.classList.remove('active');
                this.hTrack.classList.remove('active');
            }
        }, 1000);
    }
}

// Init Global Scrollbars
function initCustomScrollbars() {
    // Main Scroll
    const mainScroll = document.querySelector('.main-scroll');
    const mainHost = document.querySelector('main'); // Use <main> as host
    if (mainScroll && mainHost) new OverlayScrollbar(mainScroll, mainHost);

    // Sidebar
    const navList = document.getElementById('nav-list');
    const aside = document.querySelector('aside');
    if (navList && aside) new OverlayScrollbar(navList, aside);
}

// 钩入 DOMContentLoaded
const originalOnLoad = window.onload; // 以防万一，虽然我们使用了 addEventListener
// We stick to the existing event listener
document.addEventListener("DOMContentLoaded", async () => {
    // ... 现有逻辑先运行 ...
    // 稍微延迟滚动条初始化以确保布局完成
    setTimeout(initCustomScrollbars, 100);
});

// --- 画布缩放和拖拽 ---
function initCanvasControls() {
    const container = document.getElementById('feed-container');

    // 每个 editor-flow 存储自己的缩放和平移状态
    const getFlowState = (flow) => {
        if (!flow._canvasState) {
            flow._canvasState = { scale: 1, panX: 0, panY: 0 };
        }
        return flow._canvasState;
    };

    const applyTransform = (flow) => {
        const state = getFlowState(flow);
        flow.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.scale})`;
    };

    // Ctrl + 滚轮缩放
    container.addEventListener('wheel', (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();

        const flow = e.target.closest('.editor-flow');
        if (!flow) return;

        const state = getFlowState(flow);
        const rect = flow.getBoundingClientRect();

        // 鼠标相对于 flow 的位置
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // 计算缩放 (使用互逆的系数 1.1)
        const factor = 1.1;
        const delta = e.deltaY > 0 ? (1 / factor) : factor;
        const oldScale = state.scale;
        const newScale = Math.min(11, Math.max(0.25, oldScale * delta));  //上限11倍，下限0.25倍
        // const newScale = Math.max(0.01, oldScale * delta); //无上限

        // 以鼠标位置为中心缩放
        const scaleRatio = newScale / oldScale;
        // 修正平移计算，防止漂移
        // 公式推导：NewPan = OldPan + MouseVector * (1 - Ratio)
        state.panX = state.panX + mouseX * (1 - scaleRatio);
        state.panY = state.panY + mouseY * (1 - scaleRatio);
        state.scale = newScale;

        applyTransform(flow);

        // 显示缩放指示样式
        flow.classList.add('dragging');
        window.isGlobalDragging = true;
        clearTimeout(flow._zoomTimer);
        flow._zoomTimer = setTimeout(() => {
            flow.classList.remove('dragging');
            window.isGlobalDragging = false;
        }, 200);
    }, { passive: false });

    // Ctrl + 拖拽平移
    let isPanning = false;
    let panFlow = null;
    let panStartX = 0, panStartY = 0;
    let panInitX = 0, panInitY = 0;

    container.addEventListener('mousedown', (e) => {
        if (!e.ctrlKey || e.button !== 0) return;

        // 确保点击的是空白区域（editor-flow 本身或 post）
        const flow = e.target.closest('.editor-flow');
        if (!flow) return;

        // 如果点击的是 block 内部，只要按住了 Ctrl 也可以拖拽画布
        // if (e.target.closest('.block')) return; // Removed restriction

        e.preventDefault();
        isPanning = true;
        panFlow = flow;
        panStartX = e.clientX;
        panStartY = e.clientY;
        const state = getFlowState(flow);
        panInitX = state.panX;
        panInitY = state.panY;

        flow.style.cursor = 'grabbing';
        flow.classList.add('dragging');
        window.isGlobalDragging = true;
    });

    document.addEventListener('mousemove', (e) => {
        if (!isPanning || !panFlow) return;

        const dx = e.clientX - panStartX;
        const dy = e.clientY - panStartY;

        const state = getFlowState(panFlow);
        state.panX = panInitX + dx;
        state.panY = panInitY + dy;

        applyTransform(panFlow);
    });

    document.addEventListener('mouseup', () => {
        if (isPanning && panFlow) {
            panFlow.style.cursor = '';
            panFlow.classList.remove('dragging');
            window.isGlobalDragging = false;
        }
        isPanning = false;
        panFlow = null;
    });

    // 双击重置缩放和平移
    container.addEventListener('dblclick', (e) => {
        if (!e.ctrlKey) return;

        const flow = e.target.closest('.editor-flow');
        if (!flow || e.target.closest('.block')) return;

        const state = getFlowState(flow);
        state.scale = 1;
        state.panX = 0;
        state.panY = 0;
        applyTransform(flow);
    });
}

// --- 框选功能 ---
let selectedBlocks = new Set();

function initSelectionBox() {
    const container = document.getElementById('feed-container');

    let isSelecting = false;
    let selectionBox = null;
    let selectionFlow = null;
    let startX = 0, startY = 0;

    // 在空白处按下开始框选
    container.addEventListener('mousedown', (e) => {
        // Ctrl 键按下时是画布拖拽，不启用框选
        if (e.ctrlKey || e.button !== 0) return;

        const mainFlow = e.target.closest('.editor-flow');
        if (!mainFlow) return;

        const clickedBlock = e.target.closest('.block');
        let targetContainer = mainFlow;
        let isFolderBack = false;

        // 如果点击的是块内部
        if (clickedBlock) {
            // 特殊处理：如果是文件夹块，判定是否点击的是背景
            if (clickedBlock.classList.contains('block-folder')) {
                // 如果没有点击到具体的交互控件（手柄、侧边栏、删除按钮）
                // 且没有点击到文件夹内部的子块（也就是 clickedBlock 就是文件夹本身，说明点的空隙）
                if (!e.target.closest('.block-handle') &&
                    !e.target.closest('.resize-handle') &&
                    !e.target.closest('.resize-handle-right') &&
                    !e.target.closest('.folder-sidebar') &&
                    !e.target.closest('.block-del')) {

                    isFolderBack = true;
                    targetContainer = clickedBlock.querySelector('.folder-inner-container');

                    // 清除之前的选中
                    clearSelection();
                }
            }

            if (!isFolderBack) {
                // 如果是普通块或文件夹的控件，或者是文件夹内的子块（但没被上方逻辑捕获，意味着 clickedBlock 会是子块）
                // 此时 clickedBlock 是最近的块。如果 clickedBlock 是子块，它不是 block-folder (或者嵌套？假设不嵌套)
                // 总之，如果点击了具体的块元素进行交互/拖拽，则不触发框选

                // 如果点击的块未被选中，仅单选它 (在 makeDraggable 里处理了，这里只需确保不触发框选)
                // 现有的逻辑是：点击块不触发框选，但如果还没选中，可能需要清除其他。
                if (!clickedBlock.classList.contains('selected')) {
                    clearSelection();
                }
                return;
            }
        } else {
            // 点击空白处，清除选中
            clearSelection();
        }

        // 确保如果有文本框处于焦点，点击空白处时失去焦点
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
            document.activeElement.blur();
        }

        e.preventDefault();
        isSelecting = true;
        selectionFlow = targetContainer;

        // 获取全局缩放比例 (总是基于 editor-flow)
        const state = mainFlow._canvasState || { scale: 1, panX: 0, panY: 0 };
        const scale = state.scale;

        // 通用坐标计算：
        // 目标是获取相对于 selectionFlow 左上角的未缩放坐标 (CSS pixels)
        // 鼠标屏幕坐标 = e.clientX
        // 容器屏幕坐标 = rect.left
        // 差值 (屏幕像素) = (e.clientX - rect.left)
        // CSS像素 = 差值 / scale (因为 selectionFlow 被 scale 影响)

        const rect = selectionFlow.getBoundingClientRect();
        startX = (e.clientX - rect.left) / scale;
        startY = (e.clientY - rect.top) / scale;

        // 创建选框元素
        selectionBox = document.createElement('div');
        selectionBox.className = 'selection-box active';
        selectionBox.style.left = startX + 'px';
        selectionBox.style.top = startY + 'px';
        selectionBox.style.width = '0';
        selectionBox.style.height = '0';
        selectionFlow.appendChild(selectionBox);

        window.isGlobalDragging = true;
    });

    document.addEventListener('mousemove', (e) => {
        if (!isSelecting || !selectionBox || !selectionFlow) return;

        // 重新获取缩放比例
        const mainFlow = selectionFlow.closest('.editor-flow');
        const state = mainFlow ? (mainFlow._canvasState || { scale: 1 }) : { scale: 1 };
        const scale = state.scale;

        const rect = selectionFlow.getBoundingClientRect();
        const currentX = (e.clientX - rect.left) / scale;
        const currentY = (e.clientY - rect.top) / scale;

        const left = Math.min(startX, currentX);
        const top = Math.min(startY, currentY);
        const width = Math.abs(currentX - startX);
        const height = Math.abs(currentY - startY);

        selectionBox.style.left = left + 'px';
        selectionBox.style.top = top + 'px';
        selectionBox.style.width = width + 'px';
        selectionBox.style.height = height + 'px';

        // 实时高亮被框选的块
        const selRect = {
            left: left,
            top: top,
            right: left + width,
            bottom: top + height
        };

        // 仅在当前 selectionFlow 下查找直接子块
        // (folder-inner-container 或 editor-flow 的直接子 block)
        Array.from(selectionFlow.children).forEach(block => {
            if (!block.classList.contains('block')) return;

            // 忽略 selectionBox 自身

            // FIX: 使用 getBoundingClientRect 以支持 transform 定位 (文件夹内部使用的是 transform)
            const bRect = block.getBoundingClientRect();

            // 计算相对于容器的坐标 (Unscaled CSS pixel)
            // rect 是 selectionFlow 的 rect
            const bLeft = (bRect.left - rect.left) / scale;
            const bTop = (bRect.top - rect.top) / scale;
            const bWidth = bRect.width / scale;
            const bHeight = bRect.height / scale;

            const bRight = bLeft + bWidth;
            const bBottom = bTop + bHeight;

            // 检测是否相交
            const intersects = !(
                bRight < selRect.left ||
                bLeft > selRect.right ||
                bBottom < selRect.top ||
                bTop > selRect.bottom
            );

            if (intersects) {
                block.classList.add('selected');
            } else {
                block.classList.remove('selected');
            }
        });
    });

    document.addEventListener('mouseup', () => {
        if (isSelecting && selectionBox) {
            // 收集所有选中的块
            selectionFlow.querySelectorAll('.block.selected').forEach(block => {
                selectedBlocks.add(block);
            });

            selectionBox.remove();
            selectionBox = null;
            isSelecting = false;
            // selectionFlow = null; // 保持 clean
            window.isGlobalDragging = false;
        }
    });

    // 键盘事件：ESC清除，Delete删除
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            clearSelection();
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedBlocks.size > 0) {
            // 只有当不是在输入框中按删除键时才触发
            const activeTag = document.activeElement.tagName.toLowerCase();
            if (activeTag === 'input' || activeTag === 'textarea' || document.activeElement.isContentEditable) {
                return;
            }

            e.preventDefault();

            // 寻找任意一个被选中的块，以确定 post 和 flow
            const firstBlock = selectedBlocks.values().next().value;
            if (!firstBlock) return;

            // 这里的 flow 可能是 editor-flow 也可能是 folder-inner
            // 如果是 folder-inner，我们需要通知 folder updateHeight
            const parent = firstBlock.parentElement;
            const isFolderInner = parent.classList.contains('folder-inner-container');
            const flow = firstBlock.closest('.editor-flow');
            const post = flow.closest('.post');

            const count = selectedBlocks.size;

            // 确认回调
            const doDelete = async () => {
                const blocksToDelete = Array.from(selectedBlocks);

                // 清除选中状态以防出错
                clearSelection();

                for (const block of blocksToDelete) {
                    // 如果是媒体块，删除本地文件
                    if (block.dataset.src && block.dataset.src.includes('uploads')) {
                        try {
                            const localPath = convertToLocalPath(block.dataset.src);
                            await invoke('delete_media_file', { path: localPath });
                        } catch (err) { console.warn('删除媒体文件失败', err); }
                    }
                    block.remove();
                }

                if (isFolderInner) {
                    // 如果是在文件夹内删除，重新计算文件夹布局和高度
                    // parent 是 folder-inner-container
                    // parent.parentElement 是 block-folder
                    const folderBlock = parent.parentElement;
                    const w = parseInt(folderBlock.style.width) || folderBlock.offsetWidth;
                    const h = parseInt(folderBlock.style.height) || folderBlock.offsetHeight;

                    // 触发布局重排
                    const newH = reflowFolderContent(folderBlock, w, h);
                    if (newH) {
                        folderBlock.style.height = newH + 'px';
                        // 外部容器也需要更新
                        // flow needs update if folder height changed
                        if (flow) updateContainerHeight(flow);
                    }
                } else if (flow) {
                    // 重新计算主容器高度
                    updateContainerHeight(flow);
                }

                if (post) scheduleSave(post);
            };

            showConfirm(`确定要删除选中的 ${count} 个块吗？`, window.innerWidth / 2, window.innerHeight / 2, doDelete);
        }
    });
}

function clearSelection() {
    selectedBlocks.forEach(block => {
        block.classList.remove('selected');
    });
    selectedBlocks.clear();
}

function getSelectedBlocks() {
    return selectedBlocks;
}

// --- 视频性能优化 ---
let visibleVideos = new Set();
let lastMouseX = 0, lastMouseY = 0;
let speedUpdateRaf = null;

// function updateVideoSpeeds() {
//     if (visibleVideos.size === 0) return;

//     visibleVideos.forEach(video => {
//         // 如果用户手动调整了速度，则跳过自动优化
//         if (video.dataset.manualSpeed === 'true') return;

//         const rect = video.getBoundingClientRect();
//         // 计算视频中心点
//         const centerX = rect.left + rect.width / 2;
//         const centerY = rect.top + rect.height / 2;

//         // 计算到鼠标的距离
//         const dist = Math.sqrt(
//             Math.pow(centerX - lastMouseX, 2) +
//             Math.pow(centerY - lastMouseY, 2)
//         );

//         // 距离策略：
//         // 0-300px: 1.0x
//         // 300px-1200px: 线性衰减到 0.2x
//         // >1200px: 0.2x

//         let rate = 1.0;
//         if (dist <= 300) {
//             rate = 1.0;
//         } else if (dist >= 1200) {
//             rate = 0.2;
//         } else {
//             // 线性插值
//             // progress 0 (at 300) -> 1 (at 1200)
//             const progress = (dist - 300) / (1200 - 300);
//             rate = 1.0 - progress * (1.0 - 0.2);
//         }

//         // 只有当变化显著时才应用，避免过于频繁的 IPC 调用（虽然 playbackRate 主要是前端属性）
//         if (Math.abs(video.playbackRate - rate) > 0.05) {
//             video.playbackRate = rate;
//         }
//     });
// }

// 监听鼠标移动以更新速度
document.addEventListener('mousemove', (e) => {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;

    if (!speedUpdateRaf) {
        speedUpdateRaf = requestAnimationFrame(() => {
            // updateVideoSpeeds();
            speedUpdateRaf = null;
        });
    }
});

// 视频观察器引用
let preloadObserver = null;
let playbackObserver = null;

function initVideoOptimization() {
    // 1. 预加载观察器 (Preload Observer)
    // 负责在视口附近 1000px 范围内加载/卸载资源 (src)
    preloadObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const video = entry.target;
            if (entry.isIntersecting) {
                // 进入预加载区域：加载 src
                if (!video.src && video.dataset.src) {
                    video.src = video.dataset.src;
                    video.load();
                    // 恢复倍速
                    const folder = video.closest('.block-folder');
                    if (folder && folder.dataset.playbackSpeed) {
                        video.playbackRate = parseFloat(folder.dataset.playbackSpeed);
                    }
                }
            } else {
                // 彻底离开预加载区域：卸载 src (释放 GPU 资源)
                // 只有当视频真的离开很远时才执行，避免频繁加载
                // 注意：由于 playbackObserver 也会控制播放，这里只需关注资源
                video.pause(); // 确保暂停
                if (video.src) {
                    video.removeAttribute('src');
                    video.load(); // 释放资源
                }
            }
        });
    }, {
        root: document.querySelector('.main-scroll'),
        rootMargin: '200px 0px 200px 0px', // 预加载范围 (Tightened for performance)
        threshold: 0.01
    });

    // 2. 播放控制观察器 (Playback Observer)
    // 严格负责视口内的播放/暂停
    playbackObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const video = entry.target;
            if (entry.isIntersecting) {
                visibleVideos.add(video);

                // 进入视口：播放
                // 确保 src 已加载 (防止 preloadObserver 尚未触发的竞态)
                if (!video.src && video.dataset.src) {
                    video.src = video.dataset.src;
                    video.load();
                    // 恢复倍速
                    const folder = video.closest('.block-folder');
                    if (folder && folder.dataset.playbackSpeed) {
                        video.playbackRate = parseFloat(folder.dataset.playbackSpeed);
                    }
                }

                const playPromise = video.play();
                if (playPromise !== undefined) {
                    playPromise.catch(() => { });
                }
            } else {
                visibleVideos.delete(video);

                // 离开视口：立即暂停
                video.pause();

                // 如果未静音，离开视口时强制静音
                // 这样下次进入时不会突然有声音
                if (!video.muted) {
                    video.muted = true;
                    video.dataset.initialState = 'true';
                    // Update Mute Button UI
                    const bucket = video.closest('.video-wrapper');
                    if (bucket) {
                        const btn = bucket.querySelector('.video-mute-btn');
                        if (btn) btn.textContent = '🔇';
                    }
                }
            }
        });
    }, {
        root: document.querySelector('.main-scroll'),
        rootMargin: '0px', // 严格视口
        threshold: 0.3 // 至少 30% 可见才播放
    });



    // 视频控件自动隐藏逻辑

    // 1. 进入视频区域：显示控件并启动计时器
    document.addEventListener('mouseover', (e) => {
        const wrapper = e.target.closest('.video-wrapper');
        if (!wrapper) return;

        // 确保是从外部进入
        if (!e.relatedTarget || !wrapper.contains(e.relatedTarget)) {
            const controls = wrapper.querySelector('.video-controls');
            if (controls) {
                controls.style.opacity = '1';
                controls.style.pointerEvents = 'auto'; // 允许点击

                if (wrapper._hideTimer) clearTimeout(wrapper._hideTimer);
                wrapper._hideTimer = setTimeout(() => {
                    controls.style.opacity = '0';
                    controls.style.pointerEvents = 'none';
                    wrapper._hideTimer = null;
                }, 2000);
            }
        }
    }, true);

    // 2. 在视频内移动：区域检测
    document.addEventListener('mousemove', (e) => {
        const wrapper = e.target.closest('.video-wrapper');
        if (!wrapper) return;

        const controls = wrapper.querySelector('.video-controls');
        if (!controls) return;

        // 检测底部区域 (控件区域)
        const rect = wrapper.getBoundingClientRect();
        const bottomThreshold = 45; // 控件高度 + 缓冲
        const inBottomArea = (e.clientY >= rect.bottom - bottomThreshold);
        const onControls = e.target.closest('.video-controls'); // 如果 visible

        if (inBottomArea || onControls) {
            // 在控件区域：显示并保持
            controls.style.opacity = '1';
            controls.style.pointerEvents = 'auto';
            if (wrapper._hideTimer) {
                clearTimeout(wrapper._hideTimer);
                wrapper._hideTimer = null;
            }
        } else {
            // 在上方视频区域
            // 只有当前是显示状态时，才重置计时器
            // 如果已经隐藏，移动鼠标不会触发显示（符合用户要求）
            if (controls.style.opacity === '1') {
                if (wrapper._hideTimer) clearTimeout(wrapper._hideTimer);
                wrapper._hideTimer = setTimeout(() => {
                    controls.style.opacity = '0';
                    controls.style.pointerEvents = 'none';
                    wrapper._hideTimer = null;
                }, 500);
            }
        }
    });

    // 3. 离开视频区域：立即隐藏
    document.addEventListener('mouseout', (e) => {
        const wrapper = e.target.closest('.video-wrapper');
        // 检查是否真的离开 wrapper
        if (wrapper && (!e.relatedTarget || !wrapper.contains(e.relatedTarget))) {
            const controls = wrapper.querySelector('.video-controls');
            if (controls) {
                if (wrapper._hideTimer) clearTimeout(wrapper._hideTimer);
                wrapper._hideTimer = null;
                controls.style.opacity = '0';
                controls.style.pointerEvents = 'none';
            }
        }
    }, true);
}
