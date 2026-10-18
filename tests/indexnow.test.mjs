import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildPayload, changedUrls, parseSitemap } from '../scripts/indexnow.mjs';

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'indexnow.mjs');
const scratch = mkdtempSync(join(tmpdir(), 'indexnow-'));
const key = '0123456789abcdef0123456789abcdef';

after(() => rmSync(scratch, { recursive: true, force: true }));

function sitemap(entries) {
  return `<?xml version="1.0"?><urlset>${entries.map(([loc, lastmod]) =>
    `<url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`).join('')}</urlset>`;
}

const before = sitemap([
  ['https://blog.example.com/', '2026-01-01T00:00:00+08:00'],
  ['https://blog.example.com/posts/a/', '2026-01-01T00:00:00+08:00'],
  ['https://blog.example.com/posts/gone/', '2026-01-01T00:00:00+08:00'],
  ['https://blog.example.com/tags/', null],
]);
const afterwards = sitemap([
  ['https://blog.example.com/', '2026-02-01T00:00:00+08:00'],
  ['https://blog.example.com/posts/a/', '2026-01-01T00:00:00+08:00'],
  ['https://blog.example.com/posts/new/', '2026-02-01T00:00:00+08:00'],
  ['https://blog.example.com/tags/', null],
]);

test('parseSitemap maps every loc to its lastmod and tolerates missing lastmod', () => {
  const parsed = parseSitemap(before);
  assert.equal(parsed.size, 4);
  assert.equal(parsed.get('https://blog.example.com/posts/a/'), '2026-01-01T00:00:00+08:00');
  assert.equal(parsed.get('https://blog.example.com/tags/'), '');
  assert.equal(parseSitemap('').size, 0);
});

test('changedUrls reports added, updated and removed URLs only', () => {
  assert.deepEqual(changedUrls(before, afterwards), [
    'https://blog.example.com/',
    'https://blog.example.com/posts/new/',
    'https://blog.example.com/posts/gone/',
  ]);
  assert.deepEqual(changedUrls(afterwards, afterwards), []);
});

test('changedUrls submits everything when the previous sitemap is unavailable', () => {
  assert.equal(changedUrls('', afterwards).length, 4);
});

test('buildPayload follows the IndexNow protocol and rejects bad input', () => {
  assert.deepEqual(buildPayload(['https://blog.example.com/x/'], key), {
    host: 'blog.example.com',
    key,
    keyLocation: `https://blog.example.com/${key}.txt`,
    urlList: ['https://blog.example.com/x/'],
  });
  assert.equal(buildPayload([], key), null);
  assert.throws(() => buildPayload(['https://blog.example.com/'], 'short'), /INDEXNOW_KEY/);
  assert.throws(() => buildPayload(['https://a.example.com/', 'https://b.example.com/'], key), /host/);
});

function cli(oldXml, newXml, env = { INDEXNOW_KEY: key }) {
  const oldPath = join(scratch, 'old.xml');
  const newPath = join(scratch, 'new.xml');
  writeFileSync(oldPath, oldXml);
  writeFileSync(newPath, newXml);
  return spawnSync(process.execPath, [script, oldPath, newPath], { encoding: 'utf8', env });
}

test('CLI prints a single-line payload, or nothing when nothing changed', () => {
  const changed = cli(before, afterwards);
  assert.equal(changed.status, 0, changed.stderr);
  assert.equal(changed.stdout.trim().split('\n').length, 1);
  assert.equal(JSON.parse(changed.stdout).urlList.length, 3);
  const unchanged = cli(afterwards, afterwards);
  assert.equal(unchanged.status, 0, unchanged.stderr);
  assert.equal(unchanged.stdout, '');
});

test('CLI treats a missing previous sitemap as empty and fails clearly without a key', () => {
  const newPath = join(scratch, 'only-new.xml');
  writeFileSync(newPath, afterwards);
  const missing = spawnSync(process.execPath, [script, join(scratch, 'absent.xml'), newPath],
    { encoding: 'utf8', env: { INDEXNOW_KEY: key } });
  assert.equal(missing.status, 0, missing.stderr);
  assert.equal(JSON.parse(missing.stdout).urlList.length, 4);
  const noKey = cli(before, afterwards, {});
  assert.notEqual(noKey.status, 0);
  assert.match(noKey.stderr, /INDEXNOW_KEY/);
});
