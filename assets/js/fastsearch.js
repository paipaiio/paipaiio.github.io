import * as params from '@params';

/* =========================
   Highlight helper
========================= */
function highlight(text, keyword) {
    if (!keyword || !text) return text;
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    return text.replace(regex, '<mark>$1</mark>');
}

/* =========================
   Variables
========================= */
let fuse; // search engine
let resList = document.getElementById('searchResults');
let sInput = document.getElementById('searchInput');
let first, last, current_elem = null;
let resultsAvailable = false;

/* =========================
   Load search index
========================= */
window.onload = function () {
    let xhr = new XMLHttpRequest();
    xhr.onreadystatechange = function () {
        if (xhr.readyState === 4) {
            if (xhr.status === 200) {
                let data = JSON.parse(xhr.responseText);
                if (data) {
                    let options = {
                        distance: 100,
                        threshold: 0.4,
                        ignoreLocation: true,
                        keys: ['title', 'summary', 'content']
                    };

                    if (params.fuseOpts) {
                        options = {
                            isCaseSensitive: params.fuseOpts.iscasesensitive ?? false,
                            includeScore: false,
                            includeMatches: false,
                            minMatchCharLength: params.fuseOpts.minmatchcharlength ?? 2,
                            shouldSort: params.fuseOpts.shouldsort ?? true,
                            findAllMatches: params.fuseOpts.findallmatches ?? false,
                            keys: params.fuseOpts.keys ?? ['title', 'summary', 'content'],
                            location: params.fuseOpts.location ?? 0,
                            threshold: params.fuseOpts.threshold ?? 0.3,
                            distance: params.fuseOpts.distance ?? 100,
                            ignoreLocation: params.fuseOpts.ignorelocation ?? true
                        };
                    }

                    fuse = new Fuse(data, options);
                }
            }
        }
    };
    xhr.open('GET', '../index.json');
    xhr.send();
};

/* =========================
   Helpers
========================= */
function activeToggle(ae) {
    document.querySelectorAll('.focus').forEach(el => el.classList.remove('focus'));
    if (ae) {
        ae.focus();
        current_elem = ae;
        ae.parentElement.classList.add('focus');
    }
}

function reset() {
    resultsAvailable = false;
    resList.innerHTML = '';
    sInput.value = '';
    sInput.focus();
}

/* =========================
   Search handler
========================= */
sInput.onkeyup = function () {
    if (!fuse) return;

    const keyword = this.value.trim();
    if (!keyword) {
        reset();
        return;
    }

    let results = params.fuseOpts
        ? fuse.search(keyword, { limit: params.fuseOpts.limit })
        : fuse.search(keyword);

    if (results.length === 0) {
        resultsAvailable = false;
        resList.innerHTML = '';
        return;
    }

    let resultSet = '';

    for (let i = 0; i < results.length; i++) {
        const item = results[i].item;

        const title = highlight(item.title, keyword);
        const summary = highlight(
            item.summary || (item.content ? item.content.substring(0, 120) : ''),
            keyword
        );

        resultSet += `
<li class="post-entry">
  <header class="entry-header">${title}&nbsp;»</header>
  <div class="entry-content">${summary}</div>
  <a href="${item.permalink}" aria-label="${item.title}"></a>
</li>`;
    }

    resList.innerHTML = resultSet;
    resultsAvailable = true;
    first = resList.firstChild;
    last = resList.lastChild;
};

/* =========================
   Clear on X
========================= */
sInput.addEventListener('search', function () {
    if (!this.value) reset();
});

/* =========================
   Keyboard navigation
========================= */
document.onkeydown = function (e) {
    if (!resultsAvailable) return;

    let ae = document.activeElement;
    let inbox = document.getElementById('searchbox').contains(ae);

    if (!inbox) return;

    if (e.key === 'Escape') {
        reset();
    } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (ae === sInput) {
            activeToggle(first.lastChild);
        } else if (ae.parentElement !== last) {
            activeToggle(ae.parentElement.nextSibling.lastChild);
        }
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (ae.parentElement === first) {
            activeToggle(sInput);
        } else if (ae !== sInput) {
            activeToggle(ae.parentElement.previousSibling.lastChild);
        }
    } else if (e.key === 'ArrowRight') {
        ae.click();
    }
};