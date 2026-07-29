// Photographs the running app, one screen at a time, and writes a gallery grouped by page file.
//
//   npm run docs:screens            # desktop widths
//   npm run docs:screens -- --phone # phone widths, which is how most players actually arrive
//   node scripts/capture-screens.js --only=manage    # just the screens whose name matches
//
// Produces docs/screens.html plus docs/screens/*.webp.
//
// What it does, in order: starts a throwaway copy of the app on a free port with SMS in dev mode,
// seeds three demo games, drives headless Chrome through the real pages - filling in forms,
// clicking tabs, signing up as a player - then deletes the demo games and stops the server.
//
// No text messages are sent: lib/local-server.js blanks TEXTBELT_API_KEY, so every send takes
// the dev-mode branch. It also refuses to run if DATABASE_URL is set, because the demo games
// must never be created against production.
//
// To add or change a screen, edit SCREENS below. Each entry names the page file it belongs to,
// so a screenshot always stays tied to the file you would edit to change it.

const fs = require('fs');
const path = require('path');
const cdp = require('./lib/cdp');
const server = require('./lib/local-server');
const fixtures = require('./lib/fixtures');
const { page, escapeHtml: esc, generatedNote } = require('./lib/doc-shell');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs');

const PHONE = process.argv.includes('--phone');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1] || '';
const KEEP = process.argv.includes('--keep-fixtures');

// Phone and desktop runs keep separate folders and separate gallery files, so running one does
// not half-overwrite the other's images with a different width.
const SHOT_DIR = path.join(OUT_DIR, PHONE ? 'screens-phone' : 'screens');
const SHOT_REL = PHONE ? 'screens-phone' : 'screens';
const GALLERY = PHONE ? 'screens-phone.html' : 'screens.html';

// Phone captures are narrow, so they can afford a sharper pixel ratio and better quality at the
// same file size. Wide pages get scaled down instead, and the very tall ones lean on WebP.
const SIZE = PHONE
  ? { narrow: { w: 420, dsf: 2, q: 72 }, wide: { w: 420, dsf: 2, q: 72 }, tall: { w: 420, dsf: 2, q: 64 } }
  : { narrow: { w: 900, dsf: 1.5, q: 78 }, wide: { w: 1040, dsf: 1.25, q: 78 }, tall: { w: 900, dsf: 1, q: 60 } };

/** Opens one of the guide's collapsible sections; they are hidden until a card is tapped. */
const openGuideSection = (id) => async (p) => {
  await p.evaluate(`(() => {
    const card = document.querySelector("[data-section='${id}']");
    if (card) card.click(); else showSection('${id}', null);
    window.scrollTo(0, 0);
  })()`);
  await cdp.sleep(1100);
};

const fillAndSubmitCreateForm = (fx) => async (p) => {
  await p.evaluate(`(() => {
    const set = (id, v) => { const e = document.getElementById(id); e.value = v;
      e.dispatchEvent(new Event('input', { bubbles: true })); };
    // The court is a dropdown now. "Somewhere new..." is what reveals the free-text box,
    // and picking it is what a host does for a court nobody has played at yet.
    const select = document.getElementById('locationSelect');
    select.value = '__new__';
    select.dispatchEvent(new Event('change'));
    set('location', 'Sunset Park Courts');
    set('organizerName', 'Scott H.'); set('organizerPhone', '${fx.FORM_PHONE}');
    set('date', '${fixtures.inDays(4)}'); set('time', '17:30'); set('players', '4');
    set('message', 'Doubles, casual pace. Bring a spare ball. ${fx.MARKER}');
    document.getElementById('gameForm').requestSubmit();
  })()`);
  await cdp.sleep(2600);
};

const signUpAsPlayer = (fx) => async (p) => {
  // The phone field is required, so a signup cannot be photographed without one. This number is
  // only ever texted in dev mode. It must be unused on this game or the join is rejected as a
  // duplicate - which is why the fixtures are freshly seeded on every run.
  await p.evaluate(`(() => {
    const set = (id, v) => { const e = document.getElementById(id); e.value = v;
      e.dispatchEvent(new Event('input', { bubbles: true })); };
    set('playerName', 'Sam Rivera'); set('phoneNumber', '${fx.JOIN_PHONE}');
    document.getElementById('joinButton').click();
  })()`);
  await cdp.sleep(2600);
};

const clickTab = (i) => async (p) => {
  await p.evaluate(`document.querySelectorAll('.tab')[${i}].click()`);
  await cdp.sleep(1000);
};

// My Games, Roster and Stats all load from the server for whichever number is remembered on
// the device, so priming them means storing the fixture host's phone - exactly what the phone
// gate writes when a real host types it in. The fixtures then load through the real API.
const seedHostPhone = (fx) => async (p) => {
  await p.evaluate(
    `localStorage.setItem('hostPhone', ${JSON.stringify(fx.HOST_PHONE)}); location.reload()`);
  await cdp.sleep(2600);
};

const clearHostPhone = async (p) => {
  await p.evaluate(`localStorage.removeItem('hostPhone'); location.reload()`);
  await cdp.sleep(2000);
};

const openDeveloperRosters = async (p) => {
  const password = JSON.stringify(process.env.DEV_PASSWORD || 'vibe123');
  await p.evaluate(`(async () => {
    const response = await fetch('/api/dev/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: ${password} })
    });
    if (!response.ok) throw new Error('Developer sign-in failed');
    showApp();
    document.querySelector('[data-tab="rosters"]').click();
  })()`);
  await cdp.sleep(1400);
  // The capture server shares the developer's local SQLite database. Keep unrelated local
  // contacts out of the generated image and photograph only reserved fixture phone numbers.
  await p.evaluate(`(() => {
    const search = document.getElementById('rosterSearch');
    search.value = '555555';
    search.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await cdp.sleep(300);
};

const GUIDE_SECTIONS = [
  ['game-modes', 'Game Modes Explained', 'First-come versus approval, side by side.'],
  ['creating-games', 'Creating Your First Game', 'Setup walkthrough for both modes.'],
  ['managing-players', 'Managing Your Game', 'Finding your management link, then running the roster.'],
  ['sms-examples', 'Text Messages', 'Every message the app sends, by scenario.'],
  ['player-experience', 'What Players See', 'Mock-ups of the invite page in both modes.'],
  ['tips-tricks', 'FAQs', 'Setup, management and troubleshooting questions.'],
];

/** The screens to capture, in reading order. fx is the seeded fixture data. */
function buildScreens(fx) {
  return [
    { file: 'index-landing', of: '/', size: 'wide', url: '/',
      title: 'The landing view',
      note: 'What everyone lands on. The six cards are a section picker — every guide section below is hidden until you tap one.' },
    ...GUIDE_SECTIONS.map(([id, title, note]) => ({
      file: `index-guide-${id}`, of: '/', size: 'tall', url: '/',
      title: `Guide — ${title}`, note, act: openGuideSection(id),
    })),

    { file: 'create-form', of: '/create.html', size: 'narrow', url: '/create.html',
      title: 'The form, top to bottom',
      note: 'Everything a host fills in, including the five notification toggles.' },
    { file: 'create-done', of: '/create.html', size: 'narrow', url: '/create.html',
      title: 'After you submit',
      note: 'The share panel that replaces the form. Reached by actually filling it in and submitting.',
      act: fillAndSubmitCreateForm(fx) },

    { file: 'game-open', of: '/game.html?id=…', size: 'narrow', url: `/game.html?id=${fx.open.gameId}`,
      title: 'Spots still open',
      note: 'A first-come game with 2 of 6 spots left. The roster is public and the form offers IN or OUT.' },
    { file: 'game-joined', of: '/game.html?id=…', size: 'narrow', url: `/game.html?id=${fx.open.gameId}`,
      title: 'After tapping IN',
      note: 'The confirmation replaces the whole page. Reached by really signing up — note the phone number is required.',
      act: signUpAsPlayer(fx) },
    { file: 'game-full', of: '/game.html?id=…', size: 'narrow', url: `/game.html?id=${fx.full.gameId}`,
      title: 'Game full',
      note: 'Same file, different state: the signup form becomes a waitlist signup.' },
    { file: 'game-approval', of: '/game.html?id=…', size: 'narrow', url: `/game.html?id=${fx.approval.gameId}`,
      title: 'Approval mode',
      note: 'The roster is hidden. Everyone applies and waits to be picked.' },

    { file: 'manage-details', of: '/manage.html?id=…&token=…', size: 'wide',
      url: `/manage.html?id=${fx.open.gameId}&token=${fx.open.hostToken}`,
      title: 'Game Details tab',
      note: 'The tab that opens first. Editing anything here re-notifies players.' },
    { file: 'manage-players', of: '/manage.html?id=…&token=…', size: 'wide',
      url: `/manage.html?id=${fx.open.gameId}&token=${fx.open.hostToken}`,
      title: 'Players tab',
      note: 'Confirmed, waitlist and out lists, plus adding someone by hand.', act: clickTab(1) },
    { file: 'manage-communication', of: '/manage.html?id=…&token=…', size: 'wide',
      url: `/manage.html?id=${fx.open.gameId}&token=${fx.open.hostToken}`,
      title: 'Communication tab',
      note: 'Announce to everyone or one person, plus the quick reminder and location buttons.', act: clickTab(2) },
    { file: 'manage-actions', of: '/manage.html?id=…&token=…', size: 'wide',
      url: `/manage.html?id=${fx.open.gameId}&token=${fx.open.hostToken}`,
      title: 'Game Actions tab',
      note: 'Cancelling the game, with a reason that gets texted to everyone.', act: clickTab(3) },
    { file: 'manage-approval-roster', of: '/manage.html?id=…&token=…', size: 'wide',
      url: `/manage.html?id=${fx.approval.gameId}&token=${fx.approval.hostToken}`,
      title: 'Players tab on an approval game',
      note: 'Three applicants waiting. Nobody is confirmed until the host promotes them.', act: clickTab(1) },
    { file: 'manage-wrong-token', of: '/manage.html?id=…&token=…', size: 'narrow',
      url: `/manage.html?id=${fx.open.gameId}&token=wrong-token-value`,
      title: 'Wrong or missing token', note: 'What anyone without the host link sees.' },

    { file: 'my-games-gate', of: '/my-games.html', size: 'narrow', url: '/my-games.html',
      title: 'Asking which number you host with',
      note: 'What a host sees on a device that has not been used before. One number, once, and the games follow them anywhere.',
      act: clearHostPhone },
    { file: 'my-games-list', of: '/my-games.html', size: 'narrow', url: '/my-games.html',
      title: 'The host history',
      note: 'Loaded from the server by phone number, split into upcoming and past. Each card has Manage, Copy Invitation and a private note.',
      act: seedHostPhone(fx) },

    { file: 'roster-list', of: '/roster.html', size: 'narrow', url: '/roster.html',
      title: 'Everyone you play with',
      note: 'Built automatically from who has signed up for the host\'s games. Names and DUPR details are the host\'s own and players never see them.',
      act: seedHostPhone(fx) },

    { file: 'stats-dashboard', of: '/stats.html', size: 'narrow', url: '/stats.html',
      title: 'Host stats',
      note: 'Worked out from the games actually hosted. The yellow notes are deliberate: where a number cannot yet be trusted, the page says so.',
      act: seedHostPhone(fx) },

    { file: 'dev-hosts-and-players', of: '/dev.html', size: 'wide', url: '/dev.html',
      title: 'Hosts And Players',
      note: 'The password-protected master player roster and every host roster, with global edit and delete controls.',
      act: openDeveloperRosters },

    { file: 'lookup-redirect', of: '/lookup.html', size: 'narrow', url: '/lookup.html',
      title: 'The retired lookup page',
      note: 'Find My Games was folded into My Games. Old texts and bookmarks still land here and are sent straight on, so nothing 404s.' },

    { file: 'demo', of: '/demo.html', size: 'narrow', url: '/demo.html',
      title: 'SMS consent walkthrough',
      note: 'Unlinked page for carrier review. Describes a signup flow the app no longer has.' },
    { file: 'privacy', of: '/privacy.html', size: 'tall', url: '/privacy.html',
      title: 'Privacy Policy', note: 'Footer-linked.' },
    { file: 'terms', of: '/terms.html', size: 'tall', url: '/terms.html',
      title: 'Terms of Service', note: 'Footer-linked.' },
  ];
}

// How the gallery groups the screens. Order here is the order on the page.
const GROUPS = [
  { of: '/', who: 'Anyone', lane: 'In the nav',
    blurb: 'The homepage. It opens as a compact landing page — the six cards are a section picker, and each guide section is hidden until you tap one. Those sections appear here as separate screens because that is how you actually meet them.' },
  { of: '/create.html', who: 'Organizers', lane: 'In the nav',
    blurb: 'One long form, then a share panel that replaces it.' },
  { of: '/game.html?id=…', who: 'Players', lane: 'Link only',
    blurb: 'The page every player gets. One file showing four different faces depending on the game.' },
  { of: '/manage.html?id=…&token=…', who: 'The host', lane: 'Link only',
    blurb: 'The host console, behind a secret token. Four tabs plus the notices you hit when something is off.' },
  { of: '/my-games.html', who: 'Organizers', lane: 'In the nav',
    blurb: 'Asks for a phone number once, then loads that host’s whole history from the server — so it works on any device, not just the one the game was created on.' },
  { of: '/roster.html', who: 'Organizers', lane: 'In the nav',
    blurb: 'Everyone who has ever signed up for one of this host’s games, built without anybody typing a list. The host can add names and DUPR details on top.' },
  { of: '/stats.html', who: 'Organizers', lane: 'Linked from My Games',
    blurb: 'The patterns behind the games: who turns up, who waits, who drops out, and where and when this group actually plays.' },
  { of: '/dev.html', who: 'Developer', lane: 'Password protected',
    blurb: 'Private operational controls, including the master player roster and every host roster.' },
  { of: '/lookup.html', who: 'Organizers', lane: 'Old links only',
    blurb: 'Retired. My Games does the phone lookup itself now, so this page just forwards — the file only exists so older texts and bookmarks keep working.' },
  { of: '/demo.html', who: 'Carrier reviewers', lane: 'Unlinked',
    blurb: 'Nothing links here. It shows a consent checkbox and a “Count Me In!” button the real signup page does not have.' },
  { of: '/privacy.html', who: 'Anyone', lane: 'In the footer', blurb: 'Linked from the footer.' },
  { of: '/terms.html', who: 'Anyone', lane: 'In the footer', blurb: 'Linked from the footer.' },
];

function buildGallery(taken, { devSends }) {
  const slug = (s) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root';
  let nav = '';
  let body = '';
  let n = 0;

  for (const group of GROUPS) {
    const shots = taken.filter((s) => s.of === group.of);
    if (!shots.length) continue;
    const id = slug(group.of);
    nav += `<a href="#${id}"><span class="nav-route">${esc(group.of)}</span>` +
      `<span class="nav-who">${esc(group.who)}</span>` +
      `<span class="ix-count">${shots.length} screen${shots.length === 1 ? '' : 's'}</span></a>\n`;

    body += `<section class="route" id="${id}">
  <div class="route-head">
    <h2>${esc(group.of)}</h2>
    <div class="route-meta"><span class="pill p-who">${esc(group.who)}</span><span class="pill p-lane">${esc(group.lane)}</span></div>
    <p class="route-blurb">${esc(group.blurb)}</p>
  </div>
  <div class="screens">\n`;

    for (const s of shots) {
      n++;
      const tall = s.height > 2600;
      body += `    <figure class="screen">
      <figcaption>
        <div class="cap-top"><span class="shot-n">${String(n).padStart(2, '0')}</span><h3>${esc(s.title)}</h3></div>
        <p>${esc(s.note)}</p>
      </figcaption>
      <div class="frame"${tall ? ' data-tall="1"' : ''}>
        <img src="data:image/webp;base64,${s.base64}" alt="${esc(s.of)} — ${esc(s.title)}"
             width="${s.width}" height="${s.height}" loading="lazy">
      </div>
      <div class="frame-foot"><span>${s.width} &times; ${s.height} css px &middot; ${SHOT_REL}/${s.file}.webp</span>${tall ? '<button class="expand" type="button">Show full height</button>' : ''}</div>
    </figure>\n`;
    }
    body += `  </div>\n</section>\n`;
  }

  const css = `
.index a{grid-template-columns:1fr auto auto;}
.nav-route{font-family:var(--mono);font-size:.85rem;font-weight:700;color:var(--in);overflow-wrap:break-word;}
.nav-who{font-size:.85rem;color:var(--ink-2);}
.ix-count{font-family:var(--mono);font-size:.7rem;color:var(--ink-3);white-space:nowrap;}
@media (max-width:620px){.index a{grid-template-columns:1fr auto;}.nav-who{grid-column:1;}}
.route{display:flex;flex-direction:column;gap:1.5rem;scroll-margin-top:1rem;}
.route-head{display:flex;flex-direction:column;gap:.55rem;padding-bottom:1rem;border-bottom:2px solid var(--rule-strong);}
.route-head h2{font-family:var(--mono);font-size:clamp(1.05rem,2.6vw,1.5rem);color:var(--in);
 letter-spacing:-.02em;overflow-wrap:break-word;}
.route-meta{display:flex;gap:.5rem;flex-wrap:wrap;}
.route-blurb{font-size:.95rem;color:var(--ink-2);max-width:68ch;}
.screens{display:flex;flex-direction:column;gap:2.25rem;}
.screen{margin:0;display:flex;flex-direction:column;gap:.6rem;}
figcaption{display:flex;flex-direction:column;gap:.25rem;}
.cap-top{display:flex;gap:.6rem;align-items:baseline;}
.shot-n{font-family:var(--mono);font-size:.78rem;font-weight:700;color:var(--ink-3);font-variant-numeric:tabular-nums;}
figcaption p{font-size:.9rem;color:var(--ink-2);max-width:68ch;}
.frame{border:1px solid var(--rule-strong);background:var(--surface);overflow:auto;}
.frame[data-tall="1"]{max-height:78vh;resize:vertical;}
.frame.open{max-height:none;}
.frame img{display:block;width:100%;height:auto;}
.frame-foot{display:flex;justify-content:space-between;align-items:center;gap:1rem;
 font-family:var(--sans);font-size:.68rem;color:var(--ink-3);font-variant-numeric:tabular-nums;}
.expand{font-family:var(--sans);font-size:.68rem;font-weight:700;text-transform:uppercase;
 letter-spacing:.08em;background:transparent;color:var(--in);border:1px solid var(--rule-strong);
 padding:.25rem .55rem;border-radius:2px;cursor:pointer;}
.expand:hover{background:var(--in-soft);}
.expand:focus-visible{outline:2px solid var(--in);outline-offset:2px;}`;

  return page({
    title: `IN or OUT — Actual Screens${PHONE ? ' (phone)' : ''}`,
    css,
    body: `<div class="wrap">
<header class="top">
  <div class="eyebrow">IN or OUT · real screens${PHONE ? ' · phone width' : ''}</div>
  <h1>The app as a user meets it</h1>
  <p class="lede">${n} screenshots of the running app, grouped under the page file that produced them. Real pages, real seeded games — not mock-ups.</p>
  <div class="how"><p>Each group is headed by its file, so you can point at it: <code>@create.html</code> add a level field, <code>@game.html</code> move the OUT button. Where one file has several looks, the caption says which state you are seeing.</p></div>
</header>
<section>
  <div class="eyebrow" style="margin-bottom:.75rem;">The Ten Pages</div>
  <nav class="index">
${nav}  </nav>
</section>
${body}
<section class="notes">
  <div class="eyebrow">How these were made</div>
  <div class="note"><h3>Captured from the app running locally</h3>
    <p>A throwaway server on SQLite, driven by headless Chrome at ${PHONE ? 'phone' : 'roughly desktop'} width. Three demo games were seeded to fill the screens: a first-come game with 2 of 6 spots left, a full 2-player game, and an approval game with three applicants. The signup, the form submit, the tab clicks and the phone-number gate are real interactions.</p></div>
  <div class="note"><h3>No text messages were sent</h3>
    <p>The server ran with the Textbelt key blanked, so all ${devSends} sends took the dev-mode branch and none reached Textbelt. The demo phone numbers are fake 555 numbers, and the demo games were deleted from the local database afterwards.</p></div>
  <div class="note"><h3>Freshness</h3><p>${generatedNote(PHONE
      ? 'This is the phone-width set; run without --phone for desktop.'
      : 'For phone widths run <span class="path">npm run docs:screens -- --phone</span>.')}</p></div>
</section>
</div>`,
    script: `document.querySelectorAll('.expand').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var frame = btn.closest('.screen').querySelector('.frame');
    btn.textContent = frame.classList.toggle('open') ? 'Collapse' : 'Show full height';
  });
});`,
  });
}

(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  let app = null;
  let browser = null;
  try {
    process.stdout.write('starting a throwaway app ... ');
    app = await server.start();
    console.log(`${app.baseUrl} (SQLite, SMS in dev mode)`);

    process.stdout.write('seeding demo games ... ');
    const fx = await fixtures.seed(app.baseUrl);
    await fixtures.verify(app.baseUrl, fx);
    console.log('3 games, shapes verified');

    process.stdout.write('launching headless Chrome ... ');
    browser = await cdp.launch();
    console.log(cdp.findChrome().split('/').pop());

    let screens = buildScreens(fx);
    if (ONLY) {
      screens = screens.filter((s) => s.file.includes(ONLY) || s.of.includes(ONLY));
      console.log(`--only=${ONLY} matched ${screens.length} screen(s)`);
    }

    console.log(`\ncapturing ${screens.length} screens at ${PHONE ? 'phone' : 'desktop'} width:`);
    const taken = [];
    for (const s of screens) {
      const size = SIZE[s.size];
      const p = await browser.newPage({ width: size.w, deviceScaleFactor: size.dsf });
      try {
        await p.goto(app.baseUrl + s.url);
        if (s.act) await s.act(p);
        const buf = await p.screenshot({ quality: size.q });
        const [width, height] = await p.size();
        fs.writeFileSync(path.join(SHOT_DIR, `${s.file}.webp`), buf);
        taken.push({ ...s, base64: buf.toString('base64'), width, height, bytes: buf.length });
        console.log(`  ${s.file.padEnd(26)} ${String(Math.round(buf.length / 1024)).padStart(4)}kb  ${width}x${height}`);
      } finally {
        await p.close();
      }
    }

    const devSends = server.countDevModeSends(app.log());
    const html = buildGallery(taken, { devSends });
    fs.writeFileSync(path.join(OUT_DIR, GALLERY), html);

    const totalKb = Math.round(taken.reduce((a, s) => a + s.bytes, 0) / 1024);
    console.log(`\n  docs/${GALLERY}  ${taken.length} screens, ${totalKb}kb of images inlined`);
    console.log(`  docs/${SHOT_REL}/${' '.repeat(Math.max(0, 22 - SHOT_REL.length))} ${taken.length} .webp files`);
    console.log(`\n  ${devSends} SMS send(s) took the dev-mode branch; none reached Textbelt.`);
    console.log(`\nOpen it with:\n  open docs/${GALLERY}`);
  } finally {
    // Teardown runs even if a capture threw, so a failed run never leaves demo games behind.
    if (browser) await browser.close();
    if (app) await app.stop();
    if (KEEP) {
      console.log('\n--keep-fixtures: demo games left in the local database.');
    } else {
      const removed = await fixtures.cleanup();
      console.log(`\ncleaned up ${removed} demo game(s) from the local database.`);
    }
  }
})().catch((e) => {
  console.error('\nFAILED:', e.message);
  process.exit(1);
});
