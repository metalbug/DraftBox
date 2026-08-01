/**
 * 帖子管理模块
 * @module posts
 */

import { invoke, convertFileSrc as convertLocalPath, convertToLocalPath } from './utils.js';
import { showConfirm } from './ui-components.js';
import { t } from './i18n.js';

const marked = window.marked || null; // 如果你是通过 CDN 引入的 marked，保留这行即可

let allPosts = [];
let nextId = 1;
let virtualizationObserver = null;

// 💡 新增：追踪当前活跃（被点击/亮起）的帖子ID
let activePostId = null;

// 💡 新增：日期格式化工具函数
const formatDate = (timestamp) => {
    return new Date(timestamp).toLocaleString('zh-CN', {
        year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric'
    });
};

let renderBlockRef = null;
let updateContainerHeightRef = null;
let reflowFolderContentRef = null;
let renderSidebarRef = null;
let renderTagCloudRef = null;
let addBlockRef = null;
let observeVideoRef = null;
let unobserveVideoRef = null;

let onAddBlockRef = null;
let onUploadRef = null;
let onAddSmartBlockRef = null;
let onMapFolderRef = null;

export function initPostsModule(handlers = {}) {
    renderBlockRef = handlers.renderBlock;
    updateContainerHeightRef = handlers.updateContainerHeight;
    reflowFolderContentRef = handlers.reflowFolderContent;
    renderSidebarRef = handlers.renderSidebar;
    renderTagCloudRef = handlers.renderTagCloud;
    addBlockRef = handlers.addBlock;
    observeVideoRef = handlers.observeVideo;
    unobserveVideoRef = handlers.unobserveVideo;

    onAddBlockRef = handlers.onAddBlock;
    onUploadRef = handlers.onUpload;
    onAddSmartBlockRef = handlers.onAddSmartBlock;
    onMapFolderRef = handlers.onMapFolder;
}

export function getAllPosts() { return allPosts; }
export function setAllPosts(posts) { allPosts = posts; }

function getFirstBlockText(storyJson) {
    try {
        const blocks = JSON.parse(storyJson || '[]');
        for (const b of blocks) {
            if (b.type === 'text' && b.content) return b.content.slice(0, 100);
            if (b.children) {
                for (const c of b.children) {
                    if (c.type === 'text' && c.content) return c.content.slice(0, 100);
                }
            }
        }
    } catch { }
    return '';
}

export async function loadPosts() {
    try {
        // 💡 启动时探测当前程序运行的绝对路径，作为本地渲染基底
        window.__BASE_DIR__ = await invoke('get_base_dir');
        const posts = await invoke("get_posts");
        allPosts = (posts || []).sort((a, b) => b.created_at - a.created_at);
        renderFeed(allPosts);
        renderSidebarRef?.(allPosts);
        renderTagCloudRef?.(allPosts);
    } catch (e) {
        console.error("加载帖子失败", e);
    }
}

export function renderFeed(posts) {
    const container = document.getElementById('feed-container');
    if (!container) return;
    container.innerHTML = '';
    posts.forEach(post => {
        container.appendChild(createPostElement(post));
    });
}

// ================= 统一事件绑定器 =================
function bindPostEvents(card) {
    const titleLabel = card.querySelector(".post-title-label");
    // 💡 必须接收鼠标事件参数 e
    const startEditing = (e) => {
        if (titleLabel.classList.contains('editing')) return;

        const currentTitle = card._postData?.title || "";
        let clickIndex = currentTitle.length; // 兜底：默认末尾

        // 💡 致命修复 1：利用点击时的几何坐标 (X, Y)，强行穿透计算对应的文字索引！
        if (e) {
            try {
                let textNode = null;
                let offset = -1;

                // Chrome / Edge / Safari 等现代浏览器 API
                if (document.caretRangeFromPoint) {
                    const range = document.caretRangeFromPoint(e.clientX, e.clientY);
                    if (range) { textNode = range.startContainer; offset = range.startOffset; }
                }
                // Firefox 备用 API
                else if (document.caretPositionFromPoint) {
                    const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
                    if (pos) { textNode = pos.offsetNode; offset = pos.offset; }
                }

                // 确保点中的是咱们标题里的文字节点
                if (textNode && textNode.nodeType === 3 && titleLabel.contains(textNode)) {
                    // 💡 致命修复：智能剔除 DOM 节点中因为代码格式化产生的隐藏换行和缩进符！
                    const leadingWhitespace = textNode.nodeValue.match(/^\s+/);
                    const spaceCount = leadingWhitespace ? leadingWhitespace[0].length : 0;
                    clickIndex = Math.max(0, offset - spaceCount);
                }
            } catch (err) { }
        }

        setActivePost(card);
        titleLabel.classList.add('editing');
        const input = document.createElement("input");
        input.type = "text";
        input.className = "post-title-input";
        input.value = currentTitle;
        input.placeholder = formatDate(card._postData?.created_at || Date.now());

        const autoResize = () => {
            const measure = document.createElement('span');
            const compStyle = window.getComputedStyle(input);
            measure.style.cssText = `visibility:hidden;position:absolute;white-space:pre;font-size:${compStyle.fontSize};font-weight:${compStyle.fontWeight};font-family:${compStyle.fontFamily};`;
            measure.textContent = input.value || input.placeholder;
            document.body.appendChild(measure);

            const maxWidth = (card.offsetWidth || 800) - 30;
            input.style.width = Math.min(Math.max(150, measure.offsetWidth + 10), maxWidth) + 'px';
            measure.remove();
        };

        input.addEventListener('input', autoResize);

        titleLabel.innerHTML = "";
        titleLabel.appendChild(input);

        autoResize();
        input.focus();

        // 💡 致命修复 2：将光标精准投放到刚才几何计算出的位置！
        input.setSelectionRange(clickIndex, clickIndex);

        const finishEditing = async () => {
            const newTitle = input.value.trim();
            if (card._postData) card._postData.title = newTitle;
            titleLabel.classList.remove('editing');
            titleLabel.innerText = newTitle || formatDate(card._postData?.created_at || Date.now());
            await savePost(card);
        };
        input.onblur = finishEditing;
        input.onkeydown = (event) => {
            if (event.key === 'Enter') finishEditing();
            if (event.key === 'Escape') {
                input.value = currentTitle;
                finishEditing();
            }
        };
    };

    // 💡 确保将点击事件 e 传递给函数
    titleLabel.onclick = (e) => { e.stopPropagation(); startEditing(e); };

    const delBtn = card.querySelector('.post-del-btn');
    if (delBtn) delBtn.onclick = (e) => confirmDeletePost(card, e);

    // card.onclick = (e) => {
    //     if (e.target.closest('.post-controls, .post-title-label')) return;
    //     setActivePost(card);
    // };

    // 💡 核心：绑定控制面板上的操作按钮
    card.querySelectorAll('.post-action-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            setActivePost(card);

            if (!card.classList.contains('mounted') && typeof mountPostContent === 'function') {
                mountPostContent(card);
            }
            const flow = card.querySelector('.editor-flow');
            if (!flow) return;

            const action = btn.dataset.action;
            if (action === 'text' || action === 'h5') {
                onAddBlockRef?.(action, flow, card);
            } else if (action === 'upload') {
                onUploadRef?.(flow, card);
            } else if (action === 'map-folder') {
                onMapFolderRef?.(card);
            } else if (action === 'link') {
                const popover = document.getElementById('link-input-popover');
                const input = document.getElementById('link-input');
                if (!popover || !input) return;

                const rect = btn.getBoundingClientRect();
                popover.style.top = (rect.bottom + 10) + 'px';
                let left = rect.left - 150;
                if (left + 320 > window.innerWidth) left = window.innerWidth - 330;
                popover.style.left = left + 'px';
                popover.classList.add('active');
                input.value = '';
                input.focus();

                popover._targetCard = card;
                popover._targetFlow = flow;
            }
        };
    });
}

// 💡 注册全局的外链弹窗回车提交逻辑
document.addEventListener('DOMContentLoaded', () => {
    const popover = document.getElementById('link-input-popover');
    const ok = document.getElementById('link-input-ok');
    const input = document.getElementById('link-input');
    if (!popover) return;

    const submit = async () => {
        const val = input?.value.trim();
        if (val && popover._targetFlow && popover._targetCard) {
            await onAddSmartBlockRef?.(popover._targetFlow, val, popover._targetCard);
        }
        popover.classList.remove('active');
    };

    ok?.addEventListener('click', submit);
    input?.addEventListener('keydown', e => {
        if (e.key === 'Enter') submit();
        if (e.key === 'Escape') popover.classList.remove('active');
    });
    document.addEventListener('mousedown', e => {
        if (popover.classList.contains('active') && !popover.contains(e.target) && !e.target.closest('[data-action="link"]')) {
            popover.classList.remove('active');
        }
    });
});

export function createPostElement(post) {
    const card = document.createElement('div');
    card.className = 'post';
    card.dataset.id = post.id;
    if (post.isNew) card.classList.add('is-new');
    card._postData = post;

    card.innerHTML = `
        <div class="post-title-label" title="${t('click_edit_title')}" data-i18n-title="click_edit_title">${post.title || formatDate(post.created_at)}</div>
        <div class="post-controls">
            <button class="post-action-btn" data-action="text" title="${t('add_text')}" data-i18n-title="add_text">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line></svg>
            </button>
            <button class="post-action-btn" data-action="h5" title="${t('add_html')}" data-i18n-title="add_html">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
            </button>
            <button class="post-action-btn" data-action="link" title="${t('embed_link')}" data-i18n-title="embed_link">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
            </button>
            <button class="post-action-btn" data-action="upload" title="${t('upload_media')}" data-i18n-title="upload_media">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            </button>
            <button class="post-action-btn" data-action="map-folder" title="${t('map_folder')}" data-i18n-title="map_folder">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
            </button>
            <button class="post-del-btn" title="${t('delete_post_title')}" data-i18n-title="delete_post_title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        </div>
    `;
    bindPostEvents(card);

    let initialHeight = 400;
    try {
        const blocks = JSON.parse(post.story || '[]');
        let maxBottom = 0;
        blocks.forEach(b => { maxBottom = Math.max(maxBottom, (b.y || 0) + (b.h || 200)); });
        if (maxBottom > 0) initialHeight = maxBottom + 100;
    } catch (e) { }

    card.style.minHeight = initialHeight + 'px';
    virtualizationObserver?.observe(card);
    return card;
}

export function createAndInsertPost(id) {
    if (id === undefined) allPosts.forEach(p => { if (p.id >= nextId) nextId = p.id + 1; });
    const realId = id ?? nextId;
    if (id === undefined) nextId++;

    const isNew = id === undefined;
    const postData = { id: realId, title: '', tags: '', story: '[]', html: '', css: '', js: '', created_at: Date.now() };

    const el = document.createElement("article");
    el.className = `post is-new mounted ${isNew ? "newly-created" : ""}`;
    el.dataset.id = realId;
    el._postData = postData;
    el.innerHTML = `
        <div class="post-title-label" title="${t('click_edit_title')}" data-i18n-title="click_edit_title">${postData.title || formatDate(postData.created_at)}</div>
        <div class="post-controls">
            <button class="post-action-btn" data-action="text" title="${t('add_text')}" data-i18n-title="add_text">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line></svg>
            </button>
            <button class="post-action-btn" data-action="h5" title="${t('add_html')}" data-i18n-title="add_html">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
            </button>
            <button class="post-action-btn" data-action="link" title="${t('embed_link')}" data-i18n-title="embed_link">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
            </button>
            <button class="post-action-btn" data-action="upload" title="${t('upload_media')}" data-i18n-title="upload_media">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            </button>
            <button class="post-action-btn" data-action="map-folder" title="${t('map_folder')}" data-i18n-title="map_folder">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
            </button>
            <button class="post-del-btn" title="${t('delete_post_title')}" data-i18n-title="delete_post_title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        </div>
        <div class="editor-flow"></div>
    `;

    bindPostEvents(el);

    if (isNew) {
        setActivePost(el);
        const container = document.getElementById('feed-container');
        if (container) container.insertBefore(el, container.firstChild);
    }

    const flow = el.querySelector('.editor-flow');
    if (isNew) {
        requestAnimationFrame(() => {
            flow.dispatchEvent(new Event('input', { bubbles: true }));
            if (typeof renderSidebarRef === 'function') renderSidebarRef(allPosts);
        });
    }

    setTimeout(() => {
        if (isNew) window.scrollTo({ top: 0, behavior: 'smooth' });
        else virtualizationObserver?.observe(el);
    }, 50);

    return { el, postData, flow };
}

export function createNewPost() {
    const { el, flow } = createAndInsertPost();
    addBlockRef?.(flow, 'text', '', el);
}

export async function mapFolderToPost(targetPost = null, addFolderBlock) {
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
        await addFolderBlock?.(flow, files, card, null);
    } catch (e) { console.error('映射文件夹失败', e); }
}

export function confirmDeletePost(card, event) {
    if (!card) return;
    const cb = async () => {
        try {
            virtualizationObserver?.unobserve(card);
            card._isDeleting = true;
            const id = parseInt(card.dataset.id);
            if (isNaN(id)) throw new Error("ID 格式错误");

            // 💡 变为软删除，媒体文件交由回收站最终决定生死
            await invoke("delete_post", { id });

            card.style.opacity = '0';
            setTimeout(() => card.remove(), 300);
            allPosts = allPosts.filter(p => p.id !== id);
            renderSidebarRef?.(allPosts);
        } catch (e) { console.error(e); alert("移入回收站失败"); }
    };
    const x = event?.clientX ?? window.innerWidth / 2;
    const y = event?.clientY ?? window.innerHeight / 2;
    showConfirm("确定要将这篇文章移入回收站吗？", x, y, cb);
}

// ==================== 回收站面板引擎 (混合列表版) ====================
export function initTrashUI() {
    const trashBtn = document.getElementById('btn-trash');
    const trashModal = document.getElementById('trash-modal');
    if (!trashBtn || !trashModal) return;

    const extractPaths = (blocksStr) => {
        const paths = [];
        try {
            const parseAndExtract = (list) => {
                list.forEach(b => {
                    if (b.src && b.src.includes('uploads')) paths.push(b.src);
                    if (b.children) parseAndExtract(b.children);
                });
            };
            parseAndExtract(JSON.parse(blocksStr || '[]'));
        } catch (e) { }
        return paths;
    };

    const loadTrash = async () => {
        const list = document.getElementById('trash-list');
        list.innerHTML = '<div style="text-align:center;padding:20px;color:#888;">加载中...</div>';
        try {
            // 并发拉取被删的帖子和被删的块
            const [posts, blocks] = await Promise.all([
                invoke('get_trashed_posts'),
                invoke('get_trashed_blocks')
            ]);

            // 格式化帖子数据
            const formattedPosts = posts.map(p => ({
                isPost: true,
                id: p.id,
                title: p.title || (p.story.substring(0, 30).replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '') || '无标题记录'),
                timestamp: p.created_at,
                data: p,
                typeDesc: '帖子'
            }));

            // 格式化块数据
            const formattedBlocks = blocks.map(b => {
                let typeDesc = "组件块";
                try {
                    const data = JSON.parse(b.data);
                    typeDesc = data.type === 'text' ? '便签' : data.type === 'img' ? '图片' : data.type === 'video' ? '视频' : data.type === 'folder' ? '文件夹' : '组件';
                } catch (e) { }
                return {
                    isPost: false,
                    id: b.id,
                    title: `来自文章 #${b.post_id}`,
                    timestamp: b.deleted_at * 1000,
                    data: b,
                    typeDesc: typeDesc
                };
            });

            // 混合数组并按时间倒序排列
            const allTrash = [...formattedPosts, ...formattedBlocks].sort((a, b) => b.timestamp - a.timestamp);

            list.innerHTML = allTrash.length ? '' : '<div style="text-align:center;padding:20px;color:#888;">回收站为空</div>';

            // 统一渲染列表
            allTrash.forEach(item => {
                const div = document.createElement('div');
                div.className = 'trash-item';
                const dateStr = new Date(item.timestamp).toLocaleString();

                // 帖子用蓝色标签，块用绿色标签
                const typeColor = item.isPost ? '#3b82f6' : '#10b981';

                div.innerHTML = `
                    <div class="trash-item-info">
                        <strong><span style="color:${typeColor};margin-right:6px;">[${item.typeDesc}]</span>${item.title}</strong>
                        <span>时间：${dateStr}</span>
                    </div>
                    <div class="trash-item-btns">
                        <button class="btn-restore">${item.isPost ? '恢复' : '提取'}</button>
                        <button class="btn-delete">粉碎</button>
                    </div>
                `;

                // 恢复/提取 逻辑分流
                div.querySelector('.btn-restore').onclick = async () => {
                    if (item.isPost) {
                        await invoke('restore_post', { id: item.id });
                        loadTrash();
                        if (typeof loadPosts === 'function') loadPosts();
                    } else {
                        try {
                            // 💡 步骤 1：智能获取目标帖子。
                            // 【致命重构】：优先使用我们精准绑定的活跃帖子 ID！
                            let targetCard = null;
                            if (activePostId) {
                                targetCard = document.querySelector(`.post[data-id="${activePostId}"]`);
                            }

                            // 兜底：如果没拿到，获取侧边栏高亮的、或者屏幕内显示的帖子
                            if (!targetCard) {
                                const activeNav = document.querySelector('#nav-list .nav-item.active');
                                if (activeNav && activeNav.dataset.postId) {
                                    targetCard = document.querySelector(`.post[data-id="${activeNav.dataset.postId}"]`);
                                }
                            }

                            // 再兜底：从屏幕内获取显示显示的第一个帖子（保持之前的逻辑）
                            if (!targetCard) {
                                const mountedPosts = Array.from(document.querySelectorAll('.post.mounted'));
                                targetCard = mountedPosts.find(p => {
                                    const r = p.getBoundingClientRect();
                                    return r.top < window.innerHeight && r.bottom > 0;
                                }) || mountedPosts[0] || document.querySelector('.post');
                            }

                            // 再兜底：连帖子都没有就新建（保持之前的逻辑）
                            if (!targetCard && typeof createAndInsertPost === 'function') {
                                targetCard = createAndInsertPost().el;
                            }
                            if (!targetCard) throw new Error("无法定位目标帖子");

                            // 💡 步骤 2：安全防护！如果目标帖子被滚动优化卸载了，强制重新挂载它 (保持之前的逻辑)
                            if (!targetCard.classList.contains('mounted') && typeof mountPostContent === 'function') {
                                mountPostContent(targetCard);
                            }

                            const flow = targetCard.querySelector('.editor-flow');
                            if (!flow) throw new Error("编辑器画布未就绪");

                            // 💡 步骤 3：确认画布 100% 安全可用后，再去后端销毁回收站记录，杜绝数据丢失！
                            const blockData = JSON.parse(await invoke('restore_block', { id: item.id }));

                            // 步骤 4：执行渲染
                            blockData.x = (blockData.x || 20) + 30;
                            blockData.y = (blockData.y || 60) + 30;

                            if (typeof renderBlockRef === 'function') {
                                renderBlockRef(flow, blockData, targetCard, null);
                                flow.dispatchEvent(new Event('input', { bubbles: true }));

                                // 丝滑滚动到提取的位置
                                targetCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                                setTimeout(() => {
                                    const newBlock = flow.lastElementChild;
                                    if (newBlock) newBlock.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                }, 50);
                            }

                            loadTrash();
                            trashModal.classList.remove('active');
                        } catch (err) {
                            console.error(err);
                            alert("提取失败：未能定位到可用画布。请重试。");
                        }
                    }
                };

                // 粉碎逻辑分流
                div.querySelector('.btn-delete').onclick = async () => {
                    if (item.isPost) {
                        if (confirm('危险：彻底删除后相关的图片/视频也将从硬盘物理抹除，无法撤销！')) {
                            await invoke('hard_delete_post', { id: item.id, attachments: extractPaths(item.data.story) });
                            loadTrash();
                        }
                    } else {
                        if (confirm('粉碎不可撤销！确定吗？')) {
                            await invoke('hard_delete_block', { id: item.id, attachments: extractPaths(`[${item.data.data}]`) });
                            loadTrash();
                        }
                    }
                };
                list.appendChild(div);
            });
        } catch (e) { list.innerHTML = '加载失败'; console.error(e); }
    };

    // 下拉菜单显示与定位
    trashBtn.onclick = (e) => {
        e.stopPropagation();
        const isActive = trashModal.classList.toggle('active');
        if (isActive) {
            const rect = trashBtn.getBoundingClientRect();
            let leftPos = rect.right - 380;
            if (leftPos < 10) leftPos = 10;
            trashModal.style.top = (rect.bottom + 10) + 'px';
            trashModal.style.left = leftPos + 'px';
            loadTrash();
        }
    };

    document.addEventListener('mousedown', (e) => {
        if (trashModal.classList.contains('active') && !trashModal.contains(e.target) && !trashBtn.contains(e.target)) {
            trashModal.classList.remove('active');
        }
    });

    const emptyBtn = document.getElementById('btn-empty-trash');
    if (emptyBtn) {
        emptyBtn.onclick = async () => {
            if (confirm('警告：执行清空将连带彻底粉碎相关的图片与视频，操作绝对无法恢复！确认执行？')) {
                try {
                    const posts = await invoke('get_trashed_posts');
                    const blocks = await invoke('get_trashed_blocks');
                    let allAtts = [];
                    posts.forEach(p => allAtts.push(...extractPaths(p.story)));
                    blocks.forEach(b => allAtts.push(...extractPaths(`[${b.data}]`)));
                    await invoke('empty_trash', { attachments: allAtts });
                    loadTrash();
                } catch (e) { alert("清空失败"); }
            }
        };
    }
}
// 💡 初始化调用
document.addEventListener('DOMContentLoaded', initTrashUI);

// 💡 全局暴露块序列化方法，供跨组件（比如拖入回收站）时调用
export function serializeBlockElement(b) {
    const x = parseInt(b.style.left) || 0;
    const y = parseInt(b.style.top) || 0;

    // 1. 优先读取真实物理像素，绝不解析 '%'
    let w = b.offsetWidth;
    if (!w || w <= 0) {
        w = (b.style.width && !b.style.width.includes('%')) ? parseInt(b.style.width) : (parseInt(b.dataset.lastW) || 200);
    }

    // 2. 读取当前高度
    let h = b.offsetHeight;
    if (!h || h <= 0) {
        h = (b.style.height && !b.style.height.includes('%')) ? parseInt(b.style.height) : (parseInt(b.dataset.lastH) || 200);
    }

    // 💡 3. 致命防线：绝对数学锁！
    // 无论文件夹底层算法把 DOM 的高度拉长成了什么鬼样子，
    // 只要该元素有记录的 aspect (长宽比)，直接使用初中的除法强行纠正高度并落盘！
    let aspect = null;
    if (b.dataset.aspect) {
        aspect = parseFloat(b.dataset.aspect);
        if (!isNaN(aspect) && aspect > 0 && w > 0) {
            h = Math.round(w / aspect); // 强行拉回正确的高度
        }
    }

    // 缓存最后一次有效的物理尺寸
    if (w > 0) b.dataset.lastW = w;
    if (h > 0) b.dataset.lastH = h;

    const base = { x, y, w, h };
    if (aspect !== null) base.aspect = aspect;

    const serializers = {
        'block-text': () => {
            const data = { ...base, type: 'text', content: b.querySelector('textarea')?.value || '' };
            const tInput = b.querySelector('.text-block-title-input');
            if (tInput && tInput.value) data.title = tInput.value;
            else if (b.dataset.title) data.title = b.dataset.title;
            if (b.dataset.src) data.src = b.dataset.src;
            if (b.dataset.blockStatus && b.dataset.blockStatus !== 'todo') data.status = b.dataset.blockStatus;
            return data;
        },
        'block-img': () => ({
            ...base, type: 'img', src: b.dataset.src,
            ...(b.dataset.displayName && { displayName: b.dataset.displayName }),
            ...(b.dataset.blockStatus && b.dataset.blockStatus !== 'todo' && { status: b.dataset.blockStatus })
        }),
        'block-video': () => ({
            ...base, type: 'video', src: b.dataset.src,
            ...(b.dataset.displayName && { displayName: b.dataset.displayName }),
            ...(b.dataset.blockStatus && b.dataset.blockStatus !== 'todo' && { status: b.dataset.blockStatus })
        }),
        'h5-block': () => ({
            ...base, type: 'h5',
            content: { h: b.querySelector('[data-type="html"] textarea')?.value || '', c: b.querySelector('[data-type="css"] textarea')?.value || '', j: b.querySelector('[data-type="js"] textarea')?.value || '' },
            ...(b.dataset.blockStatus && b.dataset.blockStatus !== 'todo' && { status: b.dataset.blockStatus })
        }),
        'block-embed': () => ({ ...base, type: 'embed', content: { html: b.dataset.embedHtml || '' }, ...(b.dataset.blockStatus && b.dataset.blockStatus !== 'todo' && { status: b.dataset.blockStatus }) }),
        'block-folder': () => {
            const children = [];
            const inner = b.querySelector('.folder-inner-container');
            if (inner) Array.from(inner.children).forEach(child => {
                if (child.classList.contains('block')) {
                    const childData = serializeBlockElement(child);
                    if (childData) children.push(childData);
                }
            });
            const folderData = { ...base, type: 'folder', children };
            if (b.dataset.layoutSize) { const ls = parseInt(b.dataset.layoutSize); if (!isNaN(ls)) folderData.layoutSize = ls; }
            if (b.dataset.title) folderData.title = b.dataset.title;
            return folderData;
        }
    };

    for (const [className, serializer] of Object.entries(serializers)) {
        if (b.classList.contains(className)) return serializer();
    }
    return null;
}
window.serializeBlockElement = serializeBlockElement;


// 💡 新增：设定当前活跃帖子的高亮逻辑
const setActivePost = (postEl) => {
    if (!postEl) return;

    // 1. 移除 DOM 中其他帖子的激活状态
    document.querySelectorAll('.post.active-post').forEach(el => {
        el.classList.remove('active-post');
    });

    // 2. 将此帖子标记为激活
    postEl.classList.add('active-post');

    // 3. 更新全局 ID
    activePostId = parseInt(postEl.dataset.id);
};
// 暴露给外部使用
window.setActivePost = setActivePost;

export async function savePost(card) {
    if (!card || card._isDeleting) return;
    const id = parseInt(card.dataset.id);

    const blocks = [];
    const flow = card.querySelector('.editor-flow');
    if (!flow) return;

    Array.from(flow.children).forEach(b => {
        if (b.classList.contains('block')) {
            const data = serializeBlockElement(b);
            if (data) blocks.push(data);
        }
    });

    const uniqueTags = new Set();
    const collectTags = (list) => {
        list.forEach(b => {
            if (b.type === 'text') {
                const matches = b.content.match(/#([^\s,;，；]+)/g);
                matches?.forEach(m => uniqueTags.add(m.substring(1)));
            }
            if (b.children) collectTags(b.children);
        });
    };
    collectTags(blocks);
    const tagsStr = Array.from(uniqueTags).join(',');
    const storyJson = JSON.stringify(blocks);

    try {
        const existing = allPosts.find(p => String(p.id) === String(id));
        // 从内存中的 postData 读取标题
        const currentTitle = card._postData?.title || "";

        const postData = {
            id,
            created_at: existing ? existing.created_at : Date.now(),
            // 💡 致命修改：使用正确的标题
            title: currentTitle,
            tags: tagsStr,
            story: storyJson,
            html: '', css: '', js: ''
        };

        await invoke("save_post", { post: postData });

        // 💡 核心修复：将保存呼吸灯转移到右上角的原生控制栏
        // const controlsBar = document.querySelector(".titlebar-controls");
        // if (controlsBar) {
        //     controlsBar.classList.remove("saving-pulse");
        //     void controlsBar.offsetWidth; // 触发重绘重置动画
        //     controlsBar.classList.add("saving-pulse");
        // }

        if (!existing) allPosts.unshift(postData);
        else {
            existing.story = storyJson;
            existing.tags = tagsStr;
            existing.title = currentTitle; // 💡 致命修复 3：要把新标题同步给全局内存里的数组！
            if (!existing.created_at) existing.created_at = postData.created_at;
        }

        card.classList.remove('is-new');
        card._postData = postData;
        renderSidebarRef?.(allPosts);
        renderTagCloudRef?.(allPosts);
    } catch (e) { console.error(e); }
}

const saveTimers = new Map();
export function scheduleSave(card) {
    if (!card) return;
    clearTimeout(saveTimers.get(card));
    saveTimers.set(card, setTimeout(() => savePost(card), 800));
}

window.__scheduleSave = scheduleSave; // 💡 致命修复：暴露给全局画布调用的真实保存通道

export function initPostVirtualization() {
    virtualizationObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const card = entry.target;
            if (entry.isIntersecting) {
                if (!card.classList.contains('mounted')) mountPostContent(card);
            } else {
                if (card.classList.contains('mounted') && !card.classList.contains('is-new')) unmountPostContent(card);
            }
        });
    }, { root: document.querySelector('.main-scroll'), rootMargin: '500px 0px', threshold: 0.01 });
}

export function mountPostContent(card) {
    if (card.classList.contains('mounted')) return;
    const post = card._postData;
    if (!post) return;

    card.classList.add('mounted');
    const flow = document.createElement('div');
    flow.className = 'editor-flow';
    card.appendChild(flow);

    try {
        let blocks = [];
        try { blocks = JSON.parse(post.story || '[]'); }
        catch (e) {
            card.innerHTML += `<div class="mount-error">数据损坏，无法完整显示内容</div>`;
            return;
        }

        blocks.forEach(b => {
            try { renderBlockRef?.(flow, b, card); }
            catch (err) { console.warn("渲染单个块失败", err, b); }
        });
        updateContainerHeightRef?.(flow);
        card.querySelectorAll('video').forEach(v => observeVideoRef?.(v));
    } catch (unexpected) { console.error("渲染异常", unexpected); }
}

export function unmountPostContent(card) {
    if (!card.classList.contains('mounted')) return;
    card.querySelectorAll('video').forEach(v => unobserveVideoRef?.(v));

    const currentHeight = card.offsetHeight;
    card.style.minHeight = currentHeight + 'px';

    const flow = card.querySelector('.editor-flow');
    if (flow) {
        savePost(card);
        flow.remove();
    }
    card.classList.remove('mounted');
}

window.addEventListener('beforeunload', () => {
    document.querySelectorAll('.post.mounted').forEach(card => savePost(card));
});