/**
 * 视频/媒体优化模块
 * @module media
 */

// 可见视频集合
let visibleVideos = new Set();

// 观察器引用
let preloadObserver = null;
let playbackObserver = null;

/**
 * 获取可见视频集合
 * @returns {Set<HTMLVideoElement>} 可见视频集合
 */
export function getVisibleVideos() {
    return visibleVideos;
}

/**
 * 注册视频到观察器
 * @param {HTMLVideoElement} video - 视频元素
 */
export function observeVideo(video) {
    preloadObserver?.observe(video);
    playbackObserver?.observe(video);
}

/**
 * 从观察器中移除视频
 * @param {HTMLVideoElement} video - 视频元素
 */
export function unobserveVideo(video) {
    preloadObserver?.unobserve(video);
    playbackObserver?.unobserve(video);
    visibleVideos.delete(video);
}

/**
 * 初始化视频性能优化
 * - 预加载观察器：在视口附近加载/卸载视频资源
 * - 播放控制观察器：进入视口播放，离开暂停
 * - 视频控件自动隐藏
 */
export function initVideoOptimization() {
    const scrollRoot = document.querySelector('.main-scroll');

    // 1. 预加载观察器 - 负责资源加载/卸载
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
                    if (folder?.dataset.playbackSpeed) {
                        video.playbackRate = parseFloat(folder.dataset.playbackSpeed);
                    }
                }
            } else {
                // 离开预加载区域：卸载资源
                video.pause();
                if (video.src) {
                    video.removeAttribute('src');
                    video.load();
                }
            }
        });
    }, {
        root: scrollRoot,
        rootMargin: '200px 0px',
        threshold: 0.01
    });

    // 2. 播放控制观察器 - 负责播放/暂停
    playbackObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const video = entry.target;
            if (entry.isIntersecting) {
                visibleVideos.add(video);

                // 确保 src 已加载
                if (!video.src && video.dataset.src) {
                    video.src = video.dataset.src;
                    video.load();
                    const folder = video.closest('.block-folder');
                    if (folder?.dataset.playbackSpeed) {
                        video.playbackRate = parseFloat(folder.dataset.playbackSpeed);
                    }
                }

                video.play().catch(() => { });
            } else {
                visibleVideos.delete(video);
                video.pause();

                // 离开时强制静音
                if (!video.muted) {
                    video.muted = true;
                    video.dataset.initialState = 'true';
                    const btn = video.closest('.video-wrapper')?.querySelector('.video-mute-btn');
                    if (btn) btn.textContent = '🔇';
                }
            }
        });
    }, {
        root: scrollRoot,
        rootMargin: '0px',
        threshold: 0.3
    });

    // 3. 视频控件自动隐藏逻辑
    initVideoControlsAutoHide();
}

/**
 * 初始化视频控件自动隐藏
 * @private
 */
function initVideoControlsAutoHide() {
    // 显示控件
    const showControls = (wrapper) => {
        const controls = wrapper.querySelector('.video-controls');
        if (!controls) return;

        controls.style.opacity = '1';
        controls.style.pointerEvents = 'auto';

        clearTimeout(wrapper._hideTimer);
        wrapper._hideTimer = setTimeout(() => {
            controls.style.opacity = '0';
            controls.style.pointerEvents = 'none';
            wrapper._hideTimer = null;
        }, 2000);
    };

    // 隐藏控件
    const hideControls = (wrapper) => {
        const controls = wrapper.querySelector('.video-controls');
        if (!controls) return;

        clearTimeout(wrapper._hideTimer);
        wrapper._hideTimer = null;
        controls.style.opacity = '0';
        controls.style.pointerEvents = 'none';
    };

    // 进入视频区域
    document.addEventListener('mouseover', (e) => {
        const wrapper = e.target.closest('.video-wrapper');
        if (!wrapper) return;

        // 确保是从外部进入
        if (!e.relatedTarget || !wrapper.contains(e.relatedTarget)) {
            showControls(wrapper);
        }
    }, true);

    // 在视频内移动
    document.addEventListener('mousemove', (e) => {
        const wrapper = e.target.closest('.video-wrapper');
        if (!wrapper) return;

        const controls = wrapper.querySelector('.video-controls');
        if (!controls) return;

        const rect = wrapper.getBoundingClientRect();
        const bottomThreshold = 45;
        const inBottomArea = e.clientY >= rect.bottom - bottomThreshold;
        const onControls = e.target.closest('.video-controls');

        if (inBottomArea || onControls) {
            // 在控件区域：保持显示
            controls.style.opacity = '1';
            controls.style.pointerEvents = 'auto';
            clearTimeout(wrapper._hideTimer);
            wrapper._hideTimer = null;
        } else if (controls.style.opacity === '1') {
            // 在上方区域且控件可见：重置计时器
            clearTimeout(wrapper._hideTimer);
            wrapper._hideTimer = setTimeout(() => {
                controls.style.opacity = '0';
                controls.style.pointerEvents = 'none';
                wrapper._hideTimer = null;
            }, 500);
        }
    });

    // 离开视频区域
    document.addEventListener('mouseout', (e) => {
        const wrapper = e.target.closest('.video-wrapper');
        if (wrapper && (!e.relatedTarget || !wrapper.contains(e.relatedTarget))) {
            hideControls(wrapper);
        }
    }, true);
}

/**
 * 创建视频控件 HTML
 * @param {HTMLVideoElement} video - 视频元素
 * @returns {HTMLElement} 控件容器
 */
export function createVideoControls(video) {
    const controls = document.createElement('div');
    controls.className = 'video-controls';

    // 进度条
    const progress = document.createElement('div');
    progress.className = 'video-progress';
    const progressFill = document.createElement('div');
    progressFill.className = 'video-progress-fill';
    progress.appendChild(progressFill);

    // 时间显示
    const time = document.createElement('div');
    time.className = 'video-time';
    time.textContent = '0:00';

    // 静音按钮
    const muteBtn = document.createElement('button');
    muteBtn.className = 'video-mute-btn';
    muteBtn.textContent = video.muted ? '🔇' : '🔊';

    controls.append(progress, time, muteBtn);

    // 事件绑定
    video.addEventListener('timeupdate', () => {
        if (video.duration) {
            progressFill.style.width = (video.currentTime / video.duration * 100) + '%';
            const mins = Math.floor(video.currentTime / 60);
            const secs = Math.floor(video.currentTime % 60).toString().padStart(2, '0');
            time.textContent = `${mins}:${secs}`;
        }
    });

    progress.addEventListener('click', (e) => {
        e.stopPropagation();
        const rect = progress.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        video.currentTime = video.duration * percent;
    });

    muteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        video.muted = !video.muted;
        muteBtn.textContent = video.muted ? '🔇' : '🔊';
        // 清除初始状态标记
        delete video.dataset.initialState;
    });

    return controls;
}
