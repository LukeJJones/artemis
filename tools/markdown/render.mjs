import MarkdownIt from './vendor/markdown-it-15.0.3.mjs';

// Only tokens are consumed. Parser HTML output, plugins, linkification and images
// are never used as DOM. This instance holds grammar/configuration, not messages.
const parser = new MarkdownIt({ html: false, linkify: false, typographer: false, maxNesting: 20 });
export const MARKDOWN_LIMITS = Object.freeze({ characters: 32000, tokens: 6000, nesting: 20 });
const TAGS = Object.freeze({ paragraph_open: 'p', strong_open: 'strong', em_open: 'em', s_open: 's', blockquote_open: 'blockquote', bullet_list_open: 'ul', ordered_list_open: 'ol', list_item_open: 'li', table_open: 'table', thead_open: 'thead', tbody_open: 'tbody', tr_open: 'tr', th_open: 'th', td_open: 'td' });
const RAW_URL_FORBIDDEN = /[\p{Cc}\p{Cf}\p{White_Space}\ufffd\\]/u;
const DECODED_URL_FORBIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\ufffd\\]/u;
function safeURLRepresentation(value) {
  if (typeof value !== 'string' || RAW_URL_FORBIDDEN.test(value) || /%25/i.test(value)) return false;
  // Decode only to reject. Never navigate to a repaired or decoded destination.
  try { return !DECODED_URL_FORBIDDEN.test(decodeURIComponent(value)); } catch { return false; }
}
export function safeMarkdownURL(value, ownOrigin = globalThis.location?.origin) {
  if (typeof value !== 'string' || !/^https:\/\//i.test(value) || !safeURLRepresentation(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || !safeURLRepresentation(url.href)) return null;
    // Reject DNS terminal-dot destinations, including percent/Unicode dot forms
    // exposed by URL parsing. Never remove a dot to repair a navigation target.
    if (url.hostname.endsWith('.')) return null;
    // Origin spelling may itself have a terminal dot. Normalize identity ONLY
    // for comparison; URL supplies case/percent/IDN normalization on both sides.
    const destinationHost = url.hostname.toLowerCase();
    const currentHost = ownOrigin ? new URL(ownOrigin).hostname.toLowerCase().replace(/\.+$/, '') : null;
    if (currentHost !== null && (!currentHost || destinationHost === currentHost)) return null;
    return url.href;
  } catch { return null; }
}
// Preserve the historical raw-source URL guards BEFORE parser normalization.
// Only public instance extension points are wrapped; publisher bytes stay pinned.
// Rejections are local to ONE synchronous parse, never retained between messages.
// A rejected decoded angle destination must not revive as a different raw
// autolink. Enforce after parsing too, so reference/inline ordering cannot matter.
let activeRejectedFallbacks = null;
const parseDestination = parser.helpers.parseLinkDestination;
parser.helpers = { ...parser.helpers, parseLinkDestination(source, start, end) {
  const result = parseDestination(source, start, end);
  if (result.ok) {
    const raw = source[start] === '<' ? source.slice(start + 1, result.pos - 1) : source.slice(start, result.pos);
    const rawAllowed = safeURLRepresentation(raw);
    if (source[start] === '<' && (!rawAllowed || !parser.normalizeLink(result.str))) {
      const fallback = parser.normalizeLink(raw);
      const href = fallback && safeMarkdownURL(fallback, null);
      if (href) activeRejectedFallbacks?.add(href);
    }
    if (!rawAllowed) return { ...result, ok: false };
  }
  return result;
} };
const normalizeLink = parser.normalizeLink;
parser.normalizeLink = value => {
  // Capture the intended WHATWG destination BEFORE the parser's IDN/URI
  // normalization. A different serialized target must stay inert, not be fixed
  // up into a link. In particular uppercase Unicode IDNs can punycode differently.
  const intended = safeMarkdownURL(value, null);
  if (!intended) return '';
  const normalized = normalizeLink(value);
  return safeMarkdownURL(normalized, null) === intended ? normalized : '';
};
const validateLink = parser.validateLink;
parser.validateLink = value => validateLink(value) && safeMarkdownURL(value, null) !== null;
// markdown-it may skip content at its nesting boundary. Detect before loss and
// show the COMPLETE original source instead of silently dropping message text.
for (const [owner, method] of [[parser.block, 'tokenize'], [parser.inline, 'tokenize'], [parser.inline, 'skipToken']]) {
  const original = owner[method];
  owner[method] = function(state, ...args) {
    if (state.level >= MARKDOWN_LIMITS.nesting) state.env.markdownNestingExhausted = true;
    return original.call(this, state, ...args);
  };
}
export function renderBotMarkdown(source, { document = globalThis.document, ownOrigin = globalThis.location?.origin } = {}) {
  const root = document.createElement('div'); root.className = 'markdown';
  root.setAttribute('role', 'group'); root.setAttribute('aria-label', 'Bot message content');
  const plain = () => { root.classList.add('markdown-plain'); const p = document.createElement('p'); p.textContent = typeof source === 'string' ? source : ''; root.replaceChildren(p); return root; };
  // NUL is normalized away before parser destination hooks; fail closed first.
  if (typeof source !== 'string' || source.length > MARKDOWN_LIMITS.characters || source.includes('\u0000')) return plain();
  try {
    const environment = {}; const rejectedFallbacks = new Set();
    const previousRejections = activeRejectedFallbacks; let tokens;
    activeRejectedFallbacks = rejectedFallbacks;
    try { tokens = parser.parse(source, environment); }
    finally { activeRejectedFallbacks = previousRejections; }
    if (environment.markdownNestingExhausted) return plain();
    let count = 0; const pending = [...tokens];
    while (pending.length) {
      const token = pending.pop(); if (++count > MARKDOWN_LIMITS.tokens) return plain();
      if (token.children) pending.push(...token.children);
    }
    const stack = [root];
    function walk(list) {
      for (const token of list) {
        if (token.hidden && (token.type === 'paragraph_open' || token.type === 'paragraph_close')) continue;
        const parent = stack.at(-1);
        if (token.type === 'inline') { walk(token.children || []); continue; }
        if (token.type === 'fence' || token.type === 'code_block') {
          const pre = document.createElement('pre'); pre.tabIndex = 0;
          pre.setAttribute('role', 'region'); pre.setAttribute('aria-label', 'Code in bot message');
          const code = document.createElement('code'); code.textContent = token.content;
          pre.append(code); parent.append(pre); continue;
        }
        if (token.type === 'text') { parent.append(document.createTextNode(token.content)); continue; }
        if (token.type === 'code_inline') { const code = document.createElement('code'); code.textContent = token.content; parent.append(code); continue; }
        // Chat linebreak policy: both soft and hard newlines become line breaks;
        // blank lines retain separate paragraph semantics.
        if (token.type === 'softbreak' || token.type === 'hardbreak' || token.type === 'hr') {
          parent.append(document.createElement(token.type === 'hr' ? 'hr' : 'br')); continue;
        }
        if (token.type === 'image') {
          const note = document.createElement('span'); note.className = 'markdown-image-note';
          note.textContent = '[Image not loaded' + (token.content ? ': ' + token.content : '') + ']'; parent.append(note); continue;
        }
        if (token.nesting === -1) { if (stack.length > 1) stack.pop(); continue; }
        if (token.nesting === 1) {
          let node;
          if (token.type === 'link_open') {
            let href = safeMarkdownURL(token.attrGet('href'), ownOrigin);
            if (rejectedFallbacks.has(href)) href = null;
            node = document.createElement(href ? 'a' : 'span');
            if (href) {
              node.href = href; node.target = '_blank'; node.rel = 'noopener noreferrer'; node.referrerPolicy = 'no-referrer';
              node.title = href + ' (opens in new tab)'; node.setAttribute('aria-description', 'External HTTPS link; opens in a new tab.');
            }
          } else if (token.type === 'heading_open') {
            node = document.createElement('h' + (/^h[1-6]$/.test(token.tag) ? Math.min(6, Number(token.tag[1]) + 1) : 3));
          } else if (Object.hasOwn(TAGS, token.type)) {
            node = document.createElement(TAGS[token.type]);
            if (token.type === 'ordered_list_open') { const start = token.attrGet('start'); if (start && /^\d{1,9}$/.test(start)) node.start = Number(start); }
            if (token.type === 'th_open') node.scope = 'col';
          } else node = document.createElement('span');
          if (token.type === 'table_open') {
            const region = document.createElement('div'); region.className = 'markdown-table'; region.tabIndex = 0;
            region.setAttribute('role', 'region'); region.setAttribute('aria-label', 'Table in bot message'); region.append(node); parent.append(region);
          } else parent.append(node);
          stack.push(node); continue;
        }
        // No token-provided tags, arbitrary attributes, HTML, style or handlers.
        if (token.content) parent.append(document.createTextNode(token.content));
      }
    }
    walk(tokens);
    // A partial '#' or empty fence is nonempty canonical source but can parse
    // into no readable text. Never reintroduce a header-only Bot row while
    // streaming: retain the original markers rather than hiding/mutating a row.
    return root.textContent.trim() ? root : plain();
  } catch { return plain(); }
}
