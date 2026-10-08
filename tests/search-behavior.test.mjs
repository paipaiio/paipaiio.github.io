import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { createDOM } from './helpers/dom.mjs';

const project = resolve(process.env.BLOG_SOURCE || join(dirname(fileURLToPath(import.meta.url)), '..'));
const sourcePath = join(project, 'assets', 'js', 'fastsearch.js');
const source = readFileSync(sourcePath, 'utf8');
const fusePath = join(project, 'themes', 'PaperMod', 'assets', 'js', 'fuse.basic.min.js');
const fuseSource = readFileSync(fusePath, 'utf8');
const articles = [
  { title: '测试第一篇 🚀', summary: 'needle 与参数', content: '正文', permalink: 'https://blog.example/posts/first/', tags: ['参数标签'], categories: ['测试分类'] },
  { title: '测试第二篇', summary: 'needle again', content: '正文', permalink: 'https://blog.example/posts/second/', tags: [], categories: [] },
];

function browser(options = {}) {
  const dom = createDOM();
  const requests = [];
  class XMLHttpRequest {
    constructor() { this.readyState = 0; this.status = 0; }
    open(method, url) { this.method = method; this.url = url; }
    send() { requests.push(this); }
  }
  const params = options.params ?? { fuseOpts: { keys: ['title', 'summary', 'content', 'tags', 'categories'], threshold: 0.3, minmatchcharlength: 2, shouldsort: true } };
  const context = createContext({ ...dom, params, XMLHttpRequest, URL, console, setTimeout, clearTimeout });
  runInContext(fuseSource, context, { filename: fusePath });
  // Replace only the build-time import, preserving byte offsets for V8 coverage.
  runInContext(source.replace(/^import\s+\*\s+as\s+params\s+from\s+['"]@params['"];?/m, match => ' '.repeat(match.length)), context, { filename: sourcePath });
  dom.window.dispatch('load');
  const respond = (data = articles, status = 200, literal) => {
    assert.equal(requests.length, 1, 'Load exactly one local search index');
    const request = requests[0];
    request.status = status;
    request.readyState = 4;
    request.responseText = literal ?? JSON.stringify(data);
    request.onreadystatechange?.();
    request.onload?.();
  };
  const input = value => { dom.input.value = value; dom.input.dispatch('input'); };
  const key = name => dom.document.dispatch('keydown', { key: name });
  return { ...dom, requests, respond, inputValue: input, key };
}

test('Search renders real Fuse matches on input, including tags and categories', () => {
  const page = browser();
  page.respond();
  page.inputValue('needle');
  assert.equal(page.results.children.length, 2);
  assert.match(page.results.textContent, /测试第一篇/);
  page.inputValue('参数标签');
  assert.equal(page.results.children.length, 1);
  page.inputValue('测试分类');
  assert.equal(page.results.children.length, 1);
});

test('Input typed before the index arrives is rendered when loading completes', () => {
  const page = browser();
  page.inputValue('needle');
  assert.equal(page.results.children.length, 0);
  page.respond();
  assert.equal(page.results.children.length, 2);
});

test('Results preserve special characters as text and highlight literal regex characters', () => {
  const page = browser();
  const title = '<img src=x onerror=alert(1)> C++ 🚀';
  page.respond([{ title, summary: '<script>not markup</script> C++', content: '', permalink: '/posts/literal/' }]);
  page.inputValue('C++');
  assert.equal(page.results.children.length, 1);
  assert.match(page.results.textContent, /<img src=x onerror=alert\(1\)> C\+\+ 🚀/);
  assert.equal(page.results.querySelectorAll('img').length, 0);
  assert.equal(page.results.querySelectorAll('script').length, 0);
  assert.deepEqual(page.document.htmlWrites, []);
  assert.ok(page.results.querySelectorAll('mark').some(mark => mark.textContent === 'C++'));
});

test('Result links allow web URLs and reject javascript/data URL schemes', () => {
  const page = browser();
  page.respond([
    { title: 'needle valid', permalink: '/posts/valid/' },
    { title: 'needle script', permalink: 'javascript:alert(1)' },
    { title: 'needle data', permalink: 'data:text/html,attack' },
    { title: 'needle malformed', permalink: 'http://[' },
    { title: 'needle missing' },
  ]);
  page.inputValue('needle');
  const links = page.results.querySelectorAll('a');
  assert.equal(links.length, 1);
  assert.equal(links[0].href, 'https://blog.example/posts/valid/');
});

test('Arrow keys follow element results and Enter activates the current selection', () => {
  const page = browser();
  page.respond();
  page.inputValue('needle');
  const links = page.results.querySelectorAll('a');
  assert.equal(links.length, 2);
  assert.ok(page.key('ArrowDown').defaultPrevented);
  assert.equal(page.document.activeElement, links[0]);
  page.key('ArrowDown');
  assert.equal(page.document.activeElement, links[1]);
  page.key('ArrowDown');
  assert.equal(page.document.activeElement, links[1]);
  page.key('ArrowUp');
  assert.equal(page.document.activeElement, links[0]);
  page.key('Enter');
  assert.equal(page.document.clicks.at(-1), links[0]);
  page.key('ArrowUp');
  assert.equal(page.document.activeElement, page.input);
  page.key('Enter');
  assert.equal(page.document.clicks.at(-1), links[0]);
});

test('Escape and native search-clear remove both query and results, including no-match queries', () => {
  const page = browser();
  page.respond();
  page.inputValue('needle');
  page.key('Escape');
  assert.equal(page.input.value, '');
  assert.equal(page.results.children.length, 0);
  page.inputValue('zzzz-no-match');
  page.key('Escape');
  assert.equal(page.input.value, '');
  page.inputValue('needle');
  page.input.value = '';
  page.input.dispatch('search');
  assert.equal(page.results.children.length, 0);
});

test('Empty, whitespace, and no-match queries have no navigable results', () => {
  const page = browser();
  page.respond();
  for (const query of ['', '   ', 'zzzz-no-match']) {
    page.inputValue(query);
    assert.equal(page.results.querySelectorAll('a').length, 0);
    assert.doesNotThrow(() => page.key('ArrowDown'));
    assert.doesNotThrow(() => page.key('ArrowUp'));
    assert.doesNotThrow(() => page.key('Enter'));
  }
});

for (const scenario of ['HTTP failure', 'malformed JSON', 'invalid index type', 'network failure', 'timeout', 'empty index']) {
  test(`Search handles ${scenario} without stale results or an unhandled exception`, () => {
    const page = browser();
    page.inputValue('needle');
    assert.doesNotThrow(() => {
      if (scenario === 'HTTP failure') page.respond([], 503);
      if (scenario === 'malformed JSON') page.respond([], 200, '{not JSON');
      if (scenario === 'invalid index type') page.respond({ bad: true });
      if (scenario === 'network failure') page.requests[0].onerror();
      if (scenario === 'timeout') page.requests[0].ontimeout();
      if (scenario === 'empty index') page.respond([]);
    });
    assert.doesNotThrow(() => page.inputValue('another query'));
    assert.equal(page.results.querySelectorAll('a').length, 0);
    const status = page.searchbox.children.find(child => child.getAttribute('aria-live') === 'polite');
    assert.ok(status, 'A live status region must explain loading/error/no-result state');
    assert.ok(status.textContent.length > 0);
  });
}

test('Null and invalid result fields do not crash rendering', () => {
  const page = browser();
  assert.doesNotThrow(() => page.respond([null, {}, { title: 'needle', summary: null, content: 7, permalink: '/posts/valid/' }]));
  assert.doesNotThrow(() => page.inputValue('needle'));
  assert.equal(page.results.querySelectorAll('a').length, 1);
});

test('An index with 10,000 articles remains searchable and respects the result limit', () => {
  const page = browser({ params: { fuseOpts: { keys: ['title'], limit: 5, threshold: 0.1 } } });
  const data = Array.from({ length: 10000 }, (_, i) => ({ title: `needle-${i}`, permalink: `/posts/article-${i}/`, summary: '', content: '' }));
  const started = performance.now();
  page.respond(data);
  page.inputValue('needle');
  assert.equal(page.results.querySelectorAll('a').length, 5);
  assert.ok(performance.now() - started < 5000, 'A local search should not take five seconds');
});

test('Keyboard events outside the search box leave focus and navigation untouched', () => {
  const page = browser();
  page.respond();
  page.inputValue('needle');
  const elsewhere = page.document.createElement('button');
  page.document.body.appendChild(elsewhere);
  elsewhere.focus();
  assert.equal(page.key('ArrowDown').defaultPrevented, false);
  page.key('Enter');
  assert.equal(page.document.activeElement, elsewhere);
  assert.deepEqual(page.document.clicks, []);
});

test('IME composition and navigation key release do not rebuild or move search results', () => {
  const page = browser();
  page.respond();
  page.inputValue('needle');
  const first = page.results.firstElementChild;
  page.document.dispatch('keydown', { key: 'ArrowDown', isComposing: true });
  assert.equal(page.document.activeElement, page.input);
  page.input.dispatch('keyup', { key: 'ArrowDown' });
  assert.equal(page.results.firstElementChild, first);
});

test('Partial XHR states wait for completion and fallback search options stay usable', () => {
  const page = browser({ params: {} });
  page.inputValue('needle');
  page.requests[0].readyState = 2;
  assert.doesNotThrow(() => page.requests[0].onreadystatechange());
  assert.equal(page.results.children.length, 0);
  page.respond();
  assert.equal(page.results.children.length, 2);
});

test('A long summary is bounded and a missing summary falls back to content', () => {
  const page = browser();
  page.respond([{ title: 'needle', summary: '', content: `needle ${'文'.repeat(300)}`, permalink: '/posts/long/' }]);
  page.inputValue('needle');
  const snippet = page.results.querySelector('.entry-content').textContent;
  assert.equal(snippet.length, 161);
  assert.ok(snippet.endsWith('…'));
});
