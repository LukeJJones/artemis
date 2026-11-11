// Source-only synthetic DOM: executes the actual renderer from the accepted/candidate app.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { emptyPresentation } from '../dashboard/assets/view-state.mjs';
import { Conversation } from '../dashboard/assets/conversation.mjs';
export class Element {
  constructor(tag = 'div', type = 1) { this.tagName = tag.toUpperCase(); this.nodeType = type; this.childNodes = []; this.dataset = {}; this.attributes = {}; this.hidden = false; this.value = ''; this.ownText = ''; }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  get textContent() { return this.ownText + this.childNodes.map(n => n.textContent).join(''); }
  set textContent(value) { this.ownText = String(value); for (const n of this.childNodes) n.parentNode = null; this.childNodes = []; }
  set innerHTML(_) { throw new Error('HTML sink forbidden'); }
  insertAdjacentHTML() { throw new Error('HTML sink forbidden'); }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] ?? null; }
  get classList() { return { add: name => { this.className = [this.className, name].filter(Boolean).join(' '); }, contains: name => (this.className || '').split(' ').includes(name) }; }
  append(...nodes) { for (const n of nodes) this.insertBefore(n, null); }
  insertBefore(n, before) {
    if (n.nodeType === 11) { for (const child of [...n.childNodes]) this.insertBefore(child, before); return n; }
    if (n === before) return n;
    n.remove(); const at = before ? this.childNodes.indexOf(before) : this.childNodes.length;
    assert.ok(at >= 0); this.childNodes.splice(at, 0, n); n.parentNode = this; return n;
  }
  remove() { if (this.parentNode) { const a = this.parentNode.childNodes; a.splice(a.indexOf(this), 1); this.parentNode = null; } }
  replaceChildren(...nodes) { this.textContent = ''; this.append(...nodes); }
  focus() { throw new Error('Renderer must not take focus'); }
  scrollIntoView() { throw new Error('Renderer must not take scroll'); }
  scrollTo() { throw new Error('Renderer must not take scroll'); }
}
export function find(root, tag) { return [root, ...root.childNodes.flatMap(n => find(n, tag))].filter(n => n.tagName === tag.toUpperCase()); }
export function shape(n) {
  return { tag: n.tagName, text: n.ownText, class: n.className, attrs: n.attributes, href: n.href, target: n.target, rel: n.rel, referrerPolicy: n.referrerPolicy, tabIndex: n.tabIndex, scope: n.scope, start: n.start, children: n.childNodes.map(shape) };
}
export function fixture(rows = []) {
  const nodes = new Map(); const $ = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  const calls = { capture: 0, restore: 0, fitDraft: 0 };
  const document = { hidden: false, body: new Element('body'), activeElement: $('draft'), createElement: tag => new Element(tag), createTextNode: s => { const n = new Element('#text', 3); n.textContent = s; return n; }, createDocumentFragment: () => new Element('#fragment', 11), querySelector: $ };
  const state = { phase: 'ready', notice: 'Connected. History is saved by Hermes.', draft: 'Draft remains *literal*', rows, sessionId: 'synthetic-session' };
  const model = { state, settings: { sender: 'Synthetic bot' }, visibleRows: () => state.rows, isWorking: () => false };
  $('draft').value = state.draft;
  const context = vm.createContext({ Conversation, model, document, $, gateway: { connected: true }, emptyPresentation, URL, location: { origin: 'https://artemis.invalid' },
    feed: { capture() { calls.capture++; return { anchor: 'synthetic-reader', top: 123 }; }, restore(s) { assert.equal(s.top, 123); calls.restore++; } },
    fitDraft() { calls.fitDraft++; }, sender: () => 'Synthetic bot', text: (n, v) => { n.textContent = v; },
    fetch() { throw new Error('Network forbidden'); }, setTimeout() { throw new Error('New timer forbidden'); } });
  const app = fs.readFileSync(new URL('../dashboard/assets/app.mjs', import.meta.url), 'utf8');
  const start = app.indexOf('function renderNotice('), end = app.indexOf('initAppearance();', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext((app.match(/\/\/ Opening paint only:[\s\S]*?const openingLabels = new Map\(\);\r?\n/)?.[0] || '') + "let identityFence=false,pendingSelection=null,rosterPhase='ready',view='chat',renderedRows='',lastReply='',lastDelivery='',initialHistory=true,lastWorking=false,lastAttention='',failures=0,reconnectTimer=null;\n" + app.slice(start, end), context);
  const render = next => { if (next) state.rows = next; const before = JSON.stringify(state); vm.runInContext('render(model.state)', context); assert.equal(JSON.stringify(state), before, 'renderer changed raw state'); };
  render(); return { document, $, state, model, context, calls, render, messages: $('messages') };
}
export const bot = (content, row_id = 7) => Object.freeze({ role: 'assistant', row_id, content });
