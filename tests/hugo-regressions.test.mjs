import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

// BLOG_SOURCE allows the same assertions to run against an untouched snapshot.
const project = resolve(process.env.BLOG_SOURCE || join(dirname(fileURLToPath(import.meta.url)), '..'));
const scratch = mkdtempSync(join(tmpdir(), 'blog-regressions-'));
const content = join(scratch, 'content');
const destination = join(scratch, 'site');
let config;
let initialBuild;

function hugo(args, isolateGit = true) {
  return spawnSync(process.env.HUGO_BIN || 'hugo', args, {
    cwd: project,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: {
      ...process.env,
      HUGO_RESOURCEDIR: join(scratch, 'resources'),
      // Snapshot fixtures deliberately have no .git directory.
      ...(isolateGit ? { HUGO_ENABLEGITINFO: 'false' } : {}),
    },
  });
}

function succeeded(result) {
  assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
}

function build(output, extra = []) {
  return hugo([
    '--source', project,
    '--contentDir', content,
    '--destination', output,
    '--cacheDir', join(scratch, 'cache'),
    '--noBuildLock',
    '--minify',
    ...extra,
  ]);
}

function page(slug) {
  succeeded(initialBuild);
  return readFileSync(join(destination, 'posts', slug, 'index.html'), 'utf8');
}

function fixture(slug, frontmatter, body = '普通内容与 Unicode 🚀。') {
  const path = join(content, 'posts', `${slug}.md`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `---\ntitle: "${slug}"\ndate: 2024-01-01T00:00:00+08:00\ndraft: false\nslug: "${slug}"\n${frontmatter}\n---\n\n${body}\n`);
}

before(() => {
  const effective = hugo(['config', '--source', project, '--format', 'json', '--printZero', '--noBuildLock'], false);
  succeeded(effective);
  config = JSON.parse(effective.stdout);
  cpSync(join(project, 'content'), content, { recursive: true });
  fixture('regression-standard', 'math: false\ntags: ["测试标签", "C++ 🚀"]\ncategories: ["回归分类"]', '## 内容\n\n```sh\nprintf \'hello 🚀\'\n```');
  fixture('regression-math', 'math: true', '$$x^2 + y^2 = z^2$$\n\n内联公式 $x + y$。');
  fixture('regression-empty-taxonomies', 'math: false\ntags: []\ncategories: []');
  fixture('regression-absent-taxonomies', 'math: false');
  fixture('regression-hidden-search', 'math: false\nsearchHidden: true');
  fixture('regression-no-comments', 'math: false\ncomments: false');
  fixture('regression-disabled-comments', 'math: false\ndisableComments: true');
  fixture('regression-alerts', 'math: false', ['note', 'tip', 'warning', 'important', 'caution'].map(type => `> [!${type.toUpperCase()}]\n> ${type} 提示正文。`).join('\n\n') + '\n\n> 普通引用正文。');
  initialBuild = build(destination);
});

after(() => rmSync(scratch, { recursive: true, force: true }));

test('Hugo production build succeeds in an isolated temporary destination', () => {
  succeeded(initialBuild);
  assert.ok(existsSync(join(destination, 'index.html')));
  assert.ok(existsSync(join(destination, 'robots.txt')));
  assert.ok(existsSync(join(destination, 'search', 'index.html')));
  assert.ok(!existsSync(join(scratch, '.hugo_build.lock')));
});

test('Git metadata and release flags are effective Hugo root configuration', () => {
  assert.equal(config.enablegitinfo, true);
  assert.equal(config.builddrafts, false);
  assert.equal(config.buildfuture, false);
  assert.equal(config.buildexpired, false);
  assert.equal(config.params.enablegitinfo, undefined);
});

for (const key of ['showreadingtime', 'showpostnavlinks', 'showbreadcrumbs', 'showcodecopybuttons']) {
  test(`${key} is enabled at the effective params root, not inside cover`, () => {
    assert.equal(config.params[key], true);
    assert.equal(config.params.cover[key], undefined);
  });
}

test('Reading time, breadcrumbs, navigation, and copy controls reach article HTML', () => {
  const html = page('regression-standard');
  assert.match(html, /class=["']?breadcrumbs/);
  assert.match(html, /class=["']?paginav/);
  assert.match(html, /className\s*=\s*["']copy-code|classList\.add\(["']copy-code|class=["']?copy-code/);
  assert.match(html, /(?:阅读时间|分钟|\bmin\b)/);
});

test('Custom extended CSS is included in the stylesheet referenced by actual output', () => {
  const html = page('regression-standard');
  const stylesheet = html.match(/href=["']?(\/assets\/css\/stylesheet[^\s"'>]+\.css)/);
  assert.ok(stylesheet, 'The rendered page must link to its stylesheet');
  const css = readFileSync(join(destination, stylesheet[1]), 'utf8');
  assert.match(css, /\.post-content\s*\{[^}]*max-width:\s*720px/);
  assert.match(css, /\.post-content\s*\{[^}]*line-height:\s*1\.8/);
  assert.doesNotMatch(css, /:contains\(/, 'Styles must not depend on the unsupported :contains selector');
});

test('math: true includes KaTeX and auto-render scripts on the selected page', () => {
  const html = page('regression-math');
  assert.match(html, /katex[^\s"'>]*\.css/);
  assert.match(html, /katex[^\s"'>]*\.js/);
  assert.match(html, /auto-render[^\s"'>]*\.js/);
});

test('Math assets use the reviewed KaTeX release with cross-origin SHA-384 integrity', () => {
  const resources = page('regression-math').match(/<(?:link|script)\b[^>]*https:\/\/cdn\.jsdelivr\.net\/npm\/katex@[^>]+>/g) || [];
  assert.equal(resources.length, 3, 'One stylesheet, core script, and auto-render script');
  for (const resource of resources) {
    assert.match(resource, /\/katex@0\.18\.11\//);
    assert.match(resource, /integrity=["']?sha384-[A-Za-z0-9+/]{64}["']?(?:\s|>)/);
    assert.match(resource, /crossorigin=["']?anonymous["']?(?:\s|>)/);
  }
});

test('math: false keeps KaTeX assets off pages that opt out', () => {
  assert.doesNotMatch(page('regression-standard'), /katex|auto-render\.min\.js/);
  assert.doesNotMatch(page('regression-empty-taxonomies'), /katex|auto-render\.min\.js/);
});

test('Giscus follows comments and disableComments and is included only once', () => {
  assert.doesNotMatch(page('regression-no-comments'), /giscus\.app\/client\.js/);
  assert.doesNotMatch(page('regression-disabled-comments'), /giscus\.app\/client\.js/);
  assert.equal((page('regression-standard').match(/giscus\.app\/client\.js/g) || []).length, 1);
  const about = readFileSync(join(destination, 'about', 'index.html'), 'utf8');
  assert.doesNotMatch(about, /giscus\.app\/client\.js/);
});

test('Markdown callouts render semantic alert classes while ordinary quotes remain quotes', () => {
  const html = page('regression-alerts');
  for (const type of ['note', 'tip', 'warning', 'important', 'caution']) {
    assert.match(html, new RegExp(`<blockquote class=["']alert alert-${type}["']>`));
    assert.match(html, new RegExp(`${type} 提示正文`));
  }
  assert.match(html, /<blockquote><p>普通引用正文。<\/p><\/blockquote>/);
  assert.doesNotMatch(html, /\[!(?:NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]/);
});

test('Search JSON indexes Unicode tags and categories and keeps hidden pages absent', () => {
  succeeded(initialBuild);
  const index = JSON.parse(readFileSync(join(destination, 'index.json'), 'utf8'));
  assert.ok(Array.isArray(index));
  const indexed = index.find(item => item.title === 'regression-standard');
  assert.ok(indexed, 'Published articles must be searchable');
  assert.deepEqual(indexed.tags, ['测试标签', 'C++ 🚀']);
  assert.deepEqual(indexed.categories, ['回归分类']);
  assert.ok(!index.some(item => item.title === 'regression-hidden-search'));
  assert.ok(!index.some(item => item.permalink.endsWith('/search/') || item.permalink.endsWith('/archives/')));
});

test('Search JSON represents empty and missing taxonomies as arrays', () => {
  succeeded(initialBuild);
  const index = JSON.parse(readFileSync(join(destination, 'index.json'), 'utf8'));
  for (const title of ['regression-empty-taxonomies', 'regression-absent-taxonomies']) {
    const indexed = index.find(item => item.title === title);
    assert.ok(indexed);
    assert.deepEqual(indexed.tags, []);
    assert.deepEqual(indexed.categories, []);
  }
});

test('hugo new creates valid draft frontmatter; buildDrafts renders it and production omits it', () => {
  const created = hugo([
    'new', 'content', 'posts/regression-new-article.md',
    '--source', project,
    '--contentDir', content,
    '--cacheDir', join(scratch, 'cache'),
    '--noBuildLock',
  ]);
  succeeded(created);
  const file = readFileSync(join(content, 'posts', 'regression-new-article.md'), 'utf8');
  assert.match(file, /draft\s*[:=]\s*true/);
  const drafts = join(scratch, 'draft-site');
  succeeded(build(drafts, ['--buildDrafts']));
  assert.ok(existsSync(join(drafts, 'posts', 'regression-new-article', 'index.html')));
  const production = join(scratch, 'production-site');
  succeeded(build(production));
  assert.ok(!existsSync(join(production, 'posts', 'regression-new-article', 'index.html')));
});

function workflowDestination(value, workflow) {
  const variables = new Map([...workflow.matchAll(/^\s+([A-Z_]\w*):\s*(.+?)\s*$/gm)].map(match => [match[1], match[2]]));
  let result = value;
  for (let pass = 0; pass < 3; pass++) {
    result = result.replace(/\$\{\{\s*env\.([A-Z_]\w*)\s*\}\}|\$\{([A-Z_]\w*)\}|\$([A-Z_]\w*)/g,
      (original, expression, bracketed, plain) => variables.get(expression || bracketed || plain) || original);
  }
  return result.replace(/\$\{\{\s*runner\.temp\s*\}\}|\$\{RUNNER_TEMP\}|\$RUNNER_TEMP/g, '/__runner_temp__')
    .replace(/^['"]|['"]$/g, '').replace(/^\.\//, '').trim();
}

test('CI builds into a clean independent destination and uploads that same directory', () => {
  const workflow = readFileSync(join(project, '.github', 'workflows', 'hugo.yml'), 'utf8');
  const command = workflow.split('\n').find(line => /\bhugo\s+.*--minify/.test(line)) || '';
  const destinationMatch = command.match(/--destination(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/);
  assert.ok(destinationMatch, 'CI must explicitly select an independent destination');
  assert.match(command, /--cleanDestinationDir/);
  const upload = workflow.match(/uses:\s*actions\/upload-pages-artifact@[^\n]+\n\s+with:\s*\n\s+path:\s*(.+)/);
  assert.ok(upload, 'Pages artifact must declare its path');
  const built = workflowDestination(destinationMatch[1] || destinationMatch[2] || destinationMatch[3], workflow);
  const uploaded = workflowDestination(upload[1], workflow);
  assert.notEqual(built, 'public', 'Tracked historical public files must not enter the deployment');
  assert.equal(uploaded, built);
  assert.match(workflow, /(?:run:\s*|\n\s+)(?:sh\s+|bash\s+)?(?:\.\/)?scripts\/test\.sh/);
});

test('Clean destination build removes a stale published page instead of republishing it', () => {
  const output = join(scratch, 'clean-site');
  const stale = join(output, 'retired-post', 'index.html');
  mkdirSync(dirname(stale), { recursive: true });
  writeFileSync(stale, 'Previously published content');
  // The broken archetype fixture is isolated from this cleanup assertion.
  rmSync(join(content, 'posts', 'regression-new-article.md'), { force: true });
  succeeded(build(output, ['--cleanDestinationDir']));
  assert.ok(!existsSync(stale));
  assert.ok(existsSync(join(output, 'index.html')));
});
