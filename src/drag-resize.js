/**
 * 拖拽和调整大小模块
 * @module drag-resize
 */

export function makeDraggable(el, handle, container, onEnd, context = {}) {
    const { selectedBlocks, reflowFolderContent, updateContainerHeight } = context;

    let isDragging = false;
    let startX, startY, startLeft, startTop;
    let minStartLeft, minStartTop; // 💡 新增：用于记录整个拖拽组的极值边界
    let groupOffsets = [];
    let originalContainer = container;

    let originalZIndex = '';
    let rafId = null;

    const onMouseMove = (e) => {
        if (!isDragging) return;
        if (rafId) cancelAnimationFrame(rafId);

        rafId = requestAnimationFrame(() => {
            let rawDx = e.clientX - startX;
            let rawDy = e.clientY - startY;

            // 💡 致命修复：防止向上/向左越界！
            // 确保拖拽时，无论选中了多少个块，最边缘的块坐标绝不会小于 0
            if (minStartTop + rawDy < 0) rawDy = -minStartTop;
            if (minStartLeft + rawDx < 0) rawDx = -minStartLeft;

            let newLeft = startLeft + rawDx;
            let newTop = startTop + rawDy;

            const actualDx = newLeft - startLeft;
            const actualDy = newTop - startTop;

            el.style.left = newLeft + 'px';
            el.style.top = newTop + 'px';

            if (el.classList.contains('selected') && selectedBlocks?.size > 1) {
                groupOffsets.forEach(item => {
                    if (item.block !== el) {
                        item.block.style.left = (item.startLeft + actualDx) + 'px';
                        item.block.style.top = (item.startTop + actualDy) + 'px';
                    }
                });
            }

            // 拖出判断
            if (container.classList.contains('folder-inner-container')) {
                const folderBlock = container.closest('.block-folder');
                if (folderBlock) {
                    const folderRect = folderBlock.getBoundingClientRect();
                    const BUFFER = 30;

                    if (e.clientX < folderRect.left - BUFFER || e.clientX > folderRect.right + BUFFER ||
                        e.clientY < folderRect.top - BUFFER || e.clientY > folderRect.bottom + BUFFER) {

                        const parentContainer = folderBlock.parentElement;
                        if (parentContainer?.classList.contains('editor-flow') || parentContainer?.classList.contains('folder-inner-container')) {
                            reparentElement(el, parentContainer, e);
                            container = parentContainer;
                            if (groupOffsets.length > 0) groupOffsets = [];
                        }
                    }
                }
            }
            // 拖入判断
            else if (container.classList.contains('editor-flow')) {
                const folders = Array.from(container.children).filter(
                    child => child.classList.contains('block-folder') && child !== el
                );

                for (const folder of folders) {
                    const folderRect = folder.getBoundingClientRect();
                    const PADDING = 20;

                    if (e.clientX > folderRect.left + PADDING && e.clientX < folderRect.right - PADDING &&
                        e.clientY > folderRect.top + PADDING && e.clientY < folderRect.bottom - PADDING) {

                        const innerContainer = folder.querySelector('.folder-inner-container');
                        if (innerContainer) {
                            reparentElement(el, innerContainer, e);
                            container = innerContainer;
                            if (groupOffsets.length > 0) groupOffsets = [];
                            break;
                        }
                    }
                }
            }
        });
    };

    const reparentElement = (element, newParent, e) => {
        const blockRect = element.getBoundingClientRect();
        const parentRect = newParent.getBoundingClientRect();
        const scrollLeft = newParent.scrollLeft || 0;
        const scrollTop = newParent.scrollTop || 0;

        const newRelLeft = blockRect.left - parentRect.left + scrollLeft;
        const newRelTop = blockRect.top - parentRect.top + scrollTop;

        newParent.appendChild(element);
        element.style.left = newRelLeft + 'px';
        element.style.top = newRelTop + 'px';

        startX = e.clientX;
        startY = e.clientY;
        startLeft = newRelLeft;
        startTop = newRelTop;

        // 💡 跨容器后，重置边界极值
        minStartLeft = startLeft;
        minStartTop = startTop;
    };

    const onMouseUp = (e) => {
        if (!isDragging) return;
        if (rafId) cancelAnimationFrame(rafId);

        isDragging = false;

        // 💡 致命修复 2：用 pointer-events 替代 display，让鼠标在探测时“穿透”元素。
        // 这样不会重置盒模型，也就绝不会打断 CSS 的 Hover 状态过渡动画！
        const pointerBackup = el.style.pointerEvents;
        el.style.pointerEvents = 'none';
        const dropTarget = document.elementFromPoint(e.clientX, e.clientY);
        el.style.pointerEvents = pointerBackup;

        const textBlock = dropTarget?.closest('.block-text');
        let isInserted = false;

        if (textBlock && el !== textBlock) {
            let mdInsert = '';
            if (el.classList.contains('block-img')) {
                const src = (el.dataset.src || '').replace(/\\/g, '/');
                const name = el.dataset.displayName || src.split('/').pop() || 'image';
                mdInsert = `\n![${name}](<${src}>)\n`;
            } else if (el.classList.contains('block-video')) {
                const src = (el.dataset.src || '').replace(/\\/g, '/');
                mdInsert = `\n<video src="${src}" controls style="max-width:100%; border-radius:4px; margin:8px 0;"></video>\n`;
            } else if (el.classList.contains('block-embed')) {
                const html = el.dataset.embedHtml || '';
                mdInsert = `\n${html}\n`;
            }

            if (mdInsert) {
                textBlock.dispatchEvent(new CustomEvent('insert-media', {
                    detail: { content: mdInsert }
                }));
                isInserted = true;
            }
        }

        if (isInserted) {
            el.remove();
            document.body.style.cursor = '';
            handle.style.cursor = 'grab';
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            window.isGlobalDragging = false;
            groupOffsets = [];
            updateContainerHeight?.(originalContainer);
            onEnd?.();
            return;
        }

        el.style.zIndex = originalZIndex;
        document.body.style.cursor = '';
        handle.style.cursor = 'grab';

        el.classList.remove('dragging');
        container?.classList.remove('dragging');
        if (originalContainer !== container) originalContainer?.classList.remove('dragging');

        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        [container, originalContainer].forEach(c => {
            c?.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = '');
        });

        window.isGlobalDragging = false;
        groupOffsets = [];
        onEnd?.();

        if (container !== originalContainer) {
            if (originalContainer.classList.contains('folder-inner-container')) {
                const folderBlock = originalContainer.closest('.block-folder');
                if (folderBlock && reflowFolderContent) {
                    const h = reflowFolderContent(folderBlock, folderBlock.offsetWidth);
                    folderBlock.style.height = h + 'px';
                }
            }
            if (container.classList.contains('folder-inner-container')) {
                const folderBlock = container.closest('.block-folder');
                if (folderBlock && reflowFolderContent) {
                    const h = reflowFolderContent(folderBlock, folderBlock.offsetWidth);
                    folderBlock.style.height = h + 'px';
                }
            } else {
                updateContainerHeight?.(container);
            }
            if (originalContainer.classList.contains('editor-flow')) updateContainerHeight?.(originalContainer);
        } else {
            if (container.classList.contains('folder-inner-container')) {
                const folderBlock = container.closest('.block-folder');
                if (folderBlock && reflowFolderContent) {
                    const h = reflowFolderContent(folderBlock, folderBlock.offsetWidth);
                    folderBlock.style.height = h + 'px';
                }
            } else {
                updateContainerHeight?.(container);
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

        // 💡 记录起始时的最小边界
        minStartLeft = startLeft;
        minStartTop = startTop;

        if (el.parentElement) {
            container = el.parentElement;
            originalContainer = container;
        }

        if (el.classList.contains('selected') && selectedBlocks?.size > 1) {
            groupOffsets = Array.from(selectedBlocks).map(block => {
                const sl = parseInt(block.style.left) || 0;
                const st = parseInt(block.style.top) || 0;

                // 💡 如果拖拽的是个群组，找出整个群组中最靠上和最靠左的极值
                if (sl < minStartLeft) minStartLeft = sl;
                if (st < minStartTop) minStartTop = st;

                return { block, startLeft: sl, startTop: st };
            });
        }

        el.classList.add('dragging');
        container.classList.add('dragging');
        document.body.style.cursor = 'grabbing';
        handle.style.cursor = 'grabbing';

        originalZIndex = el.style.zIndex;
        el.style.zIndex = 100;

        container.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = 'none');
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}

export function makeResizable(el, handle, container, onEnd, resizeMode = 'both', context = {}) {
    const { reflowFolderContent, updateContainerHeight } = context;

    let isResizing = false;
    let startX, startY, initialW, initialH;
    let rafId = null; // 修复：性能优化
    let originalZIndex = '';

    const minSizes = {
        'block-folder': { w: 300, h: 300 },
        'h5-block': { w: 200, h: 200 },
        'block-embed': { w: 200, h: 200 },
        default: { w: 100, h: 50 }
    };

    const getMinSize = (element) => {
        for (const [className, size] of Object.entries(minSizes)) {
            if (className !== 'default' && element.classList.contains(className)) return size;
        }
        return minSizes.default;
    };

    const onMouseMove = (e) => {
        if (!isResizing) return;
        if (rafId) cancelAnimationFrame(rafId);

        rafId = requestAnimationFrame(() => {
            let dx = e.clientX - startX;
            let dy = e.clientY - startY;

            if (resizeMode === 'width') dy = 0;
            if (resizeMode === 'height') dx = 0;

            let newW = initialW + dx;
            let newH = initialH + dy;

            if (el.classList.contains('block-img') || el.classList.contains('block-video')) {
                const ratio = initialW / initialH;
                if (resizeMode === 'width') newH = newW / ratio;
                else if (resizeMode === 'height') newW = newH * ratio;
                else {
                    if (Math.abs(dx) > Math.abs(dy)) newH = newW / ratio;
                    else newW = newH * ratio;
                }
                const minSize = 200;
                const isTall = ratio < 1;

                if (isTall && newW < minSize) {
                    newW = minSize;
                    newH = newW / ratio;
                } else if (!isTall && newH < minSize) {
                    newH = minSize;
                    newW = newH * ratio;
                }
            } else {
                const min = getMinSize(el);
                newW = Math.max(min.w, newW);
                newH = Math.max(min.h, newH);
            }

            if (el.classList.contains('block-folder') && reflowFolderContent) {
                reflowFolderContent(el, newW, newH);
            }

            el.style.width = newW + 'px';
            if (resizeMode !== 'width') el.style.height = newH + 'px';
            updateContainerHeight?.(container);
        });
    };

    const onMouseUp = () => {
        if (!isResizing) return;
        if (rafId) cancelAnimationFrame(rafId);

        if (el.classList.contains('block-folder') && reflowFolderContent) {
            el.classList.remove('resizing');
            const naturalH = reflowFolderContent(el, parseInt(el.style.width), el.offsetHeight);
            if (naturalH) {
                el.style.height = naturalH + 'px';
                reflowFolderContent(el, parseInt(el.style.width), naturalH);
                updateContainerHeight?.(container);
            }
        }

        isResizing = false;
        el.classList.remove('resizing');
        el.style.zIndex = originalZIndex; // 修复：恢复
        el.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = '');
        document.body.style.userSelect = '';

        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        window.isGlobalDragging = false;
        onEnd?.();
    };

    handle.addEventListener('mousedown', e => {
        if (e.ctrlKey) return;
        e.stopPropagation();
        e.preventDefault();

        isResizing = true;
        if (el.classList.contains('block-folder')) el.classList.add('resizing');

        window.isGlobalDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        initialW = el.offsetWidth;
        initialH = el.offsetHeight;

        originalZIndex = el.style.zIndex;
        el.style.zIndex = 100;

        el.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = 'none');
        document.body.style.userSelect = 'none';

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}

export function updateContainerHeight(container) {
    if (container.classList.contains('folder-inner-container')) return;

    let maxBottom = 400;
    Array.from(container.children).forEach(block => {
        const top = parseInt(block.style.top) || 0;
        const h = parseInt(block.style.height) || 0;
        maxBottom = Math.max(maxBottom, top + h);
    });
    container.style.height = (maxBottom + 100) + 'px';
}