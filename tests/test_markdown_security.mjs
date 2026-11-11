import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fixture, find, bot, shape } from './markdown-renderer-harness.mjs';
import { renderBotMarkdown, safeMarkdownURL, MARKDOWN_LIMITS } from '../tools/markdown/render.mjs';
const ownOrigin = 'https://artemis.invalid';
test('all ASCII/C1 controls and Unicode format controls are rejected before and after percent encoding', () => {
  const points = [...Array.from({length:32}, (_, i) => i), ...Array.from({length:33}, (_, i) => i + 127), 0xad, 0x61c, 0x180e, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2028, 0x2029, 0x202a, 0x202e, 0x2060, 0x2066, 0x2069, 0xfeff];
  for (const point of points) for (const value of [String.fromCodePoint(point), encodeURIComponent(String.fromCodePoint(point))]) {
    const url = 'https://example.invalid/' + value + 'x';
    assert.equal(safeMarkdownURL(url, ownOrigin), null, point.toString(16));
    assert.equal(find(fixture([bot('[x](<' + url + '>)')]).messages, 'a').length, 0, point.toString(16));
  }
});
const forbidden = [
  'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<svg/onload=1>', 'vbscript:msgbox(1)',
  'file:///C:/private', 'blob:https://example.invalid/a', 'ftp://example.invalid', 'http://example.invalid',
  '//example.invalid/a', '/api/admin', '#admin', 'mailto:example@example.invalid',
  'https://user@example.invalid', 'https://user:password@example.invalid',
  'https://artemis.invalid/auth/logout', 'https://artemis.invalid:9443/api/admin',
  'https://example.invalid/\\evil', 'https://example.invalid/\u202eevil', 'https://example.invalid/\u2066evil',
  'https://example.invalid/\u0000evil', 'https://example.invalid/\u0085evil',
  'https://example.invalid/%0aevil', 'https://example.invalid/%0Devil', 'https://example.invalid/%00evil',
  'https://example.invalid/%5Cevil', 'https://example.invalid/%E2%80%AEevil', 'https://example.invalid/%E2%81%A6evil',
  'https://example.invalid/%250aevil', 'https://example.invalid/%25250aevil', 'https://example.invalid/%zz',
  'https://example.invalid/%', 'https://example.invalid/%C0%AF', 'https://example.invalid/\ud800',
  'https://example.invalid\t.evil.invalid/a', 'https://example.invalid/\u200fevil', 'https://example.invalid/%C2%85evil',
];
for (const [index, url] of forbidden.entries()) test(`URL allowlist rejects direct and rendered adversarial destination ${index}`, () => {
  assert.equal(safeMarkdownURL(url, ownOrigin), null);
  for (const text of ['[label](' + url + ')', '[label](<' + url + '>)', '<' + url + '>', '[label][ref]\n\n[ref]: ' + url]) {
    const f = fixture([bot(text)]); assert.equal(find(f.messages, 'a').length, 0, JSON.stringify(text));
  }
});
for (const [index, url] of [
  'java&#x73;cript:alert(1)', 'jav&#97;script:alert(1)', '&#106;avascript:alert(1)',
  'https://example.invalid/&#13;evil', 'https://example.invalid/&#10;evil', 'https://example.invalid/&#x202e;evil',
].entries()) test(`parser cannot normalize entity-obfuscated destination into a link ${index}`, () => {
  const f = fixture([bot('[label](' + url + ')')]); assert.equal(find(f.messages, 'a').length, 0);
});
for (const url of ['https://example.invalid/path?q=1&b=2', 'HTTPS://EXAMPLE.INVALID/path', 'https://example.invalid/a%20b', 'https://example.invalid/café', 'https://example.invalid/a(b)']) test(`allowed HTTPS destination stays explicit: ${url}`, () => {
  const f = fixture([bot('[label](<' + url + '>)')]); const a = find(f.messages, 'a')[0]; assert.ok(a);
  assert.equal(a.href, new URL(url).href); assert.equal(a.target, '_blank'); assert.equal(a.rel, 'noopener noreferrer');
  assert.equal(a.referrerPolicy, 'no-referrer'); assert.match(a.attributes['aria-description'], /new tab/);
});
const attacks = [
  '<script>globalThis.pwned=1</script>', '<img src="https://beacon.invalid/pixel" onerror="globalThis.pwned=1">',
  '<svg onload="globalThis.pwned=1"><a xlink:href="javascript:alert(1)">x</a></svg>',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>', '<style>*{display:none}</style>',
  '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=alert(1)>">',
  '[x](javascript:alert(1))', '<a href="https://example.invalid" ping="https://beacon.invalid">x</a>',
  '```"><svg/onload=alert(1)>\n<img src=x onerror=alert(1)>\n```',
  '![<svg/onload=alert(1)>](https://beacon.invalid/pixel)',
  '<video autoplay src="https://beacon.invalid/video"></video>', '<form action="/auth/logout"><input autofocus></form>',
];
for (const [i, text] of attacks.entries()) test(`raw HTML/image/code attack ${i} is inert text or safe code, never active DOM`, () => {
  const f = fixture([bot(text)]);
  for (const tag of ['script', 'img', 'svg', 'iframe', 'style', 'math', 'video', 'audio', 'source', 'object', 'embed', 'form', 'input']) assert.equal(find(f.messages, tag).length, 0, tag);
  function audit(node) { for (const key of Object.keys(node.attributes)) assert.ok(!/^on|style|src|srcdoc|ping/i.test(key), key); for (const child of node.childNodes) audit(child); }
  audit(f.messages); assert.equal(f.context.pwned, undefined);
});
test('remote and data images never create an image/load target', () => {
  const f = fixture([bot('![Alt *text*](https://beacon.invalid/pixel)\n\n![x](data:image/svg+xml,xxx)')]);
  assert.equal(find(f.messages, 'img').length, 0); assert.match(f.messages.textContent, /Image not loaded: Alt \*text\*/);
});
test('user/system/tool bodies keep exact plain text and never gain Markdown links/tags', () => {
  const value = '**Literal**\n<script>x</script> [link](https://example.invalid)';
  const f = fixture(['user', 'system', 'tool'].map((role, row_id) => Object.freeze({ role, row_id, content: value })));
  assert.equal(find(f.messages, 'strong').length, 0); assert.equal(find(f.messages, 'a').length, 0);
  assert.deepEqual(find(f.messages, 'p').map(p => p.textContent), [value, value, value]);
});
test('all streaming prefixes of malformed, unclosed and complete Markdown are safe/deterministic', () => {
  const source = '# A heading\n\n**bold _nested_**\n\n> quote\n\n- one\n  - two\n\n```html\n<script>boom()</script>\n```\n\n| A | B |\n| --- | --- |\n| x | y |\n\n[label](https://example.invalid/path)\n\n<img src=x onerror=boom()>\n\n**unclosed';
  const f = fixture();
  for (let i = 1; i <= source.length; i++) {
    const rows = Object.freeze([bot(source.slice(0, i))]); f.render(rows);
    assert.equal(f.messages.children.length, 1); const before = JSON.stringify(shape(f.messages)); const node = f.messages.children[0];
    f.render(rows); assert.equal(f.messages.children[0], node); assert.equal(JSON.stringify(shape(f.messages)), before);
    assert.equal(find(f.messages, 'script').length, 0); assert.equal(find(f.messages, 'img').length, 0);
    assert.equal(f.$('draft').value, f.state.draft); assert.equal(f.document.activeElement, f.$('draft'));
  }
});
test('unchanged reader node/focus/local scroll survive sibling streaming and append', () => {
  const first = bot('[Read](https://example.invalid)\n\n```txt\nlong code\n```', 1);
  const f = fixture([first, bot('Part', 2)]); const article = f.messages.children[0], link = find(article, 'a')[0], code = find(article, 'pre')[0];
  f.document.activeElement = link; code.scrollLeft = 90;
  f.render([first, bot('**Partial**', 2), bot('New row', 3)]);
  assert.equal(f.messages.children[0], article); assert.equal(find(article, 'a')[0], link);
  assert.equal(f.document.activeElement, link); assert.equal(code.scrollLeft, 90); assert.equal(f.messages.children.length, 3);
  assert.equal(f.calls.fitDraft, 0); assert.equal(f.calls.capture, f.calls.restore);
});
test('duplicate raw row IDs are not silently collapsed; changes/removals/reorder do not duplicate articles', () => {
  const a = bot('**A**', 1), b = bot('B', 1); const f = fixture([a, b]);
  assert.equal(f.messages.children.length, 2); f.render([a, bot('C', 1)]); assert.equal(f.messages.children.length, 2);
  f.render([bot('D', 2), a]); assert.equal(f.messages.children.length, 2);
  assert.deepEqual(f.messages.children.map(n => n.dataset.scrollKey), ['row:2', 'row:1']);
  f.render([]); assert.equal(f.messages.children.length, 0);
});
test('large/token-heavy/deep inputs fail closed to complete original source, never silently truncate', () => {
  const cases = ['x'.repeat(MARKDOWN_LIMITS.characters + 1), '*x* '.repeat(4000), '> '.repeat(50) + 'Deep text', '[x]('.repeat(100) + 'https://example.invalid' + ')'.repeat(100), 'before\u0000after'];
  for (const source of cases) {
    const f = fixture([bot(source)]); const root = f.messages.children[0].children[1].children[1];
    if (source.startsWith('[x](')) assert.match(root.textContent, /x/);
    else { assert.ok(root.classList.contains('markdown-plain'), source.slice(0, 50)); assert.equal(root.textContent, source); }
  }
});
test('generated app DOM equals authored renderer DOM for representative supported subset', () => {
  const source = '# Heading\n\n**Bold** *italic* ~~gone~~\n\n> Quote\n\n2. One\n   - nested\n\n`<tag>`\n\n```js\n  x < y && z\n```\n\n| A | B |\n| --- | --- |\n| X | Y |\n\n[site](https://example.invalid)';
  const f = fixture([bot(source)]), actual = f.messages.children[0].children[1].children[1];
  const expected = renderBotMarkdown(source, { document: f.document, ownOrigin }); assert.deepEqual(shape(actual), shape(expected));
});
test('parser runtime is fail-closed if safe DOM construction fails during formatted output', () => {
  const f = fixture(); const create = f.document.createElement;
  const document = { ...f.document, createElement(tag) { if (tag === 'strong') throw new Error('synthetic allocation failure'); return create(tag); } };
  const root = renderBotMarkdown('**Complete source**', { document, ownOrigin });
  assert.equal(root.textContent, '**Complete source**'); assert.ok(root.classList.contains('markdown-plain'));
});
test('DOM surface is allowlisted and code/tables keyboard-scroll locally; no added motion/UI controls', () => {
  const f = fixture([bot('```txt\nA very long line\n```\n\n| A | B |\n| --- | --- |\n| C | D |')]);
  const pre = find(f.messages, 'pre')[0], table = find(f.messages, 'table')[0];
  assert.equal(pre.tabIndex, 0); assert.equal(pre.attributes.role, 'region'); assert.ok(pre.attributes['aria-label']);
  assert.equal(table.parentNode.tabIndex, 0); assert.equal(find(f.messages, 'button').length, 0);
  const css = fs.readFileSync(new URL('../dashboard/assets/chat.css', import.meta.url), 'utf8');
  for (const selector of ['.reply .markdown pre', '.reply .markdown-table']) {
    const rule = css.match(new RegExp(selector.replaceAll('.', '\\.') + '\\{([^}]+)\\}'))?.[1];
    assert.match(rule, /max-width:100%/); assert.match(rule, /overflow-x:auto/); assert.match(rule, /min-width:0/);
  }
  assert.match(css, /prefers-reduced-motion:reduce/);
  const authored = fs.readFileSync(new URL('../tools/markdown/render.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(authored, /innerHTML|insertAdjacentHTML|eval\(|new Function|fetch\(|clipboard|setTimeout\(/);
});
