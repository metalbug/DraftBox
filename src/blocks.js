/**
 * 块渲染模块
 * @module blocks
 */

import { invoke, convertFileSrc as convertLocalPath, convertToLocalPath, escapeHtml, checkBlockHasContent } from './utils.js';
import { parseMarkdown, toggleBold, toggleItalic, htmlToMarkdown } from './text-editor.js';
import { showConfirm, OverlayScrollbar } from './ui-components.js';
import { makeDraggable, makeResizable, updateContainerHeight } from './drag-resize.js';
import { reflowFolderContent, showSortMenu } from './folder.js';
import { observeVideo, unobserveVideo } from './media.js';
import { getSelectedBlocks } from './canvas.js';
import { t } from './i18n.js';

// 保存调度器（防抖）
const saveTimers = new Map();

/**
 * 调度保存（防抖 800ms）
 * @param {HTMLElement} card - 帖子元素
 * @param {Function} savePost - 保存函数
 */
export function scheduleSave(card, savePost) {
    if (!card) return;
    clearTimeout(saveTimers.get(card));
    saveTimers.set(card, setTimeout(() => savePost?.(card), 800));
}

/**
 * 计算块位置（智能视口扫描与网格填充）
 * @param {HTMLElement} container - 容器
 * @param {Object} blockData - 块数据
 * @param {Object} insertPos - 插入位置
 */
export function calcBlockPosition(container, blockData, insertPos) {
    if (insertPos) {
        blockData.x = Math.max(20, insertPos.x);
        blockData.y = Math.max(20, insertPos.y);
    } else {
        const rect = container.getBoundingClientRect();
        // 120 是避开顶部控制栏的视口缓冲高度
        const baseScanY = rect.top < 120 ? Math.abs(rect.top) + 120 : 60;
        const containerWidth = container.offsetWidth || 800;

        const bw = blockData.w || 200;
        const bh = blockData.h || 200;
        const scanGridSize = 30; // 扫描步长
        const gap = 20;          // 卡片之间的安全间距

        const isPlaceOccupied = (x, y) => {
            return Array.from(container.children).some(b => {
                if (!b.classList.contains('block')) return false;
                const bx = parseInt(b.style.left) || 0;
                const by = parseInt(b.style.top) || 0;
                const bWidth = b.offsetWidth || parseInt(b.style.width) || 200;
                const bHeight = b.offsetHeight || parseInt(b.style.height) || 200;

                // 矩形碰撞检测
                return !(x + bw + gap <= bx || x >= bx + bWidth + gap || y + bh + gap <= by || y >= by + bHeight + gap);
            });
        };

        let targetX = 20;
        let targetY = baseScanY;
        let found = false;

        // 💡 致命修复：扩大向下扫描范围（100行 * 30步长 = 3000像素深度），绝对能穿过任何高大卡片找到空地
        for (let row = 0; row < 100; row++) {
            const currentY = baseScanY + (row * scanGridSize);

            // 从左到右扫描当前行
            for (let currentX = 20; currentX + bw + gap <= containerWidth; currentX += scanGridSize) {
                if (!isPlaceOccupied(currentX, currentY)) {
                    targetX = currentX;
                    targetY = currentY;
                    found = true;
                    break;
                }
            }
            if (found) break;
        }

        // 兜底逻辑：如果可视区域真的被塞得水泄不通，则在左上角稍微错开一点点即可，不要长距离层叠
        if (!found) {
            targetX = 20 + Math.floor(Math.random() * 40);
            targetY = baseScanY + Math.floor(Math.random() * 40);
        }

        blockData.x = targetX;
        blockData.y = targetY;
    }
}

/**
 * 计算默认尺寸
 * @param {Object} blockData - 块数据
 */
export function calcDefaultSize(blockData) {
    const defaultSizes = {
        h5: { w: 300, h: 200 },
        text: { w: 300, h: 200 },
        default: { w: 200, h: 200 }
    };
    const size = defaultSizes[blockData.type] || defaultSizes.default;
    if (!blockData.w) blockData.w = size.w;
    if (!blockData.h) blockData.h = size.h;
}

/**
 * 滚动到新添加的块
 * @param {HTMLElement} container - 容器
 */
export function scrollToNewBlock(container) {
    const newBlock = container.lastElementChild;
    if (newBlock) {
        setTimeout(() => newBlock.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    }
}

/**
 * 添加块
 * @param {HTMLElement} container - 容器
 * @param {string} type - 块类型
 * @param {*} content - 内容
 * @param {HTMLElement} card - 帖子元素
 * @param {Object} insertPos - 插入位置
 * @param {Function} savePost - 保存函数
 */
export function addBlock(container, type, content, card, insertPos = null, savePost) {
    const blockData = { type, isNew: true };

    if ((type === 'img' || type === 'video') && content?.src) {
        blockData.src = content.src;
    } else {
        blockData.content = content;
    }

    if (type === 'h5' && !blockData.content) {
        blockData.content = { h: '', c: '', j: '' };
    }

    // 💡 核心调整：必须先计算出块的默认大小，然后再去计算位置（因为碰撞雷达需要知道即将插入的宽和高）
    calcDefaultSize(blockData);
    calcBlockPosition(container, blockData, insertPos);

    renderBlock(container, blockData, card, savePost);
    updateContainerHeight(container);
    if (card) scheduleSave(card, savePost);
    scrollToNewBlock(container);
}

/**
 * 创建媒体文件名编辑器
 * @param {Object} blockData - 块数据
 * @param {HTMLElement} block - 块元素
 * @param {HTMLElement} wrapper - 容器
 * @param {Function} triggerSave - 保存回调
 */
function createMediaFilenameEditor(blockData, block, wrapper, triggerSave) {
    let filename = blockData.displayName;
    if (!filename) {
        let decodedSrc = blockData.src;
        try { decodedSrc = decodeURIComponent(decodedSrc); } catch { }
        const rawFilename = decodedSrc.split('/').pop().split('\\').pop();
        filename = rawFilename.replace(/^\d+_/, '');
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

    nameContainer.append(nameInput, extSpan);
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
        if (srcPath?.includes('uploads')) {
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

/**
 * 渲染块
 * @param {HTMLElement} container - 容器
 * @param {Object} blockData - 块数据
 * @param {HTMLElement} card - 帖子元素
 * @param {Function} savePost - 保存函数
 * @returns {HTMLElement} 块元素
 */
export function renderBlock(container, blockData, card, savePost) {
    const block = document.createElement('div');
    block.className = `block block-${blockData.type}`;
    if (blockData.type === 'h5') block.classList.add('h5-block');

    // 坐标与尺寸
    const { x = 20, y = 60, w = (blockData.type === 'h5' ? 300 : 200), h = 200 } = blockData;

    // 核心结构：仅文本块使用 ComfyUI 风格，其他块维持简洁背景
    const isText = blockData.type === 'text';

    Object.assign(block.style, {
        left: x + 'px',
        top: y + 'px',
        width: w + 'px',
        height: h + 'px'
    });

    // 保存 Aspect Ratio
    block.dataset.aspect = blockData.aspect || (w / h);

    if (isText) {
        block.innerHTML = `
            <div class="block-header">
                <div class="block-header-left"></div>
                <div class="block-header-center"></div>
                <div class="block-header-right">
                    <span class="block-del">✕</span>
                </div>
            </div>
            <div class="block-body"></div>
            <div class="resize-handle"></div>
            <div class="resize-handle-right"></div>
        `;
    } else {
        block.innerHTML = `
            <div class="block-handle"></div>
            <div class="resize-handle"></div>
            <div class="resize-handle-right"></div>
            <span class="block-del">✕</span>
        `;
    }

    const header = block.querySelector('.block-header');
    const body = isText ? block.querySelector('.block-body') : block;
    const headerLeft = block.querySelector('.block-header-left');
    const headerCenter = block.querySelector('.block-header-center');
    const headerRight = block.querySelector('.block-header-right');
    const handle = block.querySelector('.block-handle');

    const triggerSave = () => {
        updateContainerHeight(container);
        if (card) scheduleSave(card, savePost);

        // 💡 致命修复：添加防抖逻辑。只有你停下操作 800ms 后，底层数据真实落盘时，块才会发光！
        clearTimeout(block._pulseTimer);
        block._pulseTimer = setTimeout(() => {
            block.classList.remove('saving-pulse');
            void block.offsetWidth;
            block.classList.add('saving-pulse');
        }, 800);
    };

    // 上下文对象
    const context = {
        selectedBlocks: getSelectedBlocks(),
        reflowFolderContent,
        updateContainerHeight
    };

    // 拖拽手柄：文本块用标题中心区域，其他用顶部悬浮条
    makeDraggable(block, isText ? headerCenter : handle, container, triggerSave, context);

    const resizer = block.querySelector('.resize-handle');
    makeResizable(block, resizer, container, triggerSave, 'both', context);

    const resizerRight = block.querySelector('.resize-handle-right');
    makeResizable(block, resizerRight, container, triggerSave, 'width', context);

    // 💡 全新回收站流转逻辑
    const del = block.querySelector('.block-del');
    del.onmousedown = (e) => e.stopPropagation();
    del.onclick = (e) => {
        e.stopPropagation();

        const cb = async () => {
            // ==== 将块序列化并存入回收站 ====
            if (window.serializeBlockElement) {
                const blockData = window.serializeBlockElement(block);
                if (blockData) {
                    const card = block.closest('.post');
                    const postId = card ? parseInt(card.dataset.id) : 0;
                    try {
                        await invoke('trash_block', { postId, data: JSON.stringify(blockData) });
                    } catch (err) { console.warn("移入回收站失败", err); }
                }
            }

            block.querySelectorAll('video').forEach(v => unobserveVideo(v));
            // 移除了底层直接删文件的调用，把生杀大权移交给回收站！
            block.remove();
            triggerSave();
        };

        if (checkBlockHasContent(block)) {
            showConfirm("确定要将这个块扔进废纸篓吗？", e.clientX, e.clientY, cb);
        } else {
            cb();
        }
    };

    // 仅文本块在 header 渲染状态灯，其他块（如果需要）可以维持悬浮状态
    if (isText) {
        const statusBtn = document.createElement('span');
        statusBtn.className = 'block-status';

        const statusList = ['todo', 'doing', 'done', 'question', 'cancelled'];
        const statusIcons = { todo: '', doing: '→', done: '✓', question: '?', cancelled: '✕' };
        // 💡 状态对应文字映射表
        const getStatusPlaceholder = (s) => ({ todo: t('ph_title'), doing: t('ph_doing'), done: t('ph_done'), question: t('ph_question'), cancelled: t('ph_cancelled') }[s] || t('ph_title'));

        const initStatus = blockData.status || 'todo';
        statusBtn.dataset.status = initStatus;
        statusBtn.textContent = statusIcons[initStatus] || '';
        block.dataset.blockStatus = initStatus;
        // triggerSave();

        statusBtn.onmousedown = (e) => e.stopPropagation();
        statusBtn.onclick = (e) => {
            e.stopPropagation();
            const current = statusBtn.dataset.status;
            const idx = statusList.indexOf(current);
            const next = statusList[(idx + 1) % statusList.length];

            statusBtn.dataset.status = next;
            statusBtn.textContent = statusIcons[next] || '';
            block.dataset.blockStatus = next;
            triggerSave();

            // 💡 核心联动：同步更新标题输入框的占位符，并触发尺寸重算！
            const titleInput = block.querySelector('.text-block-title-input');
            if (titleInput) {
                titleInput.placeholder = getStatusPlaceholder(next);
                // 派发 input 事件，借用现有的 autoResizeTitle 逻辑自动拉伸/缩短输入框
                titleInput.dispatchEvent(new Event('input'));
            }
        };

        headerLeft.appendChild(statusBtn);
    }

    // 内容渲染
    if (blockData.type === 'folder') {
        renderFolderBlock(block, blockData, card, container, triggerSave, del, savePost);
    } else {
        renderBlockContent(body, blockData, triggerSave);
    }

    // 恢复 src 到 dataset
    if (blockData.src) block.dataset.src = blockData.src;

    container.appendChild(block);
    return block;
}

/**
 * 渲染文件夹块内容 (💡 已升级为带有顶部 Header 栏的全新结构)
 */
function renderFolderBlock(block, blockData, card, container, triggerSave, del, savePost) {
    if (blockData.layoutSize) block.dataset.layoutSize = blockData.layoutSize;
    if (blockData.title) block.dataset.title = blockData.title;

    // 1. 把简陋的拖拽把手升级为完整的顶部标题栏 (Header)
    const handle = block.querySelector('.block-handle');
    handle.className = 'block-handle folder-header';
    handle.innerHTML = ''; // 清空自带的不可见节点

    // 左侧：标题输入框
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'folder-title-input';
    titleInput.placeholder = t('ph_folder_title');
    titleInput.value = blockData.title || '';
    titleInput.addEventListener('input', () => {
        block.dataset.title = titleInput.value;
        triggerSave();
    });
    titleInput.addEventListener('mousedown', e => { if (!e.ctrlKey) e.stopPropagation(); });

    // 右侧：工具按钮组
    const headerRight = document.createElement('div');
    headerRight.className = 'folder-header-right';
    // 💡 致命拦截：阻止鼠标按下事件冒泡到顶层的 Header 上，彻底废除此区域的拖拽能力
    headerRight.addEventListener('mousedown', e => e.stopPropagation());

    handle.appendChild(titleInput);
    handle.appendChild(headerRight);

    // 2. 内部容器
    const folderInner = document.createElement('div');
    folderInner.className = 'folder-inner-container';

    // 渲染子块
    if (blockData.children?.length) {
        folderInner.classList.add('no-transition');
        blockData.children.forEach(childData => {
            if (!childData.aspect && childData.w && childData.h) childData.aspect = childData.w / childData.h;
            const child = renderBlock(folderInner, childData, card, savePost);
            if (child && childData.aspect) child.dataset.aspect = childData.aspect;
        });
    }

    block.appendChild(folderInner);

    // 初始布局
    setTimeout(() => {
        reflowFolderContent(block, parseInt(block.style.width), parseInt(block.style.height));
        requestAnimationFrame(() => folderInner.classList.remove('no-transition'));
    }, 0);

    // 3. 覆盖并改造删除按钮 (把它放进 Header 右侧最后一位)
    del.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    del.onclick = (e) => {
        e.stopPropagation();
        const cb = async () => {
            if (window.serializeBlockElement) {
                const folderData = window.serializeBlockElement(block);
                if (folderData) {
                    const card = block.closest('.post');
                    const postId = card ? parseInt(card.dataset.id) : 0;
                    try { await invoke('trash_block', { postId, data: JSON.stringify(folderData) }); }
                    catch (err) { console.warn("移入回收站失败", err); }
                }
            }
            block.querySelectorAll('.block').forEach(child => {
                child.querySelectorAll('video').forEach(v => unobserveVideo(v));
            });
            block.remove();
            triggerSave();
        };

        if (checkBlockHasContent(block)) {
            showConfirm("确定要将这个文件夹打包移入回收站吗？", e.clientX, e.clientY, cb);
        } else cb();
    };

    // 4. 渲染其他极简控制按钮
    renderFolderControls(block, headerRight, container, triggerSave);

    // 最后再把删除按钮追加到最右侧
    headerRight.appendChild(del);
}

/**
 * 渲染文件夹工具按钮 (💡 已替换为纯粹的极简线条 SVG 图标)
 */
function renderFolderControls(block, headerRight, container, triggerSave) {
    const createBtn = (html, title, clickHandler) => {
        const btn = document.createElement('span');
        btn.className = 'folder-action-btn';
        btn.innerHTML = html;
        btn.title = title;
        btn.onclick = (e) => {
            e.stopPropagation();
            clickHandler(e, block, btn);
        };
        return btn;
    };

    // 极简单色图标 SVG
    const iconMinus = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
    const iconPlus = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
    const iconSort = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5h10M11 9h7M11 13h4M3 17l4 4 4-4M7 21V3"/></svg>`;
    const iconMute = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`;
    const iconSound = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`;

    const shrinkBtn = createBtn(iconMinus, '缩小内容', (e, b) => {
        let current = parseInt(b.dataset.layoutSize) || 300;
        let next = Math.max(100, current - 100);
        if (current !== next) {
            b.dataset.layoutSize = next;
            const newH = reflowFolderContent(b, b.offsetWidth, b.offsetHeight);
            if (newH) {
                b.style.height = newH + 'px';
                reflowFolderContent(b, b.offsetWidth, newH);
                updateContainerHeight(container);
            }
            triggerSave();
        }
    });

    const expandBtn = createBtn(iconPlus, '放大内容', (e, b) => {
        let current = parseInt(b.dataset.layoutSize) || 300;
        let next = Math.min(1000, current + 100);
        if (current !== next) {
            b.dataset.layoutSize = next;
            const newH = reflowFolderContent(b, b.offsetWidth, b.offsetHeight);
            if (newH) {
                b.style.height = newH + 'px';
                reflowFolderContent(b, b.offsetWidth, newH);
                updateContainerHeight(container);
            }
            triggerSave();
        }
    });

    const speedBtn = createBtn(`<span style="font-size:10px;font-weight:700;">1x</span>`, '切换倍速', (e, b, btn) => {
        const speeds = [1, 1.5, 2, 0.5];
        let current = parseFloat(b.dataset.playbackSpeed || '1');
        let next = speeds[(speeds.indexOf(current) + 1) % speeds.length];
        b.dataset.playbackSpeed = next;
        btn.innerHTML = `<span style="font-size:10px;font-weight:700;">${next}x</span>`;
        b.querySelectorAll('video').forEach(v => {
            v.playbackRate = next;
            v.dataset.manualSpeed = 'true';
        });
    });

    const muteBtn = createBtn(iconMute, '静音控制', (e, b, btn) => {
        const isSoundOn = b.dataset.soundMode === 'on';
        if (isSoundOn) {
            b.dataset.soundMode = 'off';
            btn.innerHTML = iconMute;
            b.querySelectorAll('video').forEach(v => v.muted = true);
        } else {
            b.dataset.soundMode = 'on';
            btn.innerHTML = iconSound;
        }
    });

    const sortBtn = createBtn(iconSort, '排序内容', (e, b) => {
        showSortMenu(e, b, triggerSave);
    });

    // 从左到右依次插入到 headerRight
    headerRight.appendChild(shrinkBtn);
    headerRight.appendChild(expandBtn);
    headerRight.appendChild(speedBtn);
    headerRight.appendChild(muteBtn);
    headerRight.appendChild(sortBtn);

    // 获取文件夹内部容器
    const inner = block.querySelector('.folder-inner-container');
    if (inner) {
        // 💡 致命补全：动态显示/隐藏视频控制按钮的逻辑
        const updateVideoControls = () => {
            // 只要文件夹里存在视频块，就显示；否则隐藏
            const hasVideo = inner.querySelector('.block-video') !== null;
            speedBtn.style.display = hasVideo ? 'flex' : 'none';
            muteBtn.style.display = hasVideo ? 'flex' : 'none';
        };

        // 1. 初始化时检测一次
        updateVideoControls();

        // 2. 挂载观察器：实时监听文件夹内部的拖入、移出、删除等动作
        const observer = new MutationObserver(updateVideoControls);
        observer.observe(inner, { childList: true, subtree: true });

        // 3. Hover 声音逻辑保持不变
        inner.addEventListener('mouseover', (e) => {
            if (block.dataset.soundMode !== 'on') return;
            const wrapper = e.target.closest('.video-wrapper');
            const video = wrapper?.querySelector('video');
            if (video) video.muted = false;
        }, true);

        inner.addEventListener('mouseout', (e) => {
            if (block.dataset.soundMode !== 'on') return;
            const wrapper = e.target.closest('.video-wrapper');
            if (wrapper && (!e.relatedTarget || !wrapper.contains(e.relatedTarget))) {
                const video = wrapper.querySelector('video');
                if (video) video.muted = true;
            }
        }, true);
    }
}

/**
 * 渲染块内容
 */
function renderBlockContent(block, blockData, triggerSave) {
    const type = blockData.type;

    // 内容渲染器映射
    const renderers = {
        text: () => renderTextBlock(block, blockData, triggerSave),
        img: () => renderMediaBlock(block, blockData, triggerSave, 'img'),
        video: () => renderMediaBlock(block, blockData, triggerSave, 'video'),
        embed: () => renderEmbedBlock(block, blockData),
        h5: () => renderH5Block(block, blockData, triggerSave)
    };

    renderers[type]?.();
}

/**
 * 渲染文本块
 */
function renderTextBlock(block, blockData, triggerSave) {
    const isNew = blockData.isNew;

    // 1. 标题区域
    const titleContainer = document.createElement('div');
    titleContainer.className = 'text-block-title';
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'text-block-title-input';

    // 💡 联动逻辑：初始化渲染时，根据当前的状态赋予正确的默认占位符
    const initStatus = blockData.status || 'todo';
    const statusPlaceholders = { todo: t('ph_title'), doing: t('ph_doing'), done: t('ph_done'), question: t('ph_question'), cancelled: t('ph_cancelled') };
    titleInput.placeholder = statusPlaceholders[initStatus] || t('ph_title');

    const initTitle = blockData.title || '';
    titleInput.value = initTitle;
    if (initTitle) block.dataset.title = initTitle;
    titleContainer.appendChild(titleInput);

    const headerCenter = block.closest('.block')?.querySelector('.block-header-center');
    if (headerCenter) headerCenter.appendChild(titleContainer);

    // // 2. 模式切换按钮 (💡 已更新为极简线条 SVG 图标)
    const toggleBtn = document.createElement('span');
    toggleBtn.className = 'block-mode-toggle';
    toggleBtn.title = t('toggle_source_visual');
    toggleBtn.setAttribute('data-i18n-title', 'toggle_source_visual');
    toggleBtn.innerHTML = `
        <svg class="icon-visual" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;cursor:pointer;">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
        </svg>
        <svg class="icon-code" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none;width:16px;height:16px;cursor:pointer;">
            <polyline points="16 18 22 12 16 6"></polyline>
            <polyline points="8 6 2 12 8 18"></polyline>
        </svg>
    `;
    const headerRight = block.closest('.block')?.querySelector('.block-header-right');
    if (headerRight) headerRight.insertBefore(toggleBtn, headerRight.firstChild);

    // 3. 源码编辑器容器 (带行号)
    const editorWrapper = document.createElement('div');
    editorWrapper.className = 'code-editor-wrapper code-mode';
    editorWrapper.style.cssText = 'display:flex; width:100%; height:100%; overflow:hidden; position:relative;';

    const lineNumbers = document.createElement('div');
    lineNumbers.className = 'text-block-line-numbers';

    const ta = document.createElement('textarea');
    ta.className = 'text-block-editor';
    ta.value = blockData.content || '';
    ta.placeholder = "Markdown 源码...";
    ta.spellcheck = false;

    editorWrapper.append(lineNumbers, ta);

    // 4. 可视化编辑器容器
    const visualWrapper = document.createElement('div');
    visualWrapper.className = 'visual-editor-wrapper visual-mode';
    visualWrapper.style.cssText = 'width:100%; height:100%; overflow:hidden; position:relative;';

    const visual = document.createElement('div');
    visual.className = 'text-block-visual';
    visual.contentEditable = true;
    visual.placeholder = "在此输入内容...";
    // 取消内联的 padding，交由统一 CSS 控制以对齐源码模式
    visual.style.cssText = 'width:100%; height:100%; overflow:auto; outline:none;';

    visualWrapper.appendChild(visual);

    // 致命修复：先获取到内部的 body 容器，再把这两个编辑器容器挂载进去！
    const body = block.querySelector('.block-body') || block;
    body.appendChild(editorWrapper);
    body.appendChild(visualWrapper);

    // 5. 状态栏
    const statusBar = document.createElement('div');
    statusBar.className = 'text-block-status-bar';
    body.appendChild(statusBar);

    let editMode = 'visual';

    // 刷新行号
    const updateLineNumbers = () => {
        const linesCount = ta.value.split('\n').length;
        lineNumbers.innerHTML = Array.from({ length: Math.max(linesCount, 1) }, (_, i) => i + 1).join('<br>');
    };

    // 状态栏更新逻辑
    const updateStatusBar = () => {
        if (editMode === 'visual') {
            let textContent = visual.innerText || '';

            // 💡 致命修复：剔除浏览器富文本在末尾强行附加的幽灵换行符 '\n'
            // 这能确保空文本块（<p><br></p>）被正确识别为 0 个字符
            if (textContent.endsWith('\n')) {
                textContent = textContent.slice(0, -1);
            }

            statusBar.textContent = `${textContent.length} ${t('chars')}`;
        } else {
            const val = ta.value;
            const pos = ta.selectionStart;
            const textBeforeCursor = val.substring(0, pos);
            const lines = textBeforeCursor.split('\n');
            const currentLine = lines.length;
            const currentCol = lines[lines.length - 1].length + 1;
            statusBar.textContent = `${currentLine} ${t('line')} / ${currentCol} ${t('col')} / ${val.length} ${t('chars')}`;
        }
    };

    // 同步逻辑
    const syncToSource = () => {
        if (editMode === 'visual') {
            const md = htmlToMarkdown(visual.innerHTML);
            ta.value = md;
            updateLineNumbers();
            triggerSave();
            updateStatusBar();
        }
    };

    // 视图同步逻辑
    const syncToVisual = () => {
        visual.innerHTML = parseMarkdown(ta.value) || '<p><br></p>';
        // 移除多余的 hljs 调用，因为 parseMarkdown 内部已经完成了带有颜色样式的 HTML 渲染，
        // 再次调用会破坏并重置已被解析好的结构。
        updateStatusBar();
    };

    // 视图切换逻辑 (增加 skipSync 参数以配合幽灵光标逻辑)
    const updateUI = (shouldFocus = false, skipSync = false) => {
        const iconVisual = toggleBtn.querySelector('.icon-visual');
        const iconCode = toggleBtn.querySelector('.icon-code');

        if (editMode === 'visual') {
            editorWrapper.style.display = 'none';
            visualWrapper.style.display = 'block';
            iconVisual.style.display = 'block';
            iconCode.style.display = 'none';
            if (!skipSync) syncToVisual();
            if (shouldFocus) visual.focus();
        } else {
            editorWrapper.style.display = 'flex';
            visualWrapper.style.display = 'none';
            iconVisual.style.display = 'none';
            iconCode.style.display = 'block';
            if (!skipSync) updateLineNumbers();
            if (shouldFocus) ta.focus();
        }
        updateStatusBar();
    };

    // 致命修复 1：必须阻止 mousedown 的默认行为，防止按钮点击时夺走编辑器的光标焦点！
    toggleBtn.onmousedown = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };

    toggleBtn.onclick = (e) => {
        e.stopPropagation();
        const marker = 'CURSORMARKER123456789';

        if (editMode === 'visual') {
            // ==== 可视化 -> 源码：转移光标 ====
            const sel = window.getSelection();
            let savedPos = -1;

            if (sel.rangeCount > 0 && visual.contains(sel.anchorNode)) {
                const range = sel.getRangeAt(0).cloneRange();
                range.collapse(false);

                const markerNode = document.createTextNode(marker);
                range.insertNode(markerNode);

                const md = htmlToMarkdown(visual.innerHTML);
                const cursorIdx = md.indexOf(marker);

                if (cursorIdx !== -1) {
                    savedPos = cursorIdx;
                    ta.value = md.replace(marker, '');
                } else {
                    ta.value = md.replace(new RegExp(marker, 'g'), '');
                }

                markerNode.remove();
                visual.normalize();

                updateLineNumbers();
                triggerSave();
            } else {
                syncToSource();
            }

            editMode = 'source';
            updateUI(false, true);

            setTimeout(() => {
                if (savedPos !== -1) {
                    // 💡 致命修复 1：顺序必须颠倒！先设定光标位置
                    ta.setSelectionRange(savedPos, savedPos);
                    // 再聚焦。此时浏览器会自然地把视图滚动到光标所在的那一行，而不是文本末尾！
                    ta.focus();

                    // 补充修复：原生滚动可能不触发 scroll 事件，手动同步一次侧边行号
                    lineNumbers.scrollTop = ta.scrollTop;
                }
            }, 10);

        } else {
            // ==== 源码 -> 可视化：转移光标 ====
            let savedPos = ta.selectionStart;
            let hasCursor = document.activeElement === ta;

            if (hasCursor && typeof savedPos === 'number') {
                const originalValue = ta.value;
                const markedValue = originalValue.substring(0, savedPos) + marker + originalValue.substring(savedPos);

                visual.innerHTML = parseMarkdown(markedValue) || '<p><br></p>';

                const treeWalker = document.createTreeWalker(visual, NodeFilter.SHOW_TEXT, null, false);
                let node;
                let foundNode = null;
                let foundIdx = -1;

                while ((node = treeWalker.nextNode())) {
                    const idx = node.nodeValue.indexOf(marker);
                    if (idx !== -1) {
                        node.nodeValue = node.nodeValue.replace(marker, '');
                        foundNode = node;
                        foundIdx = idx;
                        break;
                    }
                }

                if (!foundNode) {
                    visual.innerHTML = visual.innerHTML.replace(new RegExp(marker, 'g'), '');
                }

                editMode = 'visual';
                updateUI(false, true);

                setTimeout(() => {
                    if (foundNode) {
                        // 💡 致命修复 2：同理，先在 DOM 里建立正确的选区
                        const sel = window.getSelection();
                        const range = document.createRange();
                        range.setStart(foundNode, foundIdx);
                        range.collapse(true);
                        sel.removeAllRanges();
                        sel.addRange(range);
                        // 最后再 focus，让富文本视图完美对齐到光标处
                        visual.focus();
                    } else {
                        const sel = window.getSelection();
                        sel.selectAllChildren(visual);
                        sel.collapseToEnd();
                        visual.focus();
                    }
                }, 10);

            } else {
                editMode = 'visual';
                updateUI(false, false);
            }
        }
    };

    // 监听外部媒体拖入事件
    const outerBlock = block.closest('.block') || block;
    outerBlock.addEventListener('insert-media', (e) => {
        const { content } = e.detail;

        if (editMode === 'visual') syncToSource();

        let start = ta.selectionStart;
        let end = ta.selectionEnd;

        if (editMode === 'visual' || typeof start !== 'number') {
            start = ta.value.length;
            end = ta.value.length;
        }

        ta.value = ta.value.substring(0, start) + content + ta.value.substring(end);
        const newPos = start + content.length;

        try {
            if (editMode === 'source') {
                ta.setSelectionRange(newPos, newPos);
                ta.focus();
            }
        } catch (err) {
            console.warn("光标复位被拦截:", err);
        }

        updateLineNumbers();
        triggerSave();

        if (editMode === 'visual') syncToVisual();
        updateStatusBar();
    });

    // 标题输入逻辑
    const autoResizeTitle = () => {
        const measure = document.createElement('span');
        measure.style.cssText = 'visibility:hidden;position:absolute;white-space:pre;font-size:15px;font-weight:500;padding:0 2px;';
        measure.textContent = titleInput.value || titleInput.placeholder || '';
        document.body.appendChild(measure);
        titleInput.style.width = Math.max(50, measure.offsetWidth + 10) + 'px';
        measure.remove();
    };

    titleInput.addEventListener('input', () => {
        (block.closest('.block') || block).dataset.title = titleInput.value;
        autoResizeTitle();
        triggerSave();
    });
    titleInput.addEventListener('mousedown', e => { if (!e.ctrlKey) e.stopPropagation(); });

    // 源码编辑器事件
    ta.addEventListener('input', () => {
        updateLineNumbers();
        triggerSave();
        updateStatusBar();
    });
    ta.addEventListener('scroll', () => { lineNumbers.scrollTop = ta.scrollTop; });
    ta.addEventListener('keyup', updateStatusBar);
    ta.addEventListener('mouseup', updateStatusBar);

    // 可视化编辑器事件
    visual.addEventListener('input', () => syncToSource());
    visual.addEventListener('keyup', updateStatusBar);
    visual.addEventListener('mouseup', updateStatusBar);

    // ======== 终极修复：智能剪贴板拦截 (区分代码块与普通富文本) ========
    visual.addEventListener('paste', (e) => {
        e.preventDefault();

        const html = e.clipboardData.getData('text/html');
        const text = e.clipboardData.getData('text/plain');

        if (html) {
            // 智能探测：如果剪贴板 HTML 中含有大量代码块特征（如 VS Code 复制、网页 <pre> 等）
            // 我们才走“洗码”流程将其转为本应用的代码风格；否则直接原生插入，完美保留原网页排版与颜色！
            const isCodeBlock = /<pre\b[^>]*>/i.test(html) ||
                /font-family:[^;]*(Consolas|monospace|Courier New|Fira Code)/i.test(html) ||
                /class="[^"]*(highlight|codehilite|hljs|language-)[^"]*"/i.test(html);

            if (isCodeBlock) {
                const md = htmlToMarkdown(html);
                let cleanHtml = parseMarkdown(md).trim();
                if (cleanHtml.startsWith('<p>') && cleanHtml.endsWith('</p>') && cleanHtml.indexOf('<p>', 1) === -1) {
                    cleanHtml = cleanHtml.substring(3, cleanHtml.length - 4);
                }
                document.execCommand('insertHTML', false, cleanHtml);
            } else {
                // 普通网页富文本：直接放行，保留原始排版、颜色！
                document.execCommand('insertHTML', false, html);
            }
        } else if (text) {
            // 针对点击 AI 聊天框“复制代码”按钮带来的纯文本进行拦截
            if (text.trim().startsWith('```') || text.includes('\n```')) {
                // 如果是纯文本但带有 Markdown 代码块标记，强制渲染为高亮代码块
                const cleanHtml = parseMarkdown(text).trim();
                document.execCommand('insertHTML', false, cleanHtml);
            } else {
                // 普通纯文本，安全插入
                const safeText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
                document.execCommand('insertHTML', false, safeText);
            }
        }

        setTimeout(() => {
            syncToSource();
            updateStatusBar();
            triggerSave();
        }, 10);
    });

    // 快捷键支持
    const handleShortcuts = (e, el) => {
        if (e.ctrlKey) {
            if (e.key === 'b') { e.preventDefault(); toggleBold(el); }
            if (e.key === 'i') { e.preventDefault(); toggleItalic(el); }
            if (e.key === 'Enter') { el.blur(); }
        }
    };
    ta.onkeydown = (e) => handleShortcuts(e, ta);
    visual.onkeydown = (e) => handleShortcuts(e, visual);

    // 延迟初始化操作
    setTimeout(() => {
        autoResizeTitle();
        updateUI();
        if (isNew) {
            editMode = 'visual';
            updateUI();
            visual.focus();
        }

        // 恢复自定义滚动条 (挂载到 wrapper 包装层上)
        new OverlayScrollbar(ta, editorWrapper);
        new OverlayScrollbar(visual, visualWrapper);
    }, 0);
}

/**
 * 渲染媒体块（图片/视频）
 */
function renderMediaBlock(block, blockData, triggerSave, type) {
    const isExternalUrl = blockData.src?.startsWith('http://') || blockData.src?.startsWith('https://');

    // 💡 核心机制：自愈与兼容
    let displaySrc = blockData.src; // 用于前端显示的绝对路径
    let saveSrc = blockData.src;    // 用于存进数据库的相对路径

    if (!isExternalUrl && displaySrc) {
        // 无论数据库存的是旧的绝对路径，还是新的相对路径，统统截取最后的文件名
        const match = displaySrc.match(/uploads[\\/](.+)$/);
        if (match) {
            saveSrc = `uploads/${match[1]}`; // 净化为纯净的相对路径
            displaySrc = `${window.__BASE_DIR__}/${saveSrc}`; // 缝合为当前电脑的绝对路径
        }
    }

    // 显示用的路径交给 Tauri 的协议去转换
    const src = isExternalUrl ? displaySrc : convertLocalPath(displaySrc);

    if (type === 'video') {
        const videoWrapper = document.createElement('div');
        videoWrapper.className = 'video-wrapper';

        createMediaFilenameEditor(blockData, block, videoWrapper, triggerSave);

        const video = document.createElement('video');
        Object.assign(video, { muted: true, loop: true, playsInline: true, preload: 'none' });
        video.dataset.src = src;
        video.className = 'media-content';

        // 控件
        const controls = document.createElement('div');
        controls.className = 'video-controls';

        const progressBar = document.createElement('div');
        progressBar.className = 'video-progress';
        const progressFill = document.createElement('div');
        progressFill.className = 'video-progress-fill';
        progressBar.appendChild(progressFill);

        const muteBtn = document.createElement('button');
        muteBtn.className = 'video-mute-btn';
        muteBtn.textContent = '🔇';

        controls.append(progressBar, muteBtn);
        videoWrapper.append(video, controls);
        block.appendChild(videoWrapper);

        // 延迟注册观察器
        setTimeout(() => observeVideo(video), 0);

        // 事件绑定
        video.addEventListener('timeupdate', () => {
            progressFill.style.width = (video.currentTime / video.duration * 100) + '%';
        });

        video.dataset.initialState = 'true';

        video.addEventListener('click', e => {
            if (e.ctrlKey) return;
            e.stopPropagation();

            if (video.dataset.initialState === 'true' && video.muted) {
                video.muted = false;
                video.dataset.initialState = 'false';
                muteBtn.textContent = '🔊';
                if (video.paused) video.play();
            } else {
                video.dataset.initialState = 'false';
                video.paused ? video.play() : video.pause();
            }
        });

        muteBtn.addEventListener('click', e => {
            if (e.ctrlKey) return;
            e.stopPropagation();
            video.muted = !video.muted;
            muteBtn.textContent = video.muted ? '🔇' : '🔊';
            video.dataset.initialState = 'false';
        });

        setupProgressBarEvents(progressBar, video, muteBtn);

    } else {
        const imgWrapper = document.createElement('div');
        imgWrapper.className = 'img-wrapper';

        createMediaFilenameEditor(blockData, block, imgWrapper, triggerSave);

        const img = document.createElement('img');
        img.src = src;
        img.className = 'media-content';
        imgWrapper.appendChild(img);
        block.appendChild(imgWrapper);
    }

    block.dataset.src = saveSrc; // 💡 强制把相对路径赋值回来！
    if (blockData.displayName) block.dataset.displayName = blockData.displayName;
}

/**
 * 设置进度条事件
 */
function setupProgressBarEvents(progressBar, video, muteBtn) {
    let isDragging = false;

    const seek = (e) => {
        const rect = progressBar.getBoundingClientRect();
        let percent = (e.clientX - rect.left) / rect.width;
        percent = Math.max(0, Math.min(1, percent));
        video.currentTime = percent * video.duration;

        if (video.muted) {
            video.muted = false;
            muteBtn.textContent = '🔊';
        }
    };

    progressBar.addEventListener('click', e => {
        if (e.ctrlKey) return;
        e.stopPropagation();
        seek(e);
    });

    progressBar.addEventListener('mousedown', e => {
        if (e.ctrlKey) return;
        e.stopPropagation();
        isDragging = true;
        seek(e);
    });

    document.addEventListener('mousemove', e => { if (isDragging) seek(e); });
    document.addEventListener('mouseup', () => { isDragging = false; });
}

/**
 * 渲染嵌入块
 */
function renderEmbedBlock(block, blockData) {
    const container = document.createElement('div');
    container.style.cssText = 'width:100%;height:100%;overflow:hidden';

    let html = blockData.content?.html || '';

    // 兼容性修复：如果嵌入代码中使用 // 协议（如 B 站），在 srcdoc 中会解析为 about:// 导致失效
    // 将其自动补全为 https://
    html = html.replace(/src="\/\//g, 'src="https://');

    // 安全增强：使用沙箱化的 iframe
    const frame = document.createElement('iframe');
    frame.style.cssText = 'width:100%;height:100%;border:none';
    // 增加 allow-same-origin 权限以支持某些第三方播放器的跨域逻辑
    frame.sandbox = 'allow-scripts allow-popups allow-forms allow-same-origin allow-presentation';

    frame.srcdoc = `<!DOCTYPE html><html style="height:100%;"><head><style>
        body { margin:0; padding:0; overflow:hidden; width:100%; height:100%; display: flex; flex-direction: column; }
        iframe { flex: 1; width:100%; height:100%; border:none; }
    </style></head><body>${html}</body></html>`;

    container.appendChild(frame);
    block.appendChild(container);
    block.dataset.embedHtml = blockData.content?.html || ''; // 保持原始数据不变，仅在渲染时替换
}

/**
 * 渲染 H5 块
 */
function renderH5Block(block, blockData, triggerSave) {
    const { h = '', c = '', j = '' } = blockData.content || {};

    const ui = document.createElement('div');
    ui.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%';
    ui.innerHTML = `
       <div class="h5-tabs">
          <div class="h5-tab" data-tab="preview" data-i18n="preview">${t('preview')}</div>
          <div class="h5-tab" data-tab="html">HTML</div>
          <div class="h5-tab" data-tab="css">CSS</div>
          <div class="h5-tab" data-tab="js">JS</div>
       </div>
       <div class="h5-content-area">
          <div class="h5-preview-layer active"><iframe sandbox="allow-scripts allow-popups allow-forms allow-modals allow-same-origin"></iframe></div>
          
          <div class="h5-editor-layer" data-type="html">
            <div class="h5-line-numbers"></div>
            <div class="h5-code-container">
                <pre aria-hidden="true"><code class="language-xml hljs"></code></pre>
                <textarea placeholder="HTML" spellcheck="false">${escapeHtml(h)}</textarea>
            </div>
          </div>
          
          <div class="h5-editor-layer" data-type="css">
            <div class="h5-line-numbers"></div>
            <div class="h5-code-container">
                <pre aria-hidden="true"><code class="language-css hljs"></code></pre>
                <textarea placeholder="CSS" spellcheck="false">${escapeHtml(c)}</textarea>
            </div>
          </div>
          
          <div class="h5-editor-layer" data-type="js">
            <div class="h5-line-numbers"></div>
            <div class="h5-code-container">
                <pre aria-hidden="true"><code class="language-javascript hljs"></code></pre>
                <textarea placeholder="JS" spellcheck="false">${escapeHtml(j)}</textarea>
            </div>
          </div>
       </div>
    `;
    block.appendChild(ui);

    const tabs = ui.querySelectorAll('.h5-tab');
    const layers = ui.querySelectorAll('.h5-editor-layer, .h5-preview-layer');
    const frame = ui.querySelector('iframe');

    const updateLineNumbers = (ta, ln) => {
        const lines = Math.max(ta.value.split('\n').length, 20);
        ln.innerHTML = Array.from({ length: lines }, (_, i) => i + 1).join('<br>');
    };

    const updateSyntaxHighlight = (ta, codeEl) => {
        let val = ta.value;
        if (val.endsWith('\n')) val += ' ';

        const lang = codeEl.className.match(/language-([a-z]+)/)?.[1] || 'plaintext';
        if (window.hljs) {
            try {
                codeEl.innerHTML = window.hljs.highlight(val, { language: lang }).value;
            } catch (e) {
                codeEl.textContent = val;
                window.hljs.highlightElement(codeEl);
            }
        } else {
            codeEl.textContent = val;
        }
    };

    ui.querySelectorAll('.h5-editor-layer').forEach(layer => {
        const ta = layer.querySelector('textarea');
        const ln = layer.querySelector('.h5-line-numbers');
        const pre = layer.querySelector('pre');
        const code = layer.querySelector('code');
        const container = layer.querySelector('.h5-code-container');

        updateLineNumbers(ta, ln);
        updateSyntaxHighlight(ta, code);

        ta.addEventListener('input', () => {
            updateLineNumbers(ta, ln);
            updateSyntaxHighlight(ta, code);
            triggerSave();
        });

        ta.addEventListener('scroll', () => {
            ln.scrollTop = ta.scrollTop;
            pre.scrollTop = ta.scrollTop;
            pre.scrollLeft = ta.scrollLeft;
        });

        ta.addEventListener('mousedown', e => e.stopPropagation());

        ta.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                const start = ta.selectionStart;
                const end = ta.selectionEnd;
                ta.value = ta.value.substring(0, start) + '  ' + ta.value.substring(end);
                ta.selectionStart = ta.selectionEnd = start + 2;
                ta.dispatchEvent(new Event('input'));
            }
        });

        setTimeout(() => new OverlayScrollbar(ta, container), 50);
    });

    const runPreview = () => {
        const _h = ui.querySelector('[data-type="html"] textarea').value;
        const _c = ui.querySelector('[data-type="css"] textarea').value;
        const _j = ui.querySelector('[data-type="js"] textarea').value;

        // 致命修复 2：防止用户代码里包含 </script> 导致外部 HTML 提早断裂报错
        const safeJs = _j.replace(/<\/script>/ig, '<\\/script>');

        const scrollbarStyles = `::-webkit-scrollbar{width:8px;height:8px;background:transparent}::-webkit-scrollbar-thumb{background:rgba(0,0,0,.2);border-radius:4px}*{scrollbar-width:thin;scrollbar-color:rgba(0,0,0,.2) transparent}`;
        frame.srcdoc = `<!DOCTYPE html><html><head><style>${scrollbarStyles}</style><style>${_c}</style></head><body>${_h}<script>${safeJs}<\/script></body></html>`;
    };

    tabs.forEach(t => t.onclick = e => {
        e.preventDefault();
        e.stopPropagation();
        tabs.forEach(x => x.classList.remove('active'));
        layers.forEach(l => l.classList.remove('active'));
        t.classList.add('active');

        if (t.dataset.tab === 'preview') {
            ui.querySelector('.h5-preview-layer').classList.add('active');
            runPreview(); // 每次切回预览标签时重新挂载和执行最新代码
        } else {
            const layer = ui.querySelector(`.h5-editor-layer[data-type="${t.dataset.tab}"]`);
            layer.classList.add('active');

            const ta = layer.querySelector('textarea');
            const pre = layer.querySelector('pre');
            pre.scrollTop = ta.scrollTop;
            pre.scrollLeft = ta.scrollLeft;
        }
    });

    runPreview();
    tabs[0].classList.add('active');
}


/**
 * 计算点击位置对应的光标位置
 */
function calculateCursorPosition(e, previewEl, textEl) {
    if (!document.caretRangeFromPoint) return -1;

    const range = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (!range) return -1;

    let lineEl = range.startContainer;
    if (lineEl.nodeType === 3) lineEl = lineEl.parentElement;

    while (lineEl && lineEl !== previewEl && !lineEl.dataset.srcLine) {
        lineEl = lineEl.parentElement;
    }

    if (!lineEl?.dataset.srcLine) return -1;

    const lineIndex = parseInt(lineEl.dataset.srcLine);
    const sourceLines = textEl.value.split('\n');
    if (lineIndex >= sourceLines.length) return -1;

    const sourceLine = sourceLines[lineIndex];

    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(lineEl);
    preCaretRange.setEnd(range.startContainer, range.startOffset);
    const visualOffset = preCaretRange.toString().length;

    const getVisualLen = (str) => str
        .replace(/^\s*[-#>]+\s+/, '')
        .replace(/^\s*-\s+/, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/~~([^~]+)~~/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .length;

    let bestK = 0;
    for (let k = 0; k <= sourceLine.length; k++) {
        if (getVisualLen(sourceLine.substring(0, k)) >= visualOffset) {
            bestK = k;
            break;
        }
    }

    let totalPos = 0;
    for (let i = 0; i < lineIndex; i++) {
        totalPos += sourceLines[i].length + 1;
    }

    return totalPos + bestK;
}

// ==================== 全局快捷键：组合选中的块为文件夹 ====================
document.addEventListener('keydown', (e) => {
    // 监听 Ctrl + G (Group)
    if (e.ctrlKey && e.key.toLowerCase() === 'g') {
        // 💡 致命修复：只要按下了 Ctrl+G，立刻无条件拦截浏览器的默认搜索框行为
        e.preventDefault();

        const selectedBlocks = getSelectedBlocks();
        if (selectedBlocks.size < 2) return; // 至少需要选中 2 个块才能成组

        // 如果用户正在输入文字，不要打断输入
        const active = document.activeElement;
        if (active && (['INPUT', 'TEXTAREA'].includes(active.tagName) || active.isContentEditable)) return;

        const blocks = Array.from(selectedBlocks);
        const container = blocks[0].parentElement;
        const card = container.closest('.post');

        if (!container) return;

        // 1. 计算所有选中块在当前画布上的绝对包围盒 (Bounding Box)
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        blocks.forEach(b => {
            const x = parseInt(b.style.left) || 0;
            const y = parseInt(b.style.top) || 0;
            const w = b.offsetWidth;
            const h = b.offsetHeight;

            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x + w > maxX) maxX = x + w;
            if (y + h > maxY) maxY = y + h;
        });

        // 2. 预留边缘内边距和文件夹头部的拖拽条空间
        const padding = 20;
        const headerOffset = 40;

        const folderData = {
            type: 'folder',
            x: minX - padding,
            y: minY - headerOffset,
            w: (maxX - minX) + padding * 2,
            h: (maxY - minY) + padding + headerOffset,
            children: [],
            isNew: true
        };

        // 3. 渲染出这个刚好包裹住它们的新文件夹
        const folderBlock = renderBlock(container, folderData, card, null);
        const innerContainer = folderBlock.querySelector('.folder-inner-container');

        // 4. 将选中的块转移到新文件夹内，并重新计算相对坐标
        blocks.forEach(b => {
            const blockRect = b.getBoundingClientRect();
            const parentRect = innerContainer.getBoundingClientRect();

            const scrollLeft = innerContainer.scrollLeft || 0;
            const scrollTop = innerContainer.scrollTop || 0;
            const newRelLeft = blockRect.left - parentRect.left + scrollLeft;
            const newRelTop = blockRect.top - parentRect.top + scrollTop;

            innerContainer.appendChild(b);
            b.style.left = newRelLeft + 'px';
            b.style.top = newRelTop + 'px';

            b.classList.remove('selected');
        });

        selectedBlocks.clear();

        // 5. 💡 增加安全气囊：防止排版算法崩溃导致后续的保存命令无法执行
        try {
            if (typeof reflowFolderContent === 'function') {
                const finalH = reflowFolderContent(folderBlock, folderData.w, folderData.h);
                if (finalH) folderBlock.style.height = finalH + 'px';
            }
        } catch (err) { console.error('排版失败，但强制放行保存', err); }

        updateContainerHeight(container);

        // 6. 💡 致命修复：双管齐下触发保存，确保数据瞬间落盘！
        container.dispatchEvent(new Event('input', { bubbles: true }));
        if (window.__scheduleSave) window.__scheduleSave(card);

        // 💡 加入 300ms 视觉延迟，等你看到文件夹生成后，它再发光
        setTimeout(() => {
            folderBlock.classList.remove('saving-pulse');
            void folderBlock.offsetWidth;
            folderBlock.classList.add('saving-pulse');
        }, 300);
    }
});

// ==================== 全局快捷键：智能粘贴剪贴板媒体文件 ====================
// 记录鼠标实时位置，以便在空白处粘贴时知道要把块放在哪
document.addEventListener('mousemove', e => {
    window.__lastMouseX = e.clientX;
    window.__lastMouseY = e.clientY;
});

// 在捕获阶段全局拦截粘贴事件
document.addEventListener('paste', async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    let fileItem = null;
    for (let i = 0; i < items.length; i++) {
        if (items[i].kind === 'file' && (items[i].type.startsWith('image/') || items[i].type.startsWith('video/'))) {
            fileItem = items[i];
            break; // 只处理检测到的第一个媒体文件
        }
    }

    if (!fileItem) return; // 如果不是媒体文件（比如是纯文本），直接放行，不干扰你的代码复制！

    // 💡 致命拦截：一旦确认是图片/视频，立刻截断浏览器的默认粘贴，防止它把图片转成巨型 base64 塞爆 HTML
    e.preventDefault();
    e.stopPropagation();

    const file = fileItem.getAsFile();
    if (!file) return;

    const isVideo = file.type.startsWith('video/');
    const type = isVideo ? 'video' : 'img';

    let ext = file.name.split('.').pop() || (isVideo ? 'mp4' : 'png');
    if (ext === 'blob' || !ext || ext === file.name) ext = isVideo ? 'mp4' : 'png';

    // 将文件读取为字节流
    const buffer = await file.arrayBuffer();
    const bytesArray = Array.from(new Uint8Array(buffer));

    try {
        // 调用 Rust 彻底写入本地磁盘
        const savedPath = await invoke('save_clipboard_file', { bytes: bytesArray, ext });
        const cleanPath = savedPath.replace(/\\/g, '/');

        // ======== 核心修复：获取媒体原始物理比例 ========
        const mediaUrl = URL.createObjectURL(file);
        let originW = 300, originH = 200;

        await new Promise((resolve) => {
            if (type === 'img') {
                const img = new Image();
                img.onload = () => {
                    originW = img.naturalWidth || 300;
                    originH = img.naturalHeight || 200;
                    resolve();
                };
                img.onerror = resolve;
                img.src = mediaUrl;
            } else {
                const vid = document.createElement('video');
                vid.onloadedmetadata = () => {
                    originW = vid.videoWidth || 300;
                    originH = vid.videoHeight || 200;
                    resolve();
                };
                vid.onerror = resolve;
                vid.src = mediaUrl;
            }
        });
        URL.revokeObjectURL(mediaUrl); // 释放内存

        // 计算等比缩放后的初始尺寸（限定初始最大宽度为 300px，防止原图太大塞满屏幕）
        let renderW = 300;
        let renderH = (originH / originW) * renderW;
        // ============================================

        // ==== 判断插入位置策略 ====
        const activeEl = document.activeElement;
        const isInput = activeEl && (activeEl.isContentEditable || activeEl.tagName === 'TEXTAREA');

        let targetCard = activeEl?.closest('.post');
        let textBlock = activeEl?.closest('.block-text');

        // 如果鼠标没有聚焦在任何输入框，试图寻找鼠标悬停的帖子
        if (!targetCard) {
            const mouseX = window.__lastMouseX ?? (window.innerWidth / 2);
            const mouseY = window.__lastMouseY ?? (window.innerHeight / 2);
            const hoverEl = document.elementFromPoint(mouseX, mouseY);
            targetCard = hoverEl?.closest('.post') || document.querySelector('.post');

            if (!targetCard) return; // 如果连帖子都没有，放弃操作
        }

        const flow = targetCard.querySelector('.editor-flow');

        if (textBlock && isInput) {
            // 场景 1：用户正在编辑文本块时粘贴 -> 插入 Markdown 媒体语法到光标处
            const mdInsert = isVideo
                ? `\n<video src="${cleanPath}" controls style="max-width:100%; border-radius:4px; margin:8px 0;"></video>\n`
                : `\n![粘贴的媒体](<${cleanPath}>)\n`;

            textBlock.dispatchEvent(new CustomEvent('insert-media', {
                detail: { content: mdInsert }
            }));
        } else {
            // 场景 2：用户在画布空白处粘贴 -> 直接生成一个新的独立图片/视频块
            const rect = flow.getBoundingClientRect();
            let x = (window.__lastMouseX ?? (window.innerWidth / 2)) - rect.left;
            let y = (window.__lastMouseY ?? (window.innerHeight / 2)) - rect.top;

            x = Math.max(20, x);
            y = Math.max(20, y);

            // 💡 致命修复：直接构造包含真实宽高的 blockData，绕过默认的正方形魔咒！
            const blockData = {
                type,
                isNew: true,
                src: cleanPath,
                w: renderW,
                h: renderH,
                aspect: originW / originH // 记录长宽比，以后拖拽改变大小也不会变形
            };

            // 手动执行渲染和收尾逻辑
            renderBlock(flow, blockData, targetCard, null);

            if (typeof updateContainerHeight === 'function') updateContainerHeight(flow);
            const newBlock = flow.lastElementChild;
            if (newBlock) setTimeout(() => newBlock.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);

            // 💡 致命修复：双管齐下触发保存，确保数据瞬间落盘！
            flow.dispatchEvent(new Event('input', { bubbles: true }));
            if (window.__scheduleSave) window.__scheduleSave(targetCard);

            // 💡 加入 300ms 视觉延迟，等图片渲染出来后，它再发光
            if (newBlock) {
                setTimeout(() => {
                    newBlock.classList.remove('saving-pulse');
                    void newBlock.offsetWidth;
                    newBlock.classList.add('saving-pulse');
                }, 300);
            }
        }
    } catch (err) {
        console.error("粘贴并保存文件失败", err);
    }
}, true); // 注意：最后的 true 表示在事件捕获阶段拦截，优先级最高！