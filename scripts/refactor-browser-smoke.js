const cdp = require('./lib/cdp');
const server = require('./lib/local-server');
const fixtures = require('./lib/fixtures');

function assert(value, message) {
  if (!value) throw new Error(message);
  console.log(`  PASS  ${message}`);
}

(async () => {
  const local = await server.start();
  let browser;
  let seeded = false;
  try {
    const fx = await fixtures.seed(local.baseUrl);
    seeded = true;

    await fetch(`${local.baseUrl}/api/games/${fx.open.gameId}/players`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '<img src=x onerror="window.__unsafe=true">',
        phone: ''
      })
    });

    browser = await cdp.launch({ port: 9333 });
    const desktop = await browser.newPage({ width: 1100, height: 900 });

    await desktop.goto(`${local.baseUrl}/create.html`);
    const createReady = await desktop.evaluate(`(() => {
      const mode = document.querySelector('[data-radio-id="waitlistMode"]');
      mode.click();
      return {
        form: Boolean(document.getElementById('gameForm')),
        selected: document.getElementById('waitlistMode').checked,
        scriptExternal: [...document.scripts].some((s) => s.src.endsWith('/js/create.js'))
      };
    })()`);
    assert(createReady.form && createReady.selected, 'create form and extracted handlers work');
    assert(createReady.scriptExternal, 'create page uses its external script');

    await desktop.goto(
      `${local.baseUrl}/manage.html?id=${fx.open.gameId}&token=${fx.open.hostToken}`
    );
    const manageReady = await desktop.evaluate(`(() => {
      const name = [...document.querySelectorAll('.player-name')]
        .find((node) => node.textContent.startsWith('<img'));
      document.querySelector('[data-tab="Players"]').click();
      return {
        visible: getComputedStyle(document.getElementById('gameManagement')).display !== 'none',
        namespaces: Boolean(
          ManageApp.core && ManageApp.players && ManageApp.communications && ManageApp.media
        ),
        playerText: name && name.textContent,
        injectedElement: Boolean(name && name.querySelector('img')),
        playersActive: document.getElementById('Players').classList.contains('active')
      };
    })()`);
    assert(manageReady.visible && manageReady.namespaces, 'management feature modules initialize');
    assert(manageReady.playersActive, 'management tab listeners work without inline handlers');
    assert(
      manageReady.playerText.startsWith('<img') && !manageReady.injectedElement,
      'HTML-like player names remain text in the live page'
    );

    const mobile = await browser.newPage({
      width: 420,
      height: 900,
      deviceScaleFactor: 2,
      mobile: true
    });
    await mobile.goto(`${local.baseUrl}/game.html?id=${fx.open.gameId}`);
    const gameReady = await mobile.evaluate(`(() => ({
      visible: getComputedStyle(document.getElementById('details')).display !== 'none',
      pageUtils: typeof PageUtils.formatTime12Hour === 'function',
      external: [...document.scripts].some((s) => s.src.endsWith('/js/game-page.js'))
    }))()`);
    assert(gameReady.visible && gameReady.pageUtils, 'mobile game page initializes with shared utilities');
    assert(gameReady.external, 'game page uses its external script');

    await desktop.close();
    await mobile.close();
  } finally {
    if (browser) await browser.close();
    if (seeded) await fixtures.cleanup();
    await local.stop();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
