import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, bot } from './markdown-renderer-harness.mjs';
import { isDisplayableAssistant } from '../dashboard/assets/conversation.mjs';

test('nonempty markup-only streaming prefixes must not create header-only bot articles', () => {
  for (const content of ['#', '## ', '>', '-', '```', '```js\n', '```\n  \n```', '---']) {
    const row = bot(content); assert.equal(isDisplayableAssistant(row), true);
    const f = fixture([row]); const body = f.messages.children[0].children[1].children[1];
    assert.ok(body.textContent.trim().length > 0, JSON.stringify(content));
    assert.equal(body.textContent, content, 'empty rendered markup falls back to its complete original text');
    assert.equal(f.state.rows[0], row); assert.equal(f.state.rows[0].content, content);
  }
});
