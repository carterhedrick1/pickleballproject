const cdp = require('./lib/cdp');
const server = require('./lib/local-server');
const fixtures = require('./lib/fixtures');

function assert(value, message) {
  if (!value) throw new Error(message);
  console.log(`  PASS  ${message}`);
}

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const JPEG_BYTES = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  Buffer.from('JFIF\0', 'ascii'),
  Buffer.alloc(32, 0x20),
  Buffer.from([0xff, 0xd9]),
]);

async function uploadCourtImage(baseUrl, game, bytes, contentType) {
  const response = await fetch(
    `${baseUrl}/api/games/${game.gameId}/court-images?token=${game.hostToken}`,
    { method: 'POST', headers: { 'Content-Type': contentType }, body: bytes }
  );
  if (!response.ok) {
    throw new Error(`court image fixture upload failed: HTTP ${response.status}`);
  }
}

(async () => {
  const local = await server.start();
  let browser;
  let seeded = false;
  try {
    const fx = await fixtures.seed(local.baseUrl);
    seeded = true;
    await uploadCourtImage(local.baseUrl, fx.open, PNG_1PX, 'image/png');
    await uploadCourtImage(local.baseUrl, fx.open, JPEG_BYTES, 'image/jpeg');

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

    await desktop.evaluate(`(() => {
      const select = document.getElementById('locationSelect');
      select.value = 'Oak Park Courts';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await cdp.sleep(500);
    const courtGallery = await desktop.evaluate(`(() => {
      const panel = document.getElementById('courtImageContainer');
      const none = document.querySelector('.court-image-choice--none');
      return {
        visible: !panel.hidden && getComputedStyle(panel).display !== 'none',
        savedPhotos: document.querySelectorAll(
          '.court-image-choice--photo:not(.court-image-choice--upload)'
        ).length,
        uploadAvailable: Boolean(document.getElementById('courtImageUpload')),
        noImageIsCompact: none.getBoundingClientRect().width < panel.getBoundingClientRect().width / 2
      };
    })()`);
    assert(courtGallery.visible && courtGallery.savedPhotos === 2,
      'create form shows every image saved for the selected court');
    assert(courtGallery.uploadAvailable && courtGallery.noImageIsCompact,
      'court upload is available and No image is a compact gallery tile');

    const uploadedCreate = await desktop.evaluate(`(() => {
      const set = (id, value) => {
        const field = document.getElementById(id);
        field.value = value;
        field.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const select = document.getElementById('locationSelect');
      select.value = '__new__';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      set('location', 'Sunset Park Courts');
      set('organizerName', 'Upload Test Host');
      set('organizerPhone', '${fx.FORM_PHONE}');
      set('date', '${fx.date}');
      set('time', '17:30');
      set('players', '4');
      set('message', '${fx.MARKER}');

      const binary = atob('${PNG_1PX.toString('base64')}');
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const file = new File([bytes], 'sunset-court.png', { type: 'image/png' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      const upload = document.getElementById('courtImageUpload');
      upload.files = transfer.files;
      upload.dispatchEvent(new Event('change', { bubbles: true }));

      const previewSelected = document.querySelector(
        'input[name="selectedCourtImage"][value="__upload__"]'
      )?.checked === true;
      document.getElementById('gameForm').requestSubmit();
      return { previewSelected };
    })()`);
    assert(uploadedCreate.previewSelected,
      'a Somewhere new upload gets a preview and is selected automatically');
    await cdp.sleep(2800);
    const uploadedResult = await desktop.evaluate(`(async () => {
      const gameId = window.currentGameId;
      const saved = JSON.parse(localStorage.getItem('myGames') || '[]')
        .find((game) => game.id === gameId);
      const response = await fetch('/api/games/' + gameId + '/court-images');
      const library = await response.json();
      return {
        gameId,
        hasHostToken: Boolean(saved && saved.hostToken),
        imageCount: library.images.length,
        selectedImageId: library.selectedImageId,
        selectedFlag: library.images.some((image) => image.isSelected)
      };
    })()`);
    assert(
      uploadedResult.gameId && uploadedResult.hasHostToken &&
      uploadedResult.imageCount === 1 && uploadedResult.selectedImageId &&
      uploadedResult.selectedFlag,
      'a Somewhere new photo uploads after creation and is selected for the game'
    );

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
