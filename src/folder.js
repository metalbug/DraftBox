/**
 * 文件夹块布局模块
 * @module folder
 */

import { invoke, convertFileSrc as convertLocalPath, convertToLocalPath, measureMedia } from './utils.js';

// 布局常量
const PADDING = 20;
const GAP = 20;

/**
 * 计算文件夹布局（纯数据计算，不操作 DOM）
 * @param {Array} items - 项目数组，每项需包含 aspect
 * @param {number} containerWidth - 容器宽度
 * @param {number} containerHeight - 容器高度
 * @param {number} targetItemWidth - 目标单项宽度（控制密度）
 * @returns {Object} 布局结果 {height, totalNaturalHeight, children}
 */
export function calculateFolderLayout(items, containerWidth, containerHeight, targetItemWidth = 300) {
    const N = items.length;

    // 确保每项有 aspect
    const pool = items.map(item => ({
        ...item,
        aspect: item.aspect || (item.w / item.h) || 1
    }));

    const contentWidth = containerWidth - 2 * PADDING;
    if (contentWidth <= 0) {
        return { height: containerHeight, totalNaturalHeight: 2 * PADDING, children: [] };
    }

    const totalAspect = pool.reduce((sum, item) => sum + item.aspect, 0);

    // 估算行数（基于列密度）
    let cols = Math.max(1, Math.round(contentWidth / targetItemWidth));
    let k = Math.max(1, Math.min(N, Math.ceil(N / cols)));

    const idealRowAspect = totalAspect / k;
    const rows = [];
    let currentItems = [...pool];

    // 贪心分行
    for (let r = 0; r < k; r++) {
        const currentRow = [];
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

    // 计算坐标
    const layoutItems = [];
    let currentY = PADDING;

    rows.forEach(row => {
        const n = row.items.length;
        const totalGapWidth = (n - 1) * GAP;
        const widthForImages = contentWidth - totalGapWidth;
        const rowAspectSum = row.items.reduce((s, i) => s + i.aspect, 0);
        row.height = widthForImages / rowAspectSum;

        let currentX = PADDING;
        row.items.forEach(item => {
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

    const totalH = rows.length > 0 ? (currentY - GAP + PADDING) : (2 * PADDING);

    return {
        height: containerHeight,
        totalNaturalHeight: totalH,
        children: layoutItems
    };
}

/**
 * 重排文件夹内容（应用布局到 DOM）
 * @param {HTMLElement} folderBlock - 文件夹块元素
 * @param {number} width - 宽度
 * @param {number} height - 高度（null 则自适应）
 * @returns {number} 自然高度
 */
export function reflowFolderContent(folderBlock, width, height) {
    const inner = folderBlock.querySelector('.folder-inner-container');
    if (!inner) return;

    // 收集子块信息
    const childrenEls = Array.from(inner.children).filter(el => el.classList.contains('block'));
    const items = childrenEls.map(el => {
        let aspect = parseFloat(el.dataset.aspect);

        if (!aspect || isNaN(aspect)) {
            const styleW = parseFloat(el.style.width);
            const styleH = parseFloat(el.style.height);
            aspect = (styleW && styleH) ? styleW / styleH :
                (el.offsetWidth && el.offsetHeight) ? el.offsetWidth / el.offsetHeight : 1;
            el.dataset.aspect = aspect;
        }

        return { element: el, aspect, w: 100, h: 100 };
    });

    if (items.length === 0) return;

    const isAutoHeight = !height;
    const layoutHeight = height || (width * 0.75);
    const targetItemWidth = parseInt(folderBlock.dataset.layoutSize) || 300;

    // 计算布局
    const result = calculateFolderLayout(items, width, layoutHeight, targetItemWidth);

    // 计算缩放因子
    let scaleFactor = 1;
    if (!isAutoHeight) {
        const contentNaturalH = result.totalNaturalHeight - 2 * PADDING;
        const contentTargetH = height - 2 * PADDING;
        if (contentNaturalH > 1) {
            scaleFactor = contentTargetH / contentNaturalH;
        }
    }

    // 应用样式
    result.children.forEach(childLayout => {
        if (!childLayout.element) return;

        const contentDiffY = childLayout.y - PADDING;
        const finalY = PADDING + contentDiffY * scaleFactor;
        const finalH = childLayout.h * scaleFactor;

        Object.assign(childLayout.element.style, {
            transform: `translate(${childLayout.x}px, ${finalY}px)`,
            width: childLayout.w + 'px',
            height: finalH + 'px',
            left: '0px',
            top: '0px'
        });
    });

    return result.totalNaturalHeight;
}

/**
 * 添加文件夹块
 * @param {HTMLElement} container - 容器元素
 * @param {Array} files - 文件路径数组
 * @param {HTMLElement} card - 帖子卡片元素
 * @param {Object} insertPos - 插入位置
 * @param {number} targetWidth - 目标宽度
 * @param {Object} handlers - 处理函数
 */
export async function addFolderBlock(container, files, card, insertPos, targetWidth = null, handlers = {}) {
    const { renderBlock, updateContainerHeight, scrollToNewBlock, calcBlockPosition, scheduleSave } = handlers;

    const FOLDER_W_OUTER = targetWidth || ((window.innerWidth - 100) * 0.5);
    const FOLDER_H_OUTER = 200;

    const folderBlockData = {
        type: 'folder',
        w: FOLDER_W_OUTER,
        h: FOLDER_H_OUTER,
        children: []
    };

    calcBlockPosition?.(container, folderBlockData, insertPos);

    const folderEl = renderBlock?.(container, folderBlockData, card);
    updateContainerHeight?.(container);
    scrollToNewBlock?.(container);

    const folderInner = folderEl?.querySelector('.folder-inner-container');
    if (!folderInner) return;

    // 文件类型处理映射
    const fileTypeHandlers = {
        img: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'],
        video: ['mp4', 'webm', 'mov', 'avi'],
        audio: ['mp3', 'wav', 'ogg', 'flac'],
        text: ['txt', 'md', 'json']
    };

    const getFileType = (ext) => {
        for (const [type, exts] of Object.entries(fileTypeHandlers)) {
            if (exts.includes(ext)) return type;
        }
        return null;
    };

    // 处理每个文件
    for (const filePath of files) {
        const ext = filePath.split('.').pop().toLowerCase();
        const fileType = getFileType(ext);
        let item = null;
        const src = convertLocalPath(filePath);

        switch (fileType) {
            case 'img':
            case 'video':
                try {
                    const size = await measureMedia(src, fileType === 'img' ? 'img' : 'video');
                    item = { type: fileType === 'img' ? 'img' : 'video', src: filePath, w: size.w, h: size.h, aspect: size.w / size.h };
                } catch {
                    item = { type: fileType === 'img' ? 'img' : 'video', src: filePath, w: 200, h: fileType === 'img' ? 200 : 150, aspect: fileType === 'img' ? 1 : 1.33 };
                }
                break;
            case 'audio':
                item = { type: 'video', src: filePath, w: 300, h: 80, aspect: 300 / 80 };
                break;
            case 'text':
                try {
                    const content = await invoke('read_text_file', { path: filePath });
                    const h = content.length > 500 ? 300 : 200;
                    item = { type: 'text', content, w: 300, h, aspect: 300 / h, src: filePath };
                } catch {
                    const fileName = filePath.split(/[/\\]/).pop();
                    item = { type: 'text', content: `📄 ${fileName}\n(无法读取内容)`, w: 200, h: 100, aspect: 2 };
                }
                break;
        }

        if (item) {
            renderBlock?.(folderInner, item, card);

            const currentW = parseInt(folderEl.style.width) || FOLDER_W_OUTER;
            const newH = reflowFolderContent(folderEl, currentW, null);
            if (newH) {
                folderEl.style.height = newH + 'px';
                updateContainerHeight?.(container);
            }
        }

        // 让事件循环有机会处理
        await new Promise(r => setTimeout(r, 10));
    }

    scheduleSave?.(card);
}

/**
 * 显示排序菜单
 * @param {MouseEvent} e - 鼠标事件
 * @param {HTMLElement} folderBlock - 文件夹块
 * @param {Function} triggerSave - 保存回调
 */
export function showSortMenu(e, folderBlock, triggerSave) {
    // 移除旧菜单
    document.querySelector('.sort-menu-popover')?.remove();

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

    Object.assign(menu.style, {
        left: (e.clientX - 100) + 'px',
        top: (e.clientY + 10) + 'px'
    });

    document.body.appendChild(menu);

    // 点击关闭
    setTimeout(() => {
        const close = () => {
            menu.remove();
            document.removeEventListener('click', close);
        };
        document.addEventListener('click', close);
    }, 0);
}

/**
 * 文件夹内容排序
 * @param {HTMLElement} folderBlock - 文件夹块
 * @param {string} criteria - 排序条件 (name|date|size|type)
 * @param {Function} triggerSave - 保存回调
 */
export async function sortFolderContent(folderBlock, criteria, triggerSave) {
    const inner = folderBlock.querySelector('.folder-inner-container');
    if (!inner) return;

    const childrenEls = Array.from(inner.children).filter(el => el.classList.contains('block'));
    if (childrenEls.length === 0) return;

    // 获取/切换排序顺序
    const prevSort = folderBlock.dataset.sortCriteria;
    let order = ['date', 'size'].includes(criteria) ? 'desc' : 'asc';

    if (prevSort === criteria) {
        order = folderBlock.dataset.sortOrder === 'asc' ? 'desc' : 'asc';
    }

    folderBlock.dataset.sortCriteria = criteria;
    folderBlock.dataset.sortOrder = order;

    // 收集信息
    const items = childrenEls.map(el => {
        let src = el.dataset.src || '';
        try { src = decodeURIComponent(src); } catch { }

        const name = el.dataset.displayName || src.split(/[/\\]/).pop() || '';
        const ext = name.split('.').pop().toLowerCase();

        return {
            element: el,
            name: name.toLowerCase(),
            type: ext,
            path: el.dataset.src ? convertToLocalPath(el.dataset.src) : null
        };
    });

    // 获取元数据
    if (['date', 'size'].includes(criteria)) {
        const paths = items.filter(i => i.path).map(i => i.path);
        if (paths.length > 0) {
            try {
                const metadata = await invoke('get_files_metadata', { paths });
                const metaMap = Object.fromEntries(metadata.map(m => [m.path, m]));

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
                console.error("获取文件元数据失败", err);
            }
        }
    }

    // 排序比较器映射
    const comparators = {
        name: (a, b) => a.name.localeCompare(b.name, 'zh-CN'),
        type: (a, b) => a.type !== b.type ? a.type.localeCompare(b.type) : a.name.localeCompare(b.name, 'zh-CN'),
        date: (a, b) => (a.modified || 0) - (b.modified || 0),
        size: (a, b) => (a.size || 0) - (b.size || 0)
    };

    items.sort((a, b) => {
        const cmp = comparators[criteria]?.(a, b) || 0;
        return order === 'asc' ? cmp : -cmp;
    });

    // DOM 重排
    items.forEach(item => inner.appendChild(item.element));

    // 重新布局
    const folderWidth = parseInt(folderBlock.style.width);
    const newHeight = reflowFolderContent(folderBlock, folderWidth, parseInt(folderBlock.style.height));

    if (newHeight) {
        folderBlock.style.height = newHeight + 'px';
    }

    triggerSave?.();
}
