/**
 * 文本编辑辅助模块
 * @module text-editor
 */
import { convertLocalPath, convertToLocalPath } from './utils.js';

export function toggleBold(el) { executeFormat(el, 'bold', '**'); }
export function toggleItalic(el) { executeFormat(el, 'italic', '*'); }
export function toggleStrikethrough(el) { executeFormat(el, 'strikethrough', '~~'); }
export function toggleInlineCode(el) { executeFormat(el, 'formatBlock', '`', '<code>'); }

/**
 * 通用执行函数
 */
function executeFormat(el, command, symbol, tag) {
    if (!el) return;
    if (el.isContentEditable) {
        if (command === 'formatBlock') {
            // 简单的包裹
            const selection = window.getSelection();
            if (!selection.rangeCount) return;
            const range = selection.getRangeAt(0);
            const sub = document.createElement(tag.replace(/[<>]/g, ''));
            if (tag === '<code>') sub.className = 'inline-code';
            sub.appendChild(range.extractContents());
            range.insertNode(sub);
        } else {
            document.execCommand(command, false, null);
        }
    } else {
        wrapText(el, symbol);
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
}

function wrapText(ta, symbol) {
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const val = ta.value;
    const selected = val.substring(start, end);
    const before = val.substring(0, start);
    const after = val.substring(end);

    const len = symbol.length;
    if (before.endsWith(symbol) && after.startsWith(symbol)) {
        ta.value = before.slice(0, -len) + selected + after.slice(len);
        ta.setSelectionRange(start - len, end - len);
    } else {
        ta.value = before + symbol + selected + symbol + after;
        ta.setSelectionRange(start + len, end + len);
    }
    ta.focus();
}

/**
 * 切换光标所在行的标题级别 (H1 -> H2 -> H3 -> Normal)
 * @param {HTMLTextAreaElement|HTMLElement} el - 文本域元素或可视化层
 */
export function toggleHeading(el) {
    if (!el) return;
    if (el.isContentEditable) {
        const selection = window.getSelection();
        const base = selection.anchorNode.parentElement;
        const tag = base.tagName;
        let nextTag = 'P';
        if (tag === 'P' || tag === 'DIV') nextTag = 'H1';
        else if (tag === 'H1') nextTag = 'H2';
        else if (tag === 'H2') nextTag = 'H3';
        else nextTag = 'P';
        document.execCommand('formatBlock', false, nextTag);
    } else {
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const val = el.value;
        let lineStart = val.lastIndexOf('\n', start - 1);
        lineStart = lineStart === -1 ? 0 : lineStart + 1;
        let lineEnd = val.indexOf('\n', end);
        if (lineEnd === -1) lineEnd = val.length;
        const lineContent = val.substring(lineStart, lineEnd);
        let newLineContent, offsetChange = 0;
        if (lineContent.startsWith('### ')) { newLineContent = lineContent.substring(4); offsetChange = -4; }
        else if (lineContent.startsWith('## ')) { newLineContent = '#' + lineContent; offsetChange = 1; }
        else if (lineContent.startsWith('# ')) { newLineContent = '#' + lineContent; offsetChange = 1; }
        else { newLineContent = '# ' + lineContent; offsetChange = 2; }
        el.value = val.substring(0, lineStart) + newLineContent + val.substring(lineEnd);
        el.setSelectionRange(Math.max(lineStart, start + offsetChange), Math.max(lineStart, end + offsetChange));
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * 切换列表 (无序 -> 有序 -> 取消)
 */
export function toggleList(el) {
    if (!el) return;
    if (el.isContentEditable) {
        const isUL = document.queryCommandState('insertUnorderedList');
        const isOL = document.queryCommandState('insertOrderedList');
        if (isUL) {
            document.execCommand('insertOrderedList', false, null); // 符号转编号
        } else if (isOL) {
            document.execCommand('insertOrderedList', false, null); // 再次执行取消编号
        } else {
            document.execCommand('insertUnorderedList', false, null); // 默认转符号
        }
    } else {
        // 源码模式支持
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const val = el.value;
        let lineStart = val.lastIndexOf('\n', start - 1);
        lineStart = lineStart === -1 ? 0 : lineStart + 1;
        let lineEnd = val.indexOf('\n', end);
        if (lineEnd === -1) lineEnd = val.length;

        const lines = val.substring(lineStart, lineEnd).split('\n');
        const isUL = lines.every(l => l.startsWith('- '));
        const isOL = lines.every(l => /^\d+\.\s/.test(l));

        const newLines = lines.map((l) => {
            if (isUL) return `1. ${l.substring(2)}`;
            if (isOL) return l.replace(/^\d+\.\s/, '');
            return `- ${l.replace(/^-\s|^\d+\.\s/, '')}`;
        });

        const newText = newLines.join('\n');
        el.value = val.substring(0, lineStart) + newText + val.substring(lineEnd);
        el.setSelectionRange(lineStart, lineStart + newText.length);
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * 切换引用块
 */
export function toggleBlockquote(el) {
    if (!el) return;
    if (el.isContentEditable) {
        let node = document.getSelection().anchorNode;
        let bqNode = null;

        // 向上寻找是否处于引用块中
        while (node && node !== el) {
            if (node.nodeName === 'BLOCKQUOTE') { bqNode = node; break; }
            node = node.parentNode;
        }

        if (bqNode) {
            // 💡 核心修复：彻底解构！将 blockquote 里面的所有内容提取出来，然后粉碎 blockquote 壳子
            const frag = document.createDocumentFragment();
            while (bqNode.firstChild) {
                frag.appendChild(bqNode.firstChild);
            }
            bqNode.parentNode.insertBefore(frag, bqNode);
            bqNode.parentNode.removeChild(bqNode);
        } else {
            // 没有引用壳子，则正常添加引用
            document.execCommand('formatBlock', false, 'BLOCKQUOTE');
        }
    } else {
        // 源码模式支持
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const val = el.value;
        let lineStart = val.lastIndexOf('\n', start - 1);
        lineStart = lineStart === -1 ? 0 : lineStart + 1;
        let lineEnd = val.indexOf('\n', end);
        if (lineEnd === -1) lineEnd = val.length;

        const lines = val.substring(lineStart, lineEnd).split('\n');
        const isQuote = lines.every(l => l.startsWith('> '));

        const newLines = lines.map(l => isQuote ? l.substring(2) : `> ${l}`);
        const newText = newLines.join('\n');

        el.value = val.substring(0, lineStart) + newText + val.substring(lineEnd);
        el.setSelectionRange(lineStart, lineStart + newText.length);
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * 插入链接
 */
export function insertLink(el) {
    if (!el) return;
    const url = prompt('输入链接地址:', 'https://');
    if (!url) return;

    if (el.isContentEditable) {
        const selection = window.getSelection();
        if (!selection.rangeCount) return;
        const range = selection.getRangeAt(0);
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.appendChild(range.extractContents());
        if (a.textContent.trim() === '') a.textContent = url;
        range.insertNode(a);
    } else {
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const val = el.value;
        const selected = val.substring(start, end);
        const linkText = selected || url;
        const link = `[${linkText}](${url})`;
        el.value = val.substring(0, start) + link + val.substring(end);
        el.setSelectionRange(start + 1, start + 1 + linkText.length);
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
}


// ==================== AST 解析引擎 ====================

// 初始化 Turndown 实例
let turndownService;
if (typeof TurndownService !== 'undefined') {
    turndownService = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        emDelimiter: '*'
    });

    // 💡 补充：强力接管删除线标签，转译为 Markdown 标准的 ~~ 语法
    turndownService.addRule('strikethrough', {
        filter: ['del', 's', 'strike'],
        replacement: function (content) {
            return '~~' + content + '~~';
        }
    });

    // 增强提取器：暴力将视觉换行转化为物理换行符
    const extractCodeText = (node) => {
        let html = node.innerHTML;
        html = html.replace(/<br\s*\/?>/gi, '\n');
        html = html.replace(/<\/(div|p|li|h[1-6]|tr)>/gi, '\n');
        const temp = document.createElement('div');
        temp.innerHTML = html;
        let codeText = temp.textContent || temp.innerText || '';
        codeText = codeText.replace(/\n{3,}/g, '\n\n');
        return codeText.replace(/^\n+/, '').replace(/\n+$/, '');
    };

    // 智能语言推断器：从复制的网页 HTML 中精准提取编程语言
    const extractLang = (node) => {
        let el = node.querySelector('code') || node;
        let className = (el.className || '') + ' ' + (node.className || '');
        const match = className.match(/(?:lang|language)-([a-zA-Z0-9]+)/i);
        if (match) return match[1].toLowerCase();

        const lower = className.toLowerCase();
        if (lower.includes('javascript') || lower.includes('js')) return 'javascript';
        if (lower.includes('python') || lower.includes('py')) return 'python';
        if (lower.includes('typescript') || lower.includes('ts')) return 'typescript';
        if (lower.includes('html')) return 'html';
        if (lower.includes('css')) return 'css';
        if (lower.includes('java')) return 'java';
        return '';
    };

    // 1. 强力拦截 VS Code 等 IDE 复制的富文本代码块
    turndownService.addRule('ide-code-paste', {
        filter: function (node) {
            if (node.nodeName === 'DIV') {
                const style = node.getAttribute('style') || '';
                if (style.toLowerCase().includes('monospace') ||
                    style.toLowerCase().includes('consolas') ||
                    style.toLowerCase().includes('white-space: pre')) {
                    return true;
                }
            }
            if (node.classList && (node.classList.contains('highlight') || node.classList.contains('codehilite'))) {
                return true;
            }
            return false;
        },
        replacement: function (content, node) {
            return '\n```' + extractLang(node) + '\n' + extractCodeText(node) + '\n```\n';
        }
    });

    // 2. 强力接管所有普通的 <pre> 标签（兜底策略）
    turndownService.addRule('force-pre', {
        filter: 'pre',
        replacement: function (content, node) {
            return '\n```' + extractLang(node) + '\n' + extractCodeText(node) + '\n```\n';
        }
    });

    // 3. 拦截视频与图片
    turndownService.addRule('video', {
        filter: 'video',
        replacement: function (content, node) {
            const src = convertToLocalPath(node.getAttribute('src') || '');
            return `\n<video src="${src}" controls style="max-width:100%; border-radius:4px; margin:8px 0;"></video>\n`;
        }
    });

    turndownService.addRule('image', {
        filter: 'img',
        replacement: function (content, node) {
            const src = convertToLocalPath(node.getAttribute('src') || '');
            const alt = node.getAttribute('alt') || '';
            return `![${alt}](${src})`;
        }
    });
}

/**
 * 将 Markdown 转换为 HTML
 */
export function parseMarkdown(text) {
    if (!text) return '<p><br></p>';
    try {
        if (typeof marked === 'undefined') {
            return `<div style="color:red;padding:10px;">错误：未检测到 Marked.js</div><pre>${text}</pre>`;
        }

        const renderer = new marked.Renderer();

        // 1. 让 Markdown 图片认识相对路径
        renderer.image = function (href, title, text) {
            let finalHref = href.href || href;
            if (finalHref.startsWith('uploads/')) {
                finalHref = convertLocalPath(window.__BASE_DIR__ + '/' + finalHref);
            } else if (!finalHref.startsWith('http')) {
                finalHref = convertLocalPath(finalHref);
            }
            return `<img src="${finalHref}" alt="${text || ''}" title="${title || ''}">`;
        };

        // 2. 让 Markdown 里的原生 HTML <video> 认识相对路径
        renderer.html = function (htmlObj) {
            const htmlText = typeof htmlObj === 'object' ? htmlObj.text : htmlObj;
            return htmlText.replace(/<video\s+[^>]*src="([^"]+)"/ig, (match, src) => {
                let parsedSrc = src.replace(/\\/g, '/');
                if (parsedSrc.startsWith('uploads/')) {
                    parsedSrc = window.__BASE_DIR__ + '/' + parsedSrc;
                }
                parsedSrc = parsedSrc.startsWith('http') ? parsedSrc : convertLocalPath(parsedSrc);
                return match.replace(src, parsedSrc);
            });
        };

        // 💡 4. 终极修复：删除线强行转为浏览器原生认识的 <strike> 标签
        renderer.del = function (token) {
            // 兼容最新版 marked.js (通过 this.parser 渲染内部可能存在的嵌套格式)
            if (typeof token === 'object' && token.tokens) {
                return `<strike>${this.parser.parseInline(token.tokens)}</strike>`;
            }
            // 兜底旧版
            const text = typeof token === 'object' ? token.text : token;
            return `<strike>${text}</strike>`;
        };

        // 3. 终极修复：拦截代码块，强制使用 Highlight.js 渲染颜色，并限制猜测范围
        renderer.code = function (codeObj) {
            const codeText = typeof codeObj === 'object' ? codeObj.text : codeObj;
            const lang = typeof codeObj === 'object' ? codeObj.lang : arguments[1];

            if (window.hljs) {
                try {
                    let highlighted = '';
                    let finalLang = '';

                    // 如果代码块有指定语言且能识别，按指定语言高亮
                    if (lang && window.hljs.getLanguage(lang)) {
                        highlighted = window.hljs.highlight(codeText, { language: lang }).value;
                        finalLang = lang;
                    } else {
                        // 致命错误修复：给推断引擎加上“白名单”，防止它猜出冷门语言导致全屏变绿
                        const commonLangs = [
                            'javascript', 'typescript', 'html', 'css', 'json',
                            'python', 'java', 'c', 'cpp', 'csharp', 'rust',
                            'go', 'bash', 'sql', 'xml', 'yaml', 'markdown'
                        ];
                        const autoResult = window.hljs.highlightAuto(codeText, commonLangs);
                        highlighted = autoResult.value;
                        finalLang = autoResult.language || 'plaintext';
                    }

                    // 包装为 hljs 标准类名，同时注入本应用的 code-block 类确保样式统一
                    return `<pre class="code-block"><code class="hljs language-${finalLang}">${highlighted}</code></pre>`;
                } catch (e) {
                    console.warn('语法高亮失败', e);
                }
            }

            // 安全转义回退方案，同样注入 code-block
            const safeText = codeText.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
            return `<pre class="code-block"><code class="hljs">${safeText}</code></pre>`;
        };

        return marked.parse(text, { renderer });
    } catch (e) {
        console.error("Markdown 解析失败", e);
        return `<div style="color:red; background:#fee; padding:10px; border-radius:4px;">Markdown 语法解析出错，请切换至源码模式修改</div>`;
    }
}

/**
 * 将脏 HTML 转回纯净的 Markdown
 */
export function htmlToMarkdown(html) {
    if (!html) return '';
    try {
        if (!turndownService) return html;
        return turndownService.turndown(html);
    } catch (e) {
        console.error("HTML 转 Markdown 失败", e);
        return '';
    }
}

// ==================== 悬浮工具栏 ====================

export function initFloatingToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'block-float-toolbar';
    toolbar.innerHTML = `
        <div class="block-float-btn" data-action="bold" title="加粗 (Ctrl+B)"><b>B</b></div>
        <div class="block-float-btn" data-action="italic" title="斜体 (Ctrl+I)"><i>I</i></div>
        <div class="block-float-btn" data-action="strike" title="删除线"><del>S</del></div>
        <div class="block-float-btn" data-action="heading" title="标题循环">H</div>
        <div class="block-float-btn" data-action="list" title="列表切换 (符号/编号)">☷</div>
        <div class="block-float-btn" data-action="quote" title="引用">❞</div>
        <div class="block-float-btn" data-action="code" title="行内代码"><code>&lt;/&gt;</code></div>
        <div class="block-float-btn" data-action="link" title="链接">🔗</div>
    `;
    document.body.appendChild(toolbar);

    let activeEl = null;

    const updateToolbar = (e) => {
        if (toolbar.contains(e.target)) return;

        setTimeout(() => {
            const el = document.activeElement;
            const sel = window.getSelection();
            const hasSelection = el.isContentEditable ? (sel.toString().length > 0) : (el.selectionStart !== el.selectionEnd);

            if (el && (el.isContentEditable || el.tagName === 'TEXTAREA') && hasSelection) {
                if (!el.closest('.block-text') && !el.classList.contains('todo-text')) return;
                activeEl = el;
                toolbar.style.display = 'flex';
                toolbar.style.left = (e.clientX + 5) + 'px';
                toolbar.style.top = (e.clientY - 60) + 'px';
            } else {
                toolbar.style.display = 'none';
            }
        }, 10);
    };

    document.addEventListener('mouseup', updateToolbar);
    document.addEventListener('keyup', (e) => {
        if (e.ctrlKey) return;
        toolbar.style.display = 'none';
    });
    toolbar.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); };

    toolbar.onclick = (e) => {
        const btn = e.target.closest('.block-float-btn');
        if (!btn || !activeEl) return;
        const action = btn.dataset.action;
        switch (action) {
            case 'bold': toggleBold(activeEl); break;
            case 'italic': toggleItalic(activeEl); break;
            case 'strike': toggleStrikethrough(activeEl); break;
            case 'code': toggleInlineCode(activeEl); break;
            case 'heading': toggleHeading(activeEl); break;
            case 'link': insertLink(activeEl); break;

            // 新增的两行路由
            case 'list': toggleList(activeEl); break;
            case 'quote': toggleBlockquote(activeEl); break;
        }
    };
}