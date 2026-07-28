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
        locationPlaceholderRemoved: !document.getElementById('location').hasAttribute('placeholder'),
        waitlistNotificationDefault: document.getElementById('notifyWaitlistStarts').checked &&
          document.querySelector('[data-checkbox-id="notifyWaitlistStarts"]').classList.contains('checked'),
        notificationTitles: [...document.querySelectorAll('.notifications-section .notification-title')]
          .map((element) => element.textContent.trim()),
        scriptExternal: [...document.scripts].some((s) => s.src.endsWith('/js/create.js'))
      };
    })()`);
    assert(createReady.form && createReady.selected, 'create form and extracted handlers work');
    assert(createReady.locationPlaceholderRemoved, 'new-location field has no sample text');
    assert(createReady.waitlistNotificationDefault, 'waitlist-start notification is enabled by default');
    assert(
      createReady.notificationTitles.join('|') === [
        'Game Becomes Full',
        'Someone Cancels Their Spot',
        'Someone Joins The Game',
        'Only One Spot Remaining',
        'Waitlist Starts'
      ].join('|'),
      'organizer notification titles capitalize every word'
    );
    assert(createReady.scriptExternal, 'create page uses its external script');

    await desktop.evaluate(`(() => {
      const select = document.getElementById('locationSelect');
      select.value = 'Oak Park Courts';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await cdp.sleep(500);
    const courtGallery = await desktop.evaluate(`(() => {
      const panel = document.getElementById('courtImageContainer');
      const savedPhotos = [...document.querySelectorAll(
        '.court-image-choice--photo:not(.court-image-choice--upload)'
      )];
      return {
        visible: !panel.hidden && getComputedStyle(panel).display !== 'none',
        savedPhotos: savedPhotos.length,
        uploadAvailable: Boolean(document.getElementById('courtImageUpload')),
        firstPhotoSelected: savedPhotos[0]?.querySelector('input').checked === true,
        noImageRemoved: !document.querySelector('input[value="none"]')
      };
    })()`);
    assert(
      courtGallery.visible && courtGallery.savedPhotos === 2 && courtGallery.firstPhotoSelected,
      'create form shows every saved court image and defaults to the first one'
    );
    assert(courtGallery.uploadAvailable && courtGallery.noImageRemoved,
      'court upload is available and there is no No image choice');

    await desktop.evaluate(`(() => {
      const set = (id, value) => {
        const field = document.getElementById(id);
        field.value = value;
        field.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const select = document.getElementById('locationSelect');
      select.value = '__new__';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      set('location', 'Sunset Park Courts');
    })()`);
    await cdp.sleep(500);
    const emptyGallery = await desktop.evaluate(`(() => ({
      panelVisible: !document.getElementById('courtImageContainer').hidden,
      choices: document.querySelectorAll('input[name="selectedCourtImage"]').length,
      uploadAvailable: Boolean(document.getElementById('courtImageUpload'))
    }))()`);
    assert(emptyGallery.panelVisible && emptyGallery.choices === 0 && emptyGallery.uploadAvailable,
      'a court with no photos stays optional and offers an upload without an empty choice');

    await desktop.evaluate(`(() => {
      const set = (id, value) => {
        const field = document.getElementById(id);
        field.value = value;
        field.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('organizerName', 'Upload Test Host');
      set('organizerPhone', '${fx.FORM_PHONE}');
      set('date', '${fx.date}');
      set('time', '17:30');
      set('players', '4');
      set('message', '${fx.MARKER}');
      document.getElementById('gameForm').requestSubmit();
    })()`);
    await cdp.sleep(2500);
    const noImageResult = await desktop.evaluate(`(async () => {
      const gameId = window.currentGameId;
      const response = await fetch('/api/games/' + gameId + '/court-images');
      const library = await response.json();
      const gameResponse = await fetch('/api/games/' + gameId);
      const game = await gameResponse.json();
      return {
        gameId,
        imageCount: library.images.length,
        selectedImageId: library.selectedImageId,
        waitlistNotificationSaved: game.notificationPreferences?.waitlistStarts === true
      };
    })()`);
    assert(
      noImageResult.gameId && noImageResult.imageCount === 0 && !noImageResult.selectedImageId,
      'a game with no saved or uploaded court photo still creates without an image'
    );
    assert(noImageResult.waitlistNotificationSaved,
      'the waitlist-start notification default is saved with the game');
    const createSuccessView = await desktop.evaluate(`(() => ({
      formHidden: document.querySelector('.form-section').hidden,
      shareVisible: getComputedStyle(document.getElementById('shareLink')).display !== 'none',
      heading: document.querySelector('.page-header h1').textContent.trim(),
      canCreateAnother: Boolean(document.querySelector('a[href="/create.html"].create-another-link'))
    }))()`);
    assert(
      createSuccessView.formHidden && createSuccessView.shareVisible &&
      createSuccessView.heading === 'Game Created',
      'successful creation replaces the reset form with the invitation step'
    );
    assert(createSuccessView.canCreateAnother,
      'the success step offers a clear way to create another game');

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
        selectedFlag: library.images.some((image) => image.isSelected),
        statusText: document.getElementById('status').textContent
      };
    })()`);
    assert(
      uploadedResult.gameId && uploadedResult.hasHostToken &&
      uploadedResult.imageCount === 1 && uploadedResult.selectedImageId &&
      uploadedResult.selectedFlag,
      'a Somewhere new photo uploads after creation and is selected for the game'
    );
    assert(
      uploadedResult.statusText.includes('SMS confirmation is disabled in development mode'),
      'a local creation says that no confirmation text was sent'
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
