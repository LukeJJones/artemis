import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, find, bot, shape } from './markdown-renderer-harness.mjs';

test('bot literal emphasis markers become semantic strong/em/strike only for bots', () => {
  const f = fixture([bot('**Bold** and *italic* and ~~gone~~'), { role: 'user', row_id: 8, content: '**Keep literal**' }]);
  assert.equal(find(f.messages, 'strong')[0]?.textContent, 'Bold');
  assert.equal(find(f.messages, 'em')[0]?.textContent, 'italic');
  assert.equal(find(f.messages, 's')[0]?.textContent, 'gone');
  assert.equal(f.messages.children[1].textContent, 'You**Keep literal**');
});
test('bot paragraphs and soft/hard line breaks have deliberate semantics', () => {
  const f = fixture([bot('First\nsecond  \nthird\n\nNext paragraph')]);
  assert.equal(find(f.messages, 'p').length, 2);
  assert.equal(find(f.messages, 'br').length, 2);
});
test('nested lists, headings and blockquotes are real semantic elements', () => {
  const f = fixture([bot('# Heading\n\n> A quote\n\n3. first\n   - nested\n4. second')]);
  assert.equal(find(f.messages, 'h2')[0]?.textContent, 'Heading');
  assert.equal(find(f.messages, 'blockquote')[0]?.textContent, 'A quote');
  assert.equal(find(f.messages, 'ol')[0]?.start, 3);
  assert.equal(find(f.messages, 'ul').length, 1);
});
test('fenced and inline code preserve code text, never interpret it', () => {
  const code = '<img src=x onerror=alert(1)>\n  **not bold** &amp;\n';
  const f = fixture([bot('`<script>`\n\n```html\n' + code + '```')]);
  assert.equal(find(f.messages, 'pre')[0]?.textContent, code);
  assert.equal(find(f.messages, 'code')[0]?.textContent, '<script>');
  assert.equal(find(f.messages, 'img').length, 0);
});
test('safe external HTTPS links are explicit and hardened', () => {
  const f = fixture([bot('[Example](https://example.invalid/path?q=1&b=2)')]);
  const a = find(f.messages, 'a')[0]; assert.ok(a);
  assert.equal(a.href, 'https://example.invalid/path?q=1&b=2');
  assert.equal(a.target, '_blank'); assert.equal(a.rel, 'noopener noreferrer'); assert.equal(a.referrerPolicy, 'no-referrer');
});
test('GitHub-style table uses headers inside a keyboard-scrollable local region', () => {
  const f = fixture([bot('| Name | Value |\n| --- | --- |\n| **One** | `two` |')]);
  assert.equal(find(f.messages, 'table').length, 1);
  assert.equal(find(f.messages, 'th').length, 2);
  assert.equal(find(f.messages, 'th')[0].scope, 'col');
  assert.equal(find(f.messages, 'table')[0].parentNode.tabIndex, 0);
});
test('identical rerenders keep nodes, draft, raw rows and existing feed ownership', () => {
  const rows = Object.freeze([bot('**One**')]); const f = fixture(rows);
  const article = f.messages.children[0], before = JSON.stringify(shape(f.messages));
  f.render(rows); f.render(rows);
  assert.equal(f.messages.children[0], article); assert.equal(JSON.stringify(shape(f.messages)), before);
  assert.equal(f.$('draft').value, f.state.draft); assert.equal(f.calls.fitDraft, 0);
  assert.equal(f.document.activeElement, f.$('draft')); assert.equal(f.calls.capture, f.calls.restore);
});
