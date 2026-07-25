// Writes two views of the app's fixed text, so a change can be asked for by address.
//
//   npm run docs:copy
//
// Produces, in docs/:
//   containers.html - the panels a visitor sees, each shown whole with its copy. Addressed
//                     page.container, e.g. 4.11 is the Game Actions panel on manage.html.
//   copy-deck.html  - every individual line, addressed page.line. More precise, much denser.
//
// Reads public/*.html directly. Nothing is started and nothing is written outside docs/.
// Text the app generates while running - rosters, status messages, every SMS - is not in here;
// that lives in public/js/ and sms-handler.js.

const fs = require('fs');
const path = require('path');
const { items, containers, tidy, HEADINGS } = require('./lib/page-text');
const { page, escapeHtml: esc, generatedNote } = require('./lib/doc-shell');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs');

const PAGES = [
  { n: 1, key: 'index', name: 'Home / Guide', route: '/ (index.html)', lane: 'In the nav', who: 'Anyone',
    note: 'The homepage. It opens as a short landing page — each guide section below stays hidden until you tap its card.' },
  { n: 2, key: 'create', name: 'Create a Game', route: '/create.html', lane: 'In the nav', who: 'Organizers',
    note: 'One long form, then a share panel that replaces it.' },
  { n: 3, key: 'game', name: 'Invite Page', route: '/game.html?id=…', lane: 'Link only', who: 'Players',
    note: 'These panels show and hide to make several different screens. Only some are visible at once.' },
  { n: 4, key: 'manage', name: 'Game Management', route: '/manage.html?id=…&token=…', lane: 'Link only', who: 'Host only',
    note: 'The four tabs, plus the header, the notices and the confirm pop-up.' },
  { n: 5, key: 'my-games', name: 'My Games', route: '/my-games.html', lane: 'In the nav', who: 'Organizers',
    note: 'The game list is built by JavaScript, so only the frame and the empty state are fixed text.' },
  { n: 6, key: 'lookup', name: 'Find My Games', route: '/lookup.html', lane: 'In the nav', who: 'Organizers',
    note: 'Results appear after searching, so the page itself is a prompt and a button.' },
  { n: 7, key: 'demo', name: 'SMS Consent Demo', route: '/demo.html', lane: 'Unlinked', who: 'Carrier reviewers',
    note: 'Describes a signup flow the app no longer has. Nothing links here.' },
  { n: 8, key: 'privacy', name: 'Privacy Policy', route: '/privacy.html', lane: 'In the footer', who: 'Anyone',
    note: 'Numbered legal sections.' },
  { n: 9, key: 'terms', name: 'Terms of Service', route: '/terms.html', lane: 'In the footer', who: 'Anyone',
    note: 'Numbered legal sections.' },
];

const KIND_LABEL = {
  title: ['Browser tab', 'k-meta'], h1: ['Page title', 'k-h'], h2: ['Heading', 'k-h'],
  h3: ['Subheading', 'k-h'], h4: ['Small heading', 'k-h'], h5: ['Small heading', 'k-h'],
  label: ['Field label', 'k-form'], button: ['Button', 'k-btn'],
  placeholder: ['Placeholder', 'k-hint'], option: ['Dropdown option', 'k-form'],
  li: ['List item', 'k-body'], p: ['', 'k-body'], text: ['', 'k-body'], td: ['', 'k-body'],
  th: ['', 'k-body'], span: ['', 'k-body'], legend: ['Heading', 'k-h'], figcaption: ['', 'k-body'],
};

const pageHead = (p, countLabel) => `  <div class="page-head">
    <div class="page-n">${p.n}</div>
    <div class="page-id">
      <h2>${esc(p.name)}</h2>
      <div class="page-meta"><span class="path">${esc(p.route)}</span><span class="pill p-lane">${esc(p.lane)}</span><span class="pill p-who">${esc(p.who)}</span></div>
      <p class="page-note">${esc(p.note)}</p>
    </div>
  </div>`;

const indexRow = (p, count, unit) =>
  `<a href="#p${p.n}"><span class="ix-n">${p.n}</span><span class="ix-name">${esc(p.name)}</span>` +
  `<span class="path">${esc(p.route)}</span><span class="ix-count">${count} ${unit}${count === 1 ? '' : 's'}</span></a>`;

const SHARED_CSS = `
.index a{grid-template-columns:2.6rem 1fr auto auto;}
.ix-n{font-family:var(--mono);font-size:1rem;font-weight:700;color:var(--in);font-variant-numeric:tabular-nums;}
.ix-name{font-family:var(--sans);font-weight:700;font-size:.95rem;}
.ix-count{font-family:var(--mono);font-size:.7rem;color:var(--ink-3);white-space:nowrap;font-variant-numeric:tabular-nums;}
@media (max-width:700px){.index a{grid-template-columns:2.2rem 1fr;}.index .path,.ix-count{grid-column:2;}}
.page{display:flex;flex-direction:column;gap:1rem;scroll-margin-top:1rem;}
.page-head{display:grid;grid-template-columns:auto 1fr;gap:1.1rem;align-items:start;
 padding-bottom:1rem;border-bottom:2px solid var(--rule-strong);}
.page-n{font-family:var(--sans);font-size:2.6rem;font-weight:700;line-height:.85;letter-spacing:-.05em;
 color:var(--in);font-variant-numeric:tabular-nums;}
.page-id{display:flex;flex-direction:column;gap:.4rem;}
.page-meta{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;}
.page-note{font-size:.92rem;color:var(--ink-2);max-width:66ch;}`;

// ---------------------------------------------------------------- containers view

function renderPanelItems(list) {
  let html = '';
  let bullets = [];
  const flushBullets = () => {
    if (bullets.length) {
      html += `<ul class="bul">${bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`;
      bullets = [];
    }
  };
  for (const item of list) {
    if (item.kind === 'li') { bullets.push(item.text); continue; }
    flushBullets();
    if (HEADINGS.has(item.kind)) html += `<p class="i-head">${esc(item.text)}</p>`;
    else if (item.kind === 'label') html += `<p class="i-label">${esc(item.text)}</p>`;
    else if (item.kind === 'button') html += `<p class="i-btn"><span>${esc(item.text)}</span></p>`;
    else if (item.kind === 'placeholder') html += `<p class="i-ph">${esc(item.text)}</p>`;
    else if (item.kind === 'option') html += `<p class="i-opt">${esc(item.text)}</p>`;
    else html += `<p class="i-body">${esc(item.text)}</p>`;
  }
  flushBullets();
  return html;
}

function buildContainersView() {
  let index = '';
  let body = '';
  let total = 0;

  for (const p of PAGES) {
    const panels = tidy(containers(p.key));
    total += panels.length;
    index += indexRow(p, panels.length, 'container') + '\n';
    body += `<section class="page" id="p${p.n}">\n${pageHead(p)}\n  <div class="conts">\n`;
    panels.forEach((c, i) => {
      body += `    <article class="cont">
      <div class="cont-head"><span class="ref">${p.n}.${i + 1}</span><h3>${esc(c.label)}</h3></div>
      <div class="cont-body">${renderPanelItems(c.items)}</div>
    </article>\n`;
    });
    body += `  </div>\n</section>\n`;
  }

  const css = SHARED_CSS + `
.conts{display:flex;flex-direction:column;gap:.9rem;}
.cont{background:var(--surface);border:1px solid var(--rule);border-left:3px solid var(--rule-strong);}
.cont:hover{border-left-color:var(--in);}
.cont-head{display:flex;gap:.75rem;align-items:baseline;padding:.65rem .95rem;
 background:var(--surface-2);border-bottom:1px solid var(--rule);}
.cont-body{padding:.85rem .95rem;display:flex;flex-direction:column;gap:.5rem;}
.cont-body>*{max-width:70ch;}
.i-head{font-family:var(--sans);font-size:.9rem;font-weight:700;color:var(--ink);margin-top:.25rem;}
.i-body{font-size:.95rem;color:var(--ink-2);}
.i-label{font-family:var(--sans);font-size:.85rem;font-weight:700;color:var(--out);}
.i-ph{font-family:var(--mono);font-size:.78rem;color:var(--ink-3);}
.i-ph::before{content:"typed hint: ";font-family:var(--sans);text-transform:uppercase;letter-spacing:.08em;font-size:.85em;}
.i-opt{font-size:.85rem;color:var(--ink-2);padding-left:.9rem;position:relative;}
.i-opt::before{content:"▾";position:absolute;left:0;color:var(--ink-3);font-size:.7rem;}
.i-btn span{display:inline-block;font-family:var(--sans);font-size:.78rem;font-weight:700;
 background:var(--sms-soft);color:var(--sms);padding:.2rem .55rem;border-radius:3px;}
.bul{margin:0;padding-left:1.15rem;display:flex;flex-direction:column;gap:.25rem;
 font-size:.93rem;color:var(--ink-2);}`;

  const html = page({
    title: 'IN or OUT — Page Containers',
    css,
    body: `<div class="wrap">
<header class="top">
  <div class="eyebrow">IN or OUT · page containers</div>
  <h1>Every panel on every page, with its text</h1>
  <p class="lede">The ${total} containers that make up the nine pages — the boxes, forms and panels you actually see — each shown whole.</p>
  <div class="how"><p>Say <strong>&ldquo;update 4.11 to&hellip;&rdquo;</strong> and it means the eleventh panel on page 4. First number is the page, second is the container on it.</p></div>
</header>
<section>
  <div class="eyebrow" style="margin-bottom:.75rem;">The nine pages</div>
  <nav class="index">
${index}  </nav>
</section>
${body}
<section class="notes">
  <div class="note"><h3>Not shown here</h3><p>Anything the app writes while running: player names and rosters, status and error messages, and every text message it sends. Those live in <span class="path">public/js/</span> and <span class="path">sms-handler.js</span>.</p></div>
  <div class="note"><h3>Freshness</h3><p>${generatedNote('For a line-by-line view instead, open copy-deck.html.')}</p></div>
</section>
</div>`,
  });

  return { html, total };
}

// ---------------------------------------------------------------- line-by-line view

function buildCopyDeck() {
  let index = '';
  let body = '';
  let total = 0;

  for (const p of PAGES) {
    const lines = items(p.key);
    total += lines.length;
    index += indexRow(p, lines.length, 'line') + '\n';

    // group at headings purely so the wall of lines stays navigable
    const blocks = [];
    let current = null;
    lines.forEach((item, i) => {
      const num = i + 1;
      const isBreak = ['title', 'h1', 'h2', 'h3'].includes(item.kind);
      if (isBreak || !current) {
        current = { head: isBreak ? item.text : '(opening text)', headKind: isBreak ? item.kind : null, headNum: isBreak ? num : null, rows: [] };
        blocks.push(current);
        if (isBreak) return;
      }
      current.rows.push({ num, ...item });
    });

    body += `<section class="page" id="p${p.n}">\n${pageHead(p)}\n`;
    for (const b of blocks) {
      body += `  <div class="block">\n`;
      if (b.headNum !== null) {
        const [label] = KIND_LABEL[b.headKind] || ['', ''];
        body += `    <div class="block-head"><span class="ref">${p.n}.${b.headNum}</span><h3>${esc(b.head)}</h3><span class="kind k-h">${label}</span></div>\n`;
      } else {
        body += `    <div class="block-head plain"><h3>${esc(b.head)}</h3></div>\n`;
      }
      if (b.rows.length) {
        body += `    <div class="rows">\n`;
        for (const r of b.rows) {
          const [label, cls] = KIND_LABEL[r.kind] || ['', 'k-body'];
          body += `      <div class="row"><span class="ref">${p.n}.${r.num}</span><span class="copy">${esc(r.text)}</span>${label ? `<span class="kind ${cls}">${label}</span>` : ''}</div>\n`;
        }
        body += `    </div>\n`;
      }
      body += `  </div>\n`;
    }
    body += `</section>\n`;
  }

  const css = SHARED_CSS + `
.block{background:var(--surface);border:1px solid var(--rule);}
.block-head{display:flex;gap:.7rem;align-items:baseline;flex-wrap:wrap;padding:.7rem .9rem;
 background:var(--surface-2);border-bottom:1px solid var(--rule);}
.block-head.plain{background:transparent;}
.block-head.plain h3{color:var(--ink-3);font-weight:400;font-style:italic;font-family:var(--serif);font-size:.88rem;}
.rows{display:flex;flex-direction:column;}
.row{display:grid;grid-template-columns:3.6rem 1fr auto;gap:.9rem;align-items:baseline;
 padding:.42rem .9rem;border-bottom:1px solid var(--rule);}
.row:last-child{border-bottom:0;}
.row:hover{background:var(--surface-2);}
.copy{font-size:.95rem;color:var(--ink);min-width:0;overflow-wrap:break-word;}
.kind{font-family:var(--sans);font-size:.58rem;font-weight:700;text-transform:uppercase;
 letter-spacing:.08em;padding:.14rem .38rem;border-radius:2px;white-space:nowrap;}
.k-h{background:var(--in-soft);color:var(--in);}
.k-form{background:var(--out-soft);color:var(--out);}
.k-btn{background:var(--sms-soft);color:var(--sms);}
.k-hint,.k-meta{background:transparent;color:var(--ink-3);border:1px solid var(--rule-strong);}
.k-body{display:none;}
@media (max-width:600px){.row{grid-template-columns:3.2rem 1fr;}.kind{grid-column:2;justify-self:start;}}`;

  const html = page({
    title: 'IN or OUT — Numbered Copy Deck',
    css,
    body: `<div class="wrap">
<header class="top">
  <div class="eyebrow">IN or OUT · copy deck</div>
  <h1>Every line of text in the app, numbered</h1>
  <p class="lede">All ${total} lines of fixed text across the nine pages, in the order a visitor reads them.</p>
  <div class="how"><p>Say <strong>&ldquo;change 4.83 to&hellip;&rdquo;</strong> for one exact line — that one reads &ldquo;This will notify all players that the game has been cancelled.&rdquo; The first number is the page, the second is the line's position on it. For whole panels instead, open containers.html.</p></div>
</header>
<section>
  <div class="eyebrow" style="margin-bottom:.75rem;">The nine pages</div>
  <nav class="index">
${index}  </nav>
</section>
${body}
<section class="notes">
  <div class="note"><h3>Freshness</h3><p>${generatedNote()}</p></div>
</section>
</div>`,
  });

  return { html, total };
}

// ----------------------------------------------------------------

fs.mkdirSync(OUT_DIR, { recursive: true });

const cont = buildContainersView();
fs.writeFileSync(path.join(OUT_DIR, 'containers.html'), cont.html);
console.log(`  docs/containers.html   ${cont.total} containers`);

const deck = buildCopyDeck();
fs.writeFileSync(path.join(OUT_DIR, 'copy-deck.html'), deck.html);
console.log(`  docs/copy-deck.html    ${deck.total} lines`);

console.log('\nDone. Open them with:');
console.log('  open docs/containers.html docs/copy-deck.html');
