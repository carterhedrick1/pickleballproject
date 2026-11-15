// Read-only production verification. All browser API data below is synthetic and intercepted;
// mutation requests cannot leave the browser. The deployed HTML, JS and CSS are real.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const cdp = require('./lib/cdp');
const base = process.argv[2] || 'https://inorout.club';
const root = path.resolve(__dirname, '..');
const digest = text => createHash('sha256').update(text).digest('hex');
const check = (value, label) => { assert.ok(value, label); console.log(`PASS ${label}`); };
(async () => {
  const health = await fetch(base + '/api/health').then(r => r.json());
  check(health.status === 'OK', 'production health');
  console.log(JSON.stringify(health));
  for (const file of ['manage.html', 'create.html', 'stats.html', 'js/current-attendance.js',
    'js/invitation-availability.js', 'js/invitation-generator.js', 'js/manage/game.js',
    'js/manage/players.js', 'js/manage/communications.js', 'js/manage/render.js',
    'js/my-games.js', 'js/create.js', 'js/player-capacity.js', 'js/game-page.js', 'css/manage-styles.css']) {
    const response = await fetch(base + '/' + file, { cache: 'no-store' });
    check(response.ok && digest(await response.text()) === digest(fs.readFileSync(path.join(root, 'public', file))), `deployed ${file} matches verified source`);
  }
  const browser = await cdp.launch({ port: 9432 });
  try {
    const host = await browser.newPage({ width: 390, mobile: true });
    const fixture = { id: 'synthetic-usability-check', date: '2099-01-01', time: '12:00', duration: 60,
      location: 'Synthetic Browser Fixture', totalPlayers: 2, organizerPlaying: false,
      hostPhone: '5555550199', registrationMode: 'fcfs',
      players: [{ id: 'a', name: 'River Fixture', phone: '5555550111' }, {id:'b',name:'Sky Fixture',phone:'5555550112'}],
      waitlist: [{id:'w',name:'Waiting Fixture',phone:'5555550113'}],
      outPlayers: [{id:'old',name:'River Fixture',phone:'5555550111'}], invitedPlayers: [],
      notificationPreferences: {} };
    await host.addInitScript(`(() => {
      const realFetch = window.fetch.bind(window);
      window.syntheticGame = ${JSON.stringify(fixture)};
      window.fetch = async (input, options = {}) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        const method = (options.method || input.method || 'GET').toUpperCase();
        if (url.pathname.startsWith('/api/')) {
          let data = {};
          if (url.pathname.endsWith('/sms-events')) data = {events:[{name:'River Fixture',event:'Synthetic Text',status:'sent',attempts:1,sentAt:new Date().toISOString()}],counts:{sent:1}};
          else if (url.pathname.startsWith('/api/games/')) data = window.syntheticGame;
          else if (url.pathname.startsWith('/api/roster/')) data = {roster:[]};
          return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
        }
        if (method !== 'GET' && method !== 'HEAD') throw new Error('Production test blocks mutations');
        return realFetch(input,options);
      };
    })()`);
    await host.goto(base + '/manage.html?id=synthetic-usability-check&token=synthetic');
    check(await host.evaluate(`document.getElementById('playerCount').textContent === '2' && !document.getElementById('outPlayers').textContent.includes('River Fixture')`), 'deployed current attendance excludes historical OUT entries (synthetic fixture)');
    check(await host.evaluate(`Array.from(document.querySelectorAll('.tabs .tab')).every(tab => tab.getBoundingClientRect().width > 0) && document.documentElement.scrollWidth <= 390`), 'deployed phone navigation shows every section');
    await host.evaluate(`document.getElementById('editGameFromSummary').click()`);
    check(await host.evaluate(`document.getElementById('capacityHelp').textContent === '2 total players. You are hosting, not playing.'`), 'deployed Edit capacity explanation');
    await host.evaluate(`ManageApp.core.openTabFromSelect('Communication')`);
    await cdp.sleep(400);
    check(await host.evaluate(`document.querySelector('.delivery-row.sent').textContent.includes('Sent') && !document.querySelector('.delivery-row.sent').textContent.includes('Delivered')`), 'deployed provider-acceptance label');
    check(await host.evaluate(`document.querySelector('#playerCheckboxes input').labels[0].textContent === 'River Fixture'`), 'deployed recipient accessible name');
    check(await host.evaluate(`(async () => { const { invitationAvailability } = await import('/js/invitation-availability.js'); return invitationAvailability(syntheticGame).includes('full. Join the waitlist'); })()`), 'deployed availability helper');
    await host.evaluate(`(() => { document.getElementById('location').value='Unsaved fixture'; syntheticGame.registrationMode='waitlist'; })()`);
    await host.evaluate(`ManageApp.core.fetchGameData({background:true})`);
    check(await host.evaluate(`document.getElementById('location').value === 'Unsaved fixture' && document.querySelector('.player-section.waitlist h3').textContent === 'Applicants' && !document.getElementById('waitlistPlayers').textContent.includes('Position:')`), 'deployed refresh preserves edits and renders applicants without priority');
    console.log('Production verification made no real game, contact, or SMS changes.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
