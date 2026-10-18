#!/usr/bin/env node
// 对比部署前后的 sitemap，生成 IndexNow 提交内容（新增、lastmod 变化、被删除的 URL）。
// 用法：INDEXNOW_KEY=<key> node scripts/indexnow.mjs <旧 sitemap> <新 sitemap>
// 有变化时向 stdout 输出单行 JSON，无变化时不输出。
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const KEY_PATTERN = /^[a-zA-Z0-9-]{8,128}$/;

export function parseSitemap(xml) {
  const entries = new Map();
  for (const [, entry] of xml.matchAll(/<url>(.*?)<\/url>/gs)) {
    const loc = entry.match(/<loc>\s*(.*?)\s*<\/loc>/s)?.[1];
    if (loc) entries.set(loc, entry.match(/<lastmod>\s*(.*?)\s*<\/lastmod>/s)?.[1] ?? '');
  }
  return entries;
}

export function changedUrls(previousXml, currentXml) {
  const previous = parseSitemap(previousXml);
  const current = parseSitemap(currentXml);
  const changed = [...current].filter(([loc, lastmod]) => previous.get(loc) !== lastmod).map(([loc]) => loc);
  const removed = [...previous.keys()].filter(loc => !current.has(loc));
  return [...changed, ...removed];
}

export function buildPayload(urls, key) {
  if (!KEY_PATTERN.test(key || '')) throw new Error('INDEXNOW_KEY must be 8-128 letters, digits or dashes');
  if (urls.length === 0) return null;
  const hosts = new Set(urls.map(url => new URL(url).host));
  if (hosts.size !== 1) throw new Error(`IndexNow submissions must share one host, got: ${[...hosts].join(', ')}`);
  const [host] = hosts;
  return { host, key, keyLocation: `https://${host}/${key}.txt`, urlList: urls };
}

function main([previousPath, currentPath]) {
  const previous = previousPath && existsSync(previousPath) ? readFileSync(previousPath, 'utf8') : '';
  const payload = buildPayload(changedUrls(previous, readFileSync(currentPath, 'utf8')), process.env.INDEXNOW_KEY);
  if (payload) process.stdout.write(`${JSON.stringify(payload)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`indexnow: ${error.message}`);
    process.exit(1);
  }
}
