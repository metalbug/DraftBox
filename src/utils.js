/**
 * 通用工具函数模块
 * @module utils
 */

export const core = window.__TAURI__?.core || {};
export const { invoke } = core;
export const convertFileSrc = core.convertFileSrc || (p => p);

export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

export function convertLocalPath(path) {
    if (!path) return '';
    return convertFileSrc(path);
}

export function convertToLocalPath(path) {
    if (!path) return '';
    try {
        if (path.startsWith('asset://') || path.includes('asset.localhost')) {
            const url = new URL(path);
            let localPath = decodeURIComponent(url.pathname);
            // 修复：处理 Windows 绝对路径前的斜杠 (例如 /C:/path -> C:/path)
            if (localPath.match(/^\/[a-zA-Z]:\//)) {
                localPath = localPath.slice(1);
            }
            return localPath;
        }
    } catch (e) {
        console.warn('路径解析失败，回退至原始路径:', e);
    }
    return path;
}

export function measureMedia(src, type) {
    return new Promise((resolve, reject) => {
        if (type === 'img') {
            const img = new Image();
            img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
            img.onerror = reject;
            img.src = src;
        } else {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.onloadedmetadata = () => {
                resolve({ w: video.videoWidth, h: video.videoHeight });
                video.src = '';
                video.load();
            };
            video.onerror = (e) => {
                video.src = '';
                reject(e);
            };
            video.src = src;
        }
    });
}

export function scaleToFit(origW, origH, maxW, maxH) {
    if (origW <= maxW && origH <= maxH) {
        return { w: origW, h: origH };
    }
    const ratio = Math.min(maxW / origW, maxH / origH);
    return {
        w: Math.round(origW * ratio),
        h: Math.round(origH * ratio)
    };
}

export function checkBlockHasContent(block) {
    if (block.classList.contains('block-text')) {
        const ta = block.querySelector('textarea');
        return ta && ta.value.trim().length > 0;
    }
    if (block.classList.contains('block-img') || block.classList.contains('block-video')) {
        return !!block.dataset.src;
    }
    if (block.classList.contains('h5-block')) {
        const tas = block.querySelectorAll('.h5-editor-layer textarea');
        for (const ta of tas) {
            if (ta.value.trim().length > 0) return true;
        }
        return false;
    }
    if (block.classList.contains('block-embed')) {
        return !!block.dataset.embedHtml;
    }
    if (block.classList.contains('block-folder')) {
        return block.querySelectorAll('.folder-inner-container > .block').length > 0;
    }
    return true;
}

export function snapToGrid(value, gridSize = 20) {
    return Math.round(value / gridSize) * gridSize;
}

export function debounce(fn, delay) {
    let timer = null;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

export function throttle(fn, limit) {
    let inThrottle = false;
    return function (...args) {
        if (!inThrottle) {
            fn.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}