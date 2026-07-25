// Reads the visible copy out of the pages in public/, two ways:
//
//   items(file)      - every line of text in reading order, tagged with what kind of element
//                      it came from (heading, field label, button, placeholder, list item).
//   containers(file) - the same text grouped into the panels a visitor actually sees.
//
// This is a deliberately small purpose-built reader, not a general HTML parser. Two details in
// these pages forced its shape:
//
//   1. index.html contains an unclosed <p> (inside "What to Include When Contacting Support").
//      Browsers close it at the next block boundary; a naive lazy regex instead swallows the rest
//      of the section, collapsing about a hundred lines into one blob. So leaf text is cut at the
//      first structural tag it runs into.
//   2. Text is scattered across bare <div>s rather than paragraphs, which produces a shower of
//      one-word fragments. Consecutive plain-text runs are merged back into sentences, but never
//      across a child-element boundary, or separate captions glue together.

const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.resolve(__dirname, '..', '..', 'public');

const ENTITIES = {
  '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&lt;': '<', '&gt;': '>',
  '&rarr;': '→', '&larr;': '←', '&mdash;': '—', '&ndash;': '–',
  '&times;': '×', '&copy;': '©', '&check;': '✓', '&hellip;': '…',
  '&bull;': '•', '&ldquo;': '“', '&rdquo;': '”', '&lsquo;': '‘', '&rsquo;': '’',
};
const decode = (s) => s.replace(/&[a-zA-Z#0-9]+;/g, (m) => (ENTITIES[m] !== undefined ? ENTITIES[m] : m));
const clean = (s) => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// Elements that hold other elements, versus elements that hold text.
const STRUCTURAL = new Set(['div', 'section', 'main', 'header', 'footer', 'form', 'ul', 'ol',
  'table', 'tbody', 'thead', 'tr', 'nav', 'aside', 'fieldset']);
const LEAF = 'h1|h2|h3|h4|h5|p|li|label|button|option|td|th|legend|figcaption';
const BLEED = new RegExp(
  '<\\/?(?:' + [...STRUCTURAL].join('|') + ')\\b', 'i');

/** Builds a tree of structural elements whose leaves are tagged text runs. */
function parse(file) {
  let html = fs.readFileSync(path.join(PUBLIC_DIR, `${file}.html`), 'utf8')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // keep only the <title> from the head, tagged so it can be labelled in the output
    .replace(/<head[\s\S]*?<\/head>/i, (head) => {
      const title = (head.match(/<title>([\s\S]*?)<\/title>/i) || [])[1];
      return title ? `<p data-kind="title">${title}</p>` : '';
    });

  // Placeholder text is real user-visible copy, so lift it out of the input tag into a text run.
  // Match the quote character exactly - "Bring water and sunscreen!" contains an apostrophe and a
  // ["'] character class truncates the string there.
  html = html
    .replace(/<(input|textarea)\b[^>]*placeholder="([^"]*)"[^>]*>/gi, '<p data-kind="placeholder">$2</p>')
    .replace(/<(input|textarea)\b[^>]*placeholder='([^']*)'[^>]*>/gi, '<p data-kind="placeholder">$2</p>')
    .replace(/<br\s*\/?>/gi, ' ');

  const root = { tag: 'root', cls: '', id: '', kids: [] };
  const stack = [root];
  const re = new RegExp(
    `<(${LEAF})\\b([^>]*)>([\\s\\S]*?)<\\/\\1>|<(\\/?)([a-zA-Z][a-zA-Z0-9]*)\\b([^>]*?)(\\/?)>|([^<]+)`, 'gi');

  let m;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];

    if (m[1]) { // a leaf element with its text
      const tag = m[1].toLowerCase();
      const dataKind = (m[2] || '').match(/data-kind=["']([^"']*)["']/);
      let inner = m[3];
      const bleed = inner.search(BLEED);
      if (bleed > -1) { // detail 1 above: an unclosed leaf tag
        const innerStart = m.index + m[0].length - m[3].length - (tag.length + 3);
        inner = inner.slice(0, bleed);
        re.lastIndex = innerStart + bleed;
      }
      const text = clean(inner);
      if (text) top.kids.push({ t: 'txt', kind: dataKind ? dataKind[1] : tag, text });
      continue;
    }

    if (m[5]) { // a structural tag
      const tag = m[5].toLowerCase();
      if (!STRUCTURAL.has(tag)) continue;
      if (m[4] === '/') { if (stack.length > 1) stack.pop(); continue; }
      if (m[7] === '/') continue;
      const attrs = m[6] || '';
      const node = {
        tag,
        cls: (attrs.match(/class=["']([^"']*)["']/) || [])[1] || '',
        id: (attrs.match(/id=["']([^"']*)["']/) || [])[1] || '',
        kids: [],
      };
      top.kids.push({ t: 'el', node });
      stack.push(node);
      continue;
    }

    if (m[8]) {
      const text = clean(m[8]);
      if (text) top.kids.push({ t: 'txt', kind: 'text', text });
    }
  }
  return root;
}

function findContainerEl(node) {
  const el = node.t === 'el' ? node.node : node;
  if (String(el.cls || '').split(/\s+/).includes('container')) return el;
  for (const kid of el.kids || []) {
    if (kid.t === 'el') {
      const found = findContainerEl(kid);
      if (found) return found;
    }
  }
  return null;
}

/** Flattens to text runs, inserting a boundary marker as each child element closes. */
function collect(node, acc = []) {
  for (const kid of node.kids) {
    if (kid.t === 'txt') acc.push(kid);
    else { collect(kid.node, acc); acc.push({ t: 'brk' }); }
  }
  return acc;
}

const realOnly = (list) => list.filter((i) => i.t !== 'brk');

/** Detail 2 above: rejoin sentence fragments, but stop at element boundaries. */
function condense(list) {
  const out = [];
  for (const item of list) {
    if (item.t === 'brk') {
      if (out.length) out[out.length - 1].closed = true;
      continue;
    }
    const plain = item.kind === 'text' || item.kind === 'p' || item.kind === 'span';
    const prev = out[out.length - 1];
    if (plain && prev && prev.kind === 'body' && !prev.closed) prev.text += ' ' + item.text;
    else if (plain) out.push({ kind: 'body', text: item.text });
    else out.push({ kind: item.kind, text: item.text });
  }
  return out.map(({ kind, text }) => ({ kind, text }));
}

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5']);

// Readable names for panels that have no heading of their own.
const CONTAINER_NAMES = {
  'form-section': 'Game details form', 'share-section': 'After you submit',
  'page-header': 'Page header', 'section-header': 'Page header', 'header-content': 'Page header',
  'input-group': 'Search box', 'footer-note': 'Fine print', 'content-section': 'Main content',
  'info-box': 'Callout box', 'demo-section': 'Demo walkthrough', 'step': 'Numbered step',
  'sample-messages': 'Sample text messages', 'privacy-section': 'Privacy points',
  'loading-section': 'While loading', 'expired-game-warning': 'Expired game notice',
  unauthorized: 'Wrong link notice', modal: 'Confirmation pop-up',
  'game-status-warning': 'Cancelled or expired notice', 'confirmation-section': 'After signing up',
  'mobile-tab-container': 'Tab bar (mobile)', 'tabs-container': 'Tab bar',
  'persistent-copy-bar': 'Sticky share bar', subsection: 'Subsection',
  'back-to-create': 'Closing call to action', 'toc-section': 'Section index',
};

function labelFor(node, list) {
  const heading = list.find((i) => i.t !== 'brk' && HEADINGS.has(i.kind));
  if (heading) return heading.text;
  for (const cls of String(node.cls || '').split(/\s+/)) {
    if (CONTAINER_NAMES[cls]) return CONTAINER_NAMES[cls];
  }
  if (node.id && CONTAINER_NAMES[node.id]) return CONTAINER_NAMES[node.id];
  const first = list.find((i) => i.t !== 'brk' && i.text.length > 3);
  return first ? first.text.slice(0, 60) : '(untitled)';
}

// Long pages nest two or three levels deep, so these get opened up rather than shown whole.
const EXPAND = {
  index: (n) => /\b(content-section|subsection|mode-flow-section|faq-section)\b/.test(n.cls),
  manage: (n) => n.id === 'gameManagement',
};
// The legal pages have no section divs to group by, only headings.
const BY_HEADING = new Set(['privacy', 'terms']);

/** Every text run on the page, in reading order. */
function items(file) {
  const root = parse(file);
  return realOnly(collect(root));
}

/** The page's panels, each with its own copy. */
function containers(file) {
  const root = parse(file);
  const main = findContainerEl(root) || root;
  const result = [];

  const title = realOnly(collect(root)).find((i) => i.kind === 'title');
  if (title) {
    result.push({ label: 'Browser tab title', kind: 'meta', depth: 0, items: [{ kind: 'body', text: title.text }] });
  }

  if (BY_HEADING.has(file)) {
    let current = null;
    for (const item of collect(main).filter((i) => i.t === 'brk' || i.kind !== 'title')) {
      if (item.t !== 'brk' && (item.kind === 'h1' || item.kind === 'h2')) {
        current = { label: item.text, kind: 'container', depth: 0, items: [] };
        result.push(current);
        continue;
      }
      if (!current) {
        current = { label: '(top of page)', kind: 'container', depth: 0, items: [] };
        result.push(current);
      }
      current.items.push(item);
    }
    result.forEach((c) => { c.items = condense(c.items); });
    return result.filter((c) => c.items.length);
  }

  const shouldExpand = EXPAND[file] || (() => false);

  function emit(node, depth) {
    const childEls = node.kids.filter((k) => k.t === 'el' && realOnly(collect(k.node)).length);
    if (!(shouldExpand(node) && childEls.length)) {
      const list = collect(node);
      if (realOnly(list).length) {
        result.push({ label: labelFor(node, list), kind: 'container', depth, items: condense(list) });
      }
      return;
    }
    // text sitting directly in this node ahead of its first child panel: its heading and intro
    const lead = [];
    for (const kid of node.kids) {
      if (kid.t === 'txt') { lead.push(kid); continue; }
      if (childEls.includes(kid)) break;
      lead.push(...collect(kid.node));
    }
    if (realOnly(lead).length) {
      result.push({ label: labelFor(node, lead), kind: 'heading', depth, items: condense(lead) });
    }
    for (const kid of childEls) emit(kid.node, depth + 1);
  }

  for (const kid of main.kids) {
    if (kid.t === 'txt') {
      if (kid.kind === 'title') continue;
      const prev = result[result.length - 1];
      if (prev && prev.kind === 'loose') prev.items.push({ kind: 'body', text: kid.text });
      else result.push({ label: 'Loose text', kind: 'loose', depth: 0, items: [{ kind: 'body', text: kid.text }] });
      continue;
    }
    emit(kid.node, 0);
  }
  return result;
}

/** Folds away thin wrappers that carry no content of their own. */
function tidy(list) {
  const out = [];
  for (const c of list) {
    const prev = out[out.length - 1];
    const thin = c.items.length <= 2 && (c.label === 'Subsection' || (prev && c.label === prev.label));
    if (thin && prev) { prev.items.push(...c.items); continue; }
    out.push({ ...c, items: [...c.items] });
  }
  return out;
}

module.exports = { items, containers, tidy, HEADINGS, PUBLIC_DIR };
