/**
 * 博客应用入口文件
 * @description 模块化架构的协调入口
 */

// ==================== 模块导入 ====================
import { initThemeToggle } from './modules/theme.js';
import { OverlayScrollbar, initScrollbars } from './modules/scrollbar.js';
import { initFloatingToolbar } from './modules/text-editor.js';
import { initSidebarEvents, renderSidebar, renderTagCloud } from './modules/sidebar.js';
import { initGoToTopButton } from './modules/go-to-top.js';
import { initConfirmDialog } from './modules/confirm.js';
import { initFloatMenu } from './modules/float-menu.js';
import { initCanvasControls, initSelectionBox, getSelectedBlocks, clearSelection } from './modules/canvas.js';
import { initVideoOptimization, observeVideo, unobserveVideo } from './modules/media.js';
import { reflowFolderContent, addFolderBlock } from './modules/folder.js';
import { makeDraggable, makeResizable, updateContainerHeight } from './modules/drag-resize.js';
import { invoke, convertFileSrc, convertToLocalPath, measureMedia } from './modules/utils.js';
import { initWindowControls } from './modules/window-controls.js';
import { renderBlock, addBlock, scheduleSave, calcBlockPosition, scrollToNewBlock } from './modules/blocks.js';
import {
    initPostsModule,
    initPostVirtualization,
    loadPosts,
    createNewPost,
    mapFolderToPost,
    confirmDeletePost,
    savePost,
    getAllPosts
} from './modules/posts.js';

// ==================== 全局状态 ====================
window.isGlobalDragging = false;

// ==================== 帖子模块初始化 ====================
initPostsModule({
    renderBlock: (container, blockData, card) => renderBlock(container, blockData, card, savePost),
    updateContainerHeight,
    reflowFolderContent,
    renderSidebar,
    renderTagCloud,
    addBlock: (container, type, content, card) => addBlock(container, type, content, card, null, savePost),
    observeVideo,
    unobserveVideo
});

// ==================== 浮动菜单处理器 ====================
const floatMenuHandlers = {
    onAddBlock: (type, flow, card, insertPos) => {
        type === 'h5'
            ? addBlock(flow, 'h5', null, card, insertPos, savePost)
            : addBlock(flow, type, '', card, insertPos, savePost);
    },
    onUpload: async (flow, card, insertPos) => {
        try {
            const paths = await invoke("upload_media");
            if (paths?.length) {
                if (paths.length === 1) {
                    await addSmartBlock(flow, paths[0], card, insertPos);
                } else {
                    await handleAddFolderBlock(flow, paths, card, insertPos);
                }
            }
        } catch (e) { console.error(e); }
    },
    onAddSmartBlock: async (flow, url, card, insertPos) => {
        await addSmartBlockFromUrl(flow, url, card, insertPos);
    },
    onDelete: (card, e) => confirmDeletePost(card, e),

    onMapFolder: (card) => mapFolderToPost(card, handleAddFolderBlock)
};

// ==================== 辅助函数 ====================

/**
 * 智能添加块（根据文件类型自动判断）
 */
async function addSmartBlock(container, filePath, card, insertPos) {
    const ext = filePath.split('.').pop().toLowerCase();
    const imgs = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
    const videos = ['mp4', 'webm', 'mov', 'avi'];

    if (imgs.includes(ext) || videos.includes(ext)) {
        const type = imgs.includes(ext) ? 'img' : 'video';
        try {
            const src = convertFileSrc(filePath);
            const size = await measureMedia(src, type);
            const blockData = { type, src: filePath, w: size.w, h: size.h, isNew: true };

            // 按比例缩放
            const MAX_W = 500, MAX_H = 600;
            if (size.w > MAX_W || size.h > MAX_H) {
                const ratio = Math.min(MAX_W / size.w, MAX_H / size.h);
                blockData.w = Math.round(size.w * ratio);
                blockData.h = Math.round(size.h * ratio);
            }

            calcBlockPosition(container, blockData, insertPos);
            renderBlock(container, blockData, card, savePost);
            updateContainerHeight(container);
            scheduleSave(card, savePost);
            scrollToNewBlock(container);
        } catch {
            addBlock(container, type, { src: filePath }, card, insertPos, savePost);
        }
    } else {
        addBlock(container, 'text', `[${filePath.split(/[/\\]/).pop()}](file://${filePath})`, card, insertPos, savePost);
    }
}

/**
 * 添加文件夹块的封装
 */
async function handleAddFolderBlock(container, files, card, insertPos, width = null) {
    await addFolderBlock(container, files, card, insertPos, width, {
        renderBlock: (c, data, ca) => renderBlock(c, data, ca, savePost),
        updateContainerHeight,
        scrollToNewBlock,
        calcBlockPosition,
        scheduleSave: (c) => scheduleSave(c, savePost)
    });
}

/**
 * 根据URL智能添加块（图片/视频/嵌入）
 */
async function addSmartBlockFromUrl(container, url, card, insertPos) {
    const trimmed = url.trim();
    const lower = trimmed.toLowerCase();

    let type, content;

    // 识别类型
    if (trimmed.startsWith('<iframe')) {
        // 嵌入代码
        type = 'embed';
        content = { html: trimmed };
    } else if (/\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?.*)?$/i.test(lower)) {
        // 图片URL
        type = 'img';
    } else if (/\.(mp4|webm|mov|mkv)(\?.*)?$/i.test(lower)) {
        // 视频URL
        type = 'video';
    } else if (lower.includes('youtube.com') || lower.includes('youtu.be') ||
        lower.includes('bilibili.com') || lower.includes('vimeo.com')) {
        // 视频平台，尝试嵌入
        type = 'embed';
        content = { html: `<iframe src="${trimmed}" style="width:100%;height:100%;border:none" allowfullscreen></iframe>` };
    } else {
        // 默认作为嵌入
        type = 'embed';
        content = { html: `<iframe src="${trimmed}" style="width:100%;height:100%;border:none"></iframe>` };
    }

    // 计算尺寸
    let w = 400, h = 300;
    if (type === 'img' || type === 'video') {
        try {
            const size = await measureMedia(trimmed, type);
            w = size.w;
            h = size.h;
            // 按比例缩放
            const MAX_W = 500, MAX_H = 600;
            if (w > MAX_W || h > MAX_H) {
                const ratio = Math.min(MAX_W / w, MAX_H / h);
                w = Math.round(w * ratio);
                h = Math.round(h * ratio);
            }
        } catch {
            w = 300; h = 200;
        }
    }

    const blockData = { type, w, h, isNew: true };

    if (type === 'embed') {
        blockData.content = content;
    } else {
        blockData.src = trimmed;
    }

    calcBlockPosition(container, blockData, insertPos);
    renderBlock(container, blockData, card, savePost);
    updateContainerHeight(container);
    scheduleSave(card, savePost);
    scrollToNewBlock(container);
}

// ==================== 应用初始化 ====================

document.addEventListener('DOMContentLoaded', async () => {
    // 1. 基础 UI 初始化
    initThemeToggle();
    initScrollbars();
    initSidebarEvents();
    initGoToTopButton();
    initConfirmDialog();
    initWindowControls();

    // 2. 帖子虚拟化
    initPostVirtualization();

    // 3. 浮动菜单
    initFloatMenu(floatMenuHandlers);

    // 4. 富文本工具栏
    initFloatingToolbar();

    // 5. 视频优化
    initVideoOptimization();

    // 6. 画布控制（缩放、平移、框选）
    initCanvasControls({
        reflowFolderContent,
        updateContainerHeight
    });

    initSelectionBox({
        invoke,
        convertToLocalPath,
        reflowFolderContent,
        updateContainerHeight,
        scheduleSave: (card) => scheduleSave(card, savePost)
    });

    // 7. 头部按钮事件
    document.getElementById('btn-create-new')?.addEventListener('click', createNewPost);

    // 8. 搜索功能
    const searchInput = document.getElementById('search-input');
    searchInput?.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase().trim();
        const posts = getAllPosts();

        // 过滤帖子
        const filtered = q
            ? posts.filter(p => {
                const story = p.story || '';
                const tags = p.tags || '';
                return story.toLowerCase().includes(q) || tags.toLowerCase().includes(q);
            })
            : posts;

        // 更新侧边栏
        renderSidebar(filtered);

        // 过滤主区域显示
        const container = document.getElementById('feed-container');
        if (container) {
            const filteredIds = new Set(filtered.map(p => String(p.id)));
            container.querySelectorAll('.post').forEach(postEl => {
                const isMatch = filteredIds.has(postEl.dataset.id);
                postEl.style.display = isMatch ? '' : 'none';
            });
        }
    });

    // 9. 快捷键
    document.addEventListener('keydown', (e) => {
        // Ctrl + N: 新建帖子
        if (e.ctrlKey && e.key === 'n') {
            e.preventDefault();
            createNewPost();
        }
    });

    // 10. 加载帖子数据
    await loadPosts();

    // 11. 显示窗口（在配置中设为 visible: false，初始化后再显示以避免闪烁）
    const tauri = window.__TAURI__;
    if (tauri && tauri.window) {
        const appWindow = tauri.window.getCurrentWindow();
        await appWindow.show();
    }

    console.log('✨ 博客应用初始化完成');
});

// ==================== 全局导出（供调试） ====================
if (import.meta.env?.DEV) {
    window.__DEBUG__ = {
        getAllPosts,
        getSelectedBlocks,
        clearSelection
    };
}
