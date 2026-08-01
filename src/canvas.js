/**
 * 画布控制模块（缩放、平移、框选）
 * @module canvas
 */

import { showConfirm } from './ui-components.js';

// 选中的块集合
let selectedBlocks = new Set();

/**
 * 获取 flow 的画布状态
 * @param {HTMLElement} flow - editor-flow 元素
 * @returns {Object} 画布状态 {scale, panX, panY}
 */
function getFlowState(flow) {
    if (!flow._canvasState) {
        flow._canvasState = { scale: 1, panX: 0, panY: 0 };
    }
    return flow._canvasState;
}

/**
 * 应用变换到 flow
 * @param {HTMLElement} flow - editor-flow 元素
 */
function applyTransform(flow) {
    const { scale, panX, panY } = getFlowState(flow);
    flow.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
}

/**
 * 初始化画布缩放和平移控制
 */
export function initCanvasControls() {
    const container = document.getElementById('feed-container');
    if (!container) return;

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

        // 计算缩放
        const factor = 1.1;
        const delta = e.deltaY > 0 ? (1 / factor) : factor;
        const oldScale = state.scale;
        const newScale = Math.min(11, Math.max(0.25, oldScale * delta));

        // 以鼠标位置为中心缩放
        const scaleRatio = newScale / oldScale;
        state.panX += mouseX * (1 - scaleRatio);
        state.panY += mouseY * (1 - scaleRatio);
        state.scale = newScale;

        applyTransform(flow);

        // 临时显示网格
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
    let panStart = { x: 0, y: 0 };
    let panInit = { x: 0, y: 0 };

    container.addEventListener('mousedown', (e) => {
        if (!e.ctrlKey || e.button !== 0) return;

        const flow = e.target.closest('.editor-flow');
        if (!flow) return;

        e.preventDefault();
        isPanning = true;
        panFlow = flow;
        panStart = { x: e.clientX, y: e.clientY };
        const state = getFlowState(flow);
        panInit = { x: state.panX, y: state.panY };

        flow.style.cursor = 'grabbing';
        flow.classList.add('dragging');
        window.isGlobalDragging = true;
    });

    document.addEventListener('mousemove', (e) => {
        if (!isPanning || !panFlow) return;

        const state = getFlowState(panFlow);
        state.panX = panInit.x + (e.clientX - panStart.x);
        state.panY = panInit.y + (e.clientY - panStart.y);
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

    // Ctrl + 双击重置
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

/**
 * 清除所有选中状态
 */
export function clearSelection() {
    selectedBlocks.forEach(b => b.classList.remove('selected'));
    selectedBlocks.clear();
}

/**
 * 获取当前选中的块
 * @returns {Set<HTMLElement>} 选中的块集合
 */
export function getSelectedBlocks() {
    return selectedBlocks;
}

/**
 * 初始化框选功能
 * @param {Object} handlers - 处理函数
 * @param {Function} handlers.updateContainerHeight - 更新容器高度
 * @param {Function} handlers.reflowFolderContent - 重排文件夹内容
 * @param {Function} handlers.scheduleSave - 调度保存
 * @param {Function} handlers.convertToLocalPath - 路径转换
 * @param {Function} handlers.invoke - Tauri 调用
 */
export function initSelectionBox(handlers = {}) {
    const container = document.getElementById('feed-container');
    if (!container) return;

    let isSelecting = false;
    let selectionBox = null;
    let selectionFlow = null;
    let startX = 0, startY = 0;

    // 计算相对于容器的坐标（考虑缩放）
    const getRelativeCoords = (e, targetFlow, scale) => {
        const rect = targetFlow.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) / scale,
            y: (e.clientY - rect.top) / scale
        };
    };

    container.addEventListener('mousedown', (e) => {
        if (e.ctrlKey || e.button !== 0) return;

        const mainFlow = e.target.closest('.editor-flow');
        if (!mainFlow) return;

        const clickedBlock = e.target.closest('.block');
        let targetContainer = mainFlow;
        let isFolderBack = false;

        if (clickedBlock) {
            // 特殊处理文件夹块的背景点击
            if (clickedBlock.classList.contains('block-folder') &&
                !e.target.closest('.block-handle, .resize-handle, .resize-handle-right, .folder-sidebar, .block-del')) {
                isFolderBack = true;
                targetContainer = clickedBlock.querySelector('.folder-inner-container');
                clearSelection();
            }

            if (!isFolderBack) {
                if (!clickedBlock.classList.contains('selected')) {
                    clearSelection();
                }
                return;
            }
        } else {
            clearSelection();
        }

        // 失去焦点
        document.activeElement?.blur?.();

        e.preventDefault();
        isSelecting = true;
        selectionFlow = targetContainer;

        const state = mainFlow._canvasState || { scale: 1 };
        const coords = getRelativeCoords(e, selectionFlow, state.scale);
        startX = coords.x;
        startY = coords.y;

        // 创建选框
        selectionBox = document.createElement('div');
        selectionBox.className = 'selection-box active';
        Object.assign(selectionBox.style, {
            left: startX + 'px',
            top: startY + 'px',
            width: '0',
            height: '0'
        });
        selectionFlow.appendChild(selectionBox);

        window.isGlobalDragging = true;
    });

    document.addEventListener('mousemove', (e) => {
        if (!isSelecting || !selectionBox || !selectionFlow) return;

        const mainFlow = selectionFlow.closest('.editor-flow');
        const state = mainFlow?._canvasState || { scale: 1 };
        const coords = getRelativeCoords(e, selectionFlow, state.scale);

        const left = Math.min(startX, coords.x);
        const top = Math.min(startY, coords.y);
        const width = Math.abs(coords.x - startX);
        const height = Math.abs(coords.y - startY);

        Object.assign(selectionBox.style, {
            left: left + 'px',
            top: top + 'px',
            width: width + 'px',
            height: height + 'px'
        });

        // 实时高亮
        const selRect = { left, top, right: left + width, bottom: top + height };
        const containerRect = selectionFlow.getBoundingClientRect();

        Array.from(selectionFlow.children).forEach(block => {
            if (!block.classList.contains('block')) return;

            const bRect = block.getBoundingClientRect();
            const bLeft = (bRect.left - containerRect.left) / state.scale;
            const bTop = (bRect.top - containerRect.top) / state.scale;
            const bRight = bLeft + bRect.width / state.scale;
            const bBottom = bTop + bRect.height / state.scale;

            const intersects = !(bRight < selRect.left || bLeft > selRect.right ||
                bBottom < selRect.top || bTop > selRect.bottom);

            block.classList.toggle('selected', intersects);
        });
    });

    document.addEventListener('mouseup', () => {
        if (isSelecting && selectionBox) {
            selectionFlow.querySelectorAll('.block.selected').forEach(block => {
                selectedBlocks.add(block);
            });

            selectionBox.remove();
            selectionBox = null;
            isSelecting = false;
            window.isGlobalDragging = false;
        }
    });

    // 键盘事件
    document.addEventListener('keydown', async (e) => {
        if (e.key === 'Escape') {
            clearSelection();
            return;
        }

        if ((e.key === 'Delete' || e.key === 'Backspace') && selectedBlocks.size > 0) {
            const activeTag = document.activeElement.tagName.toLowerCase();
            if (['input', 'textarea'].includes(activeTag) || document.activeElement.isContentEditable) {
                return;
            }

            e.preventDefault();

            const firstBlock = selectedBlocks.values().next().value;
            if (!firstBlock) return;

            const parent = firstBlock.parentElement;
            const isFolderInner = parent.classList.contains('folder-inner-container');
            const flow = firstBlock.closest('.editor-flow');
            const post = flow?.closest('.post');
            const count = selectedBlocks.size;

            const doDelete = async () => {
                const blocksToDelete = Array.from(selectedBlocks);
                clearSelection();

                for (const block of blocksToDelete) {
                    // 删除关联的媒体文件
                    if (block.dataset.src?.includes('uploads') && handlers.invoke && handlers.convertToLocalPath) {
                        try {
                            const localPath = handlers.convertToLocalPath(block.dataset.src);
                            await handlers.invoke('delete_media_file', { path: localPath });
                        } catch (err) { console.warn('删除媒体文件失败', err); }
                    }
                    block.remove();
                }

                if (isFolderInner && handlers.reflowFolderContent) {
                    const folderBlock = parent.parentElement;
                    const w = parseInt(folderBlock.style.width) || folderBlock.offsetWidth;
                    const h = parseInt(folderBlock.style.height) || folderBlock.offsetHeight;
                    const newH = handlers.reflowFolderContent(folderBlock, w, h);
                    if (newH) {
                        folderBlock.style.height = newH + 'px';
                        handlers.updateContainerHeight?.(flow);
                    }
                } else {
                    handlers.updateContainerHeight?.(flow);
                }

                handlers.scheduleSave?.(post);
            };

            showConfirm(`确定要删除选中的 ${count} 个块吗？`, window.innerWidth / 2, window.innerHeight / 2, doDelete);
        }
    });
}
