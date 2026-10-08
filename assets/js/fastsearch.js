import * as params from '@params';

const resList = document.getElementById('searchResults');
const sInput = document.getElementById('searchInput');
const searchbox = document.getElementById('searchbox');

if (resList && sInput && searchbox) {
    let fuse;
    let loadError = false;
    let first = null;
    let last = null;
    let resultsAvailable = false;

    // Status messages are not result links and never become navigation targets.
    const status = document.createElement('p');
    status.id = 'searchStatus';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.hidden = true;
    searchbox.appendChild(status);

    function clearResults() {
        resList.replaceChildren();
        resultsAvailable = false;
        first = last = null;
        status.textContent = '';
        status.hidden = true;
    }

    function showStatus(message) {
        clearResults();
        status.textContent = message;
        status.hidden = false;
    }

    // Index fields are text; only the mark elements are generated as HTML.
    function appendHighlighted(element, value, keyword) {
        const text = String(value || '');
        const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
        parts.forEach((part, index) => {
            if (index % 2) {
                const mark = document.createElement('mark');
                mark.textContent = part;
                element.appendChild(mark);
            } else {
                element.appendChild(document.createTextNode(part));
            }
        });
    }

    function resultURL(permalink) {
        if (typeof permalink !== 'string' || !permalink.trim()) return null;
        try {
            const url = new URL(permalink, document.baseURI);
            return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
        } catch {
            return null;
        }
    }

    function search() {
        const keyword = sInput.value.trim();
        if (!keyword) {
            clearResults();
            return;
        }
        if (loadError) {
            showStatus('搜索索引加载失败，请刷新页面重试。');
            return;
        }
        if (!fuse) {
            showStatus('正在加载搜索索引…');
            return;
        }

        const limit = Number(params.fuseOpts?.limit);
        const results = Number.isFinite(limit) && limit > 0
            ? fuse.search(keyword, { limit })
            : fuse.search(keyword);
        clearResults();

        results.forEach(({ item }) => {
            const href = resultURL(item.permalink);
            if (!href) return;

            const entry = document.createElement('li');
            entry.className = 'post-entry';
            const header = document.createElement('header');
            header.className = 'entry-header';
            appendHighlighted(header, item.title, keyword);
            header.appendChild(document.createTextNode('\u00a0»'));

            const summary = String(item.summary || item.content || '');
            const snippet = summary.length > 160 ? `${summary.slice(0, 160)}…` : summary;
            const content = document.createElement('div');
            content.className = 'entry-content';
            appendHighlighted(content, snippet, keyword);

            const link = document.createElement('a');
            link.href = href;
            link.setAttribute('aria-label', String(item.title || ''));
            entry.appendChild(header);
            entry.appendChild(content);
            entry.appendChild(link);
            resList.appendChild(entry);
        });

        first = resList.firstElementChild;
        last = resList.lastElementChild;
        resultsAvailable = Boolean(first);
        if (!resultsAvailable) showStatus('没有找到相关内容。');
    }

    function activeToggle(element) {
        resList.querySelectorAll('.focus').forEach(entry => entry.classList.remove('focus'));
        if (!element) return;
        element.focus();
        if (element !== sInput) element.parentElement.classList.add('focus');
    }

    function reset() {
        clearResults();
        sInput.value = '';
        sInput.focus();
    }

    // Input changes rebuild results; navigation key releases do not.
    sInput.addEventListener('input', search);
    sInput.addEventListener('search', search);
    document.addEventListener('keydown', event => {
        const active = document.activeElement;
        if (!searchbox.contains(active) || event.isComposing) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            reset();
            return;
        }
        if (!resultsAvailable) return;

        const row = active === sInput ? null : active.parentElement;
        const isResultLink = row && row.parentElement === resList && active.tagName === 'A';
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (active === sInput) {
                activeToggle(first.querySelector('a'));
            } else if (isResultLink && row !== last) {
                activeToggle(row.nextElementSibling.querySelector('a'));
            }
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (isResultLink) {
                activeToggle(row === first ? sInput : row.previousElementSibling.querySelector('a'));
            }
        } else if (event.key === 'Enter' || event.key === 'ArrowRight') {
            const target = active === sInput && event.key === 'Enter'
                ? first.querySelector('a')
                : isResultLink ? active : null;
            if (target) {
                event.preventDefault();
                target.click();
            }
        }
    });

    const xhr = new XMLHttpRequest();
    function failToLoad() {
        loadError = true;
        showStatus('搜索索引加载失败，请刷新页面重试。');
    }
    xhr.onreadystatechange = () => {
        if (xhr.readyState !== 4) return;
        if (xhr.status !== 200) {
            failToLoad();
            return;
        }
        try {
            const data = JSON.parse(xhr.responseText);
            if (!Array.isArray(data)) throw new Error('Invalid search index');
            const options = {
                distance: 100,
                threshold: 0.4,
                ignoreLocation: true,
                keys: ['title', 'summary', 'content', 'tags', 'categories']
            };
            if (params.fuseOpts) {
                Object.assign(options, {
                    isCaseSensitive: params.fuseOpts.iscasesensitive ?? false,
                    includeScore: false,
                    includeMatches: false,
                    minMatchCharLength: params.fuseOpts.minmatchcharlength ?? 2,
                    shouldSort: params.fuseOpts.shouldsort ?? true,
                    findAllMatches: params.fuseOpts.findallmatches ?? false,
                    keys: params.fuseOpts.keys ?? options.keys,
                    location: params.fuseOpts.location ?? 0,
                    threshold: params.fuseOpts.threshold ?? 0.3,
                    distance: params.fuseOpts.distance ?? 100,
                    ignoreLocation: params.fuseOpts.ignorelocation ?? true
                });
            }
            fuse = new Fuse(data, options);
            loadError = false;
            search(); // A visitor may have typed before the request completed.
        } catch {
            failToLoad();
        }
    };
    xhr.onerror = failToLoad;
    xhr.ontimeout = failToLoad;
    xhr.timeout = 10000;
    xhr.open('GET', '../index.json');
    xhr.send();
}
