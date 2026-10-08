import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { createDOM } from './helpers/dom.mjs';

const project = resolve(process.env.BLOG_SOURCE || join(dirname(fileURLToPath(import.meta.url)), '..'));
const partial = join(project, 'layouts', 'partials', 'giscus.html');
const sourcePath = existsSync(partial) ? partial : join(project, 'layouts', '_default', 'single.html');
const scripts = [...readFileSync(sourcePath, 'utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
const source = scripts.find(match => match[1].includes('postMessage'))?.[1];
assert.ok(source, 'A local Giscus theme synchronization script is present');

function widget({ theme = 'light', frameBeforeScript = false, feedback = false } = {}) {
  const dom = createDOM();
  dom.document.documentElement.dataset.theme = theme;
  const container = dom.document.createElement('div');
  container.id = 'comments';
  const client = dom.document.createElement('script');
  client.id = 'giscus-client';
  dom.document.body.appendChild(container);
  dom.document.body.appendChild(client);
  const observers = [];
  const messages = [];
  class MutationObserver {
    constructor(callback) { this.callback = callback; }
    observe(target, options) { observers.push({ callback: this.callback, target, options }); }
  }
  const mutate = target => observers.filter(observer => observer.target === target).forEach(observer => observer.callback([]));
  const newFrame = () => {
    const frame = dom.document.createElement('iframe');
    frame.className = 'giscus-frame';
    frame.contentWindow = {
      postMessage(data, origin) {
        messages.push({ data: JSON.parse(JSON.stringify(data)), origin });
        if (feedback) dom.window.dispatch('message', { origin, source: frame.contentWindow, data: { giscus: { discussion: {} } } });
      },
    };
    container.replaceChildren(frame);
    return frame;
  };
  if (frameBeforeScript) newFrame().dispatch('load');
  runInContext(source, createContext({ ...dom, MutationObserver }), { filename: sourcePath });
  const insertFrame = () => { const frame = newFrame(); mutate(container); return frame; };
  const setTheme = value => { dom.document.documentElement.dataset.theme = value; mutate(dom.document.documentElement); };
  const message = (frame, overrides = {}) => dom.window.dispatch('message', {
    origin: 'https://giscus.app', source: frame.contentWindow, data: { giscus: { discussion: {} } }, ...overrides,
  });
  return { ...dom, container, client, observers, messages, insertFrame, setTheme, message };
}

test('Giscus initially matches data-theme and waits for the iframe readiness signal', () => {
  const page = widget({ theme: 'dark' });
  assert.equal(page.client.dataset.theme, 'transparent_dark');
  assert.deepEqual(page.messages, []);
  const frame = page.insertFrame();
  assert.deepEqual(page.messages, []);
  frame.dispatch('load');
  assert.deepEqual(page.messages, [{ data: { giscus: { setConfig: { theme: 'transparent_dark' } } }, origin: 'https://giscus.app' }]);
});

test('Giscus MutationObserver tracks only data-theme and updates each changed theme once', () => {
  const page = widget();
  const frame = page.insertFrame();
  frame.dispatch('load');
  assert.equal(page.messages.length, 1);
  const themeObserver = page.observers.find(observer => observer.target === page.document.documentElement);
  assert.ok(themeObserver);
  assert.deepEqual(Array.from(themeObserver.options.attributeFilter), ['data-theme']);
  page.setTheme('dark');
  assert.equal(page.messages.at(-1).data.giscus.setConfig.theme, 'transparent_dark');
  page.setTheme('dark');
  page.message(frame);
  assert.equal(page.messages.length, 2);
  page.setTheme('light');
  assert.equal(page.messages.at(-1).data.giscus.setConfig.theme, 'light');
  assert.equal(page.messages.length, 3);
});

test('An iframe that loaded before handlers were attached synchronizes on its first valid message', () => {
  const page = widget({ frameBeforeScript: true });
  const frame = page.container.querySelector('iframe.giscus-frame');
  assert.deepEqual(page.messages, []);
  page.message(frame);
  assert.equal(page.messages.length, 1);
  assert.equal(page.messages[0].data.giscus.setConfig.theme, 'light');
});

test('Unrelated, malformed, and error messages do not trigger Giscus theme updates', () => {
  const page = widget();
  const frame = page.insertFrame();
  const invalid = [
    { origin: 'https://unrelated.example' },
    { source: {} },
    { data: null },
    { data: {} },
    { data: { giscus: true } },
    { data: { giscus: { error: 'discussion unavailable' } } },
  ];
  for (const overrides of invalid) assert.doesNotThrow(() => page.message(frame, overrides));
  assert.deepEqual(page.messages, []);
  page.message(frame);
  assert.equal(page.messages.length, 1);
});

test('Widget feedback messages do not create a recursive postMessage loop', () => {
  const page = widget({ feedback: true });
  const frame = page.insertFrame();
  assert.doesNotThrow(() => frame.dispatch('load'));
  assert.equal(page.messages.length, 1);
  assert.doesNotThrow(() => page.setTheme('dark'));
  assert.equal(page.messages.length, 2);
});

test('A replacement iframe receives the current theme after its own load', () => {
  const page = widget();
  const previous = page.insertFrame();
  previous.dispatch('load');
  page.setTheme('dark');
  const current = page.insertFrame();
  assert.equal(page.messages.length, 2);
  page.message(previous);
  assert.equal(page.messages.length, 2);
  current.dispatch('load');
  assert.equal(page.messages.length, 3);
  assert.equal(page.messages.at(-1).data.giscus.setConfig.theme, 'transparent_dark');
});
