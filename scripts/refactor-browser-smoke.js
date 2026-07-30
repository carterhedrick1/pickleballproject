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
  return response.json();
}

async function uploadGamePhoto(baseUrl, game, bytes, contentType, caption) {
  const query = new URLSearchParams({ token: game.hostToken, caption });
  const response = await fetch(
    `${baseUrl}/api/games/${game.gameId}/photos?${query}`,
    { method: 'POST', headers: { 'Content-Type': contentType }, body: bytes }
  );
  if (!response.ok) {
    throw new Error(`game photo fixture upload failed: HTTP ${response.status}`);
  }
  return response.json();
}

(async () => {
  const local = await server.start();
  let browser;
  let seeded = false;
  try {
    const fx = await fixtures.seed(local.baseUrl);
    seeded = true;
    const [privateRandomizer, publicPersonalities] = await Promise.all([
      fetch(`${local.baseUrl}/api/dev/message-randomizer`),
      fetch(`${local.baseUrl}/api/message-personalities`).then((response) => response.json())
    ]);
    assert(
      privateRandomizer.status === 401 &&
        publicPersonalities.personalities.length === 1 &&
        Object.keys(publicPersonalities.personalities[0]).sort().join('|') ===
          'description|id|isDefault|name',
      'randomizer prompts, inventory, targeting, and phones stay behind Developer authentication'
    );
    const firstCourtImage = await uploadCourtImage(
      local.baseUrl, fx.open, PNG_1PX, 'image/png'
    );
    const secondCourtImage = await uploadCourtImage(
      local.baseUrl, fx.open, JPEG_BYTES, 'image/jpeg'
    );
    const firstGamePhoto = await uploadGamePhoto(
      local.baseUrl, fx.open, PNG_1PX, 'image/png', 'Doubles at sunset'
    );
    const secondGamePhoto = await uploadGamePhoto(
      local.baseUrl, fx.open, JPEG_BYTES, 'image/jpeg', 'The winning court'
    );

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
        scriptExternal: [...document.scripts].some((s) => s.src.endsWith('/js/create.js')),
        personality: document.getElementById('personalityId')?.value,
        personalityChoices: document.getElementById('personalityId')?.options.length,
        headerSlogan: document.querySelector('.header-slogan')?.textContent.trim(),
        footerSlogan: document.querySelector('.footer-slogan')?.textContent.trim(),
        localNotice: document.querySelector('.local-preview-notice')?.textContent.trim(),
        liveLink: document.querySelector('.local-preview-notice a')?.href
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
    assert(
      createReady.personality === 'realist' && createReady.personalityChoices === 1,
      'create form loads the enabled Realist personality'
    );
    assert(
      createReady.headerSlogan &&
        createReady.headerSlogan === createReady.footerSlogan &&
        !createReady.headerSlogan.includes('{NAME}'),
      'one resolved slogan is shared by the header and footer'
    );
    assert(
      createReady.localNotice?.includes('local test copy') &&
        createReady.liveLink === 'https://inorout.club/create.html',
      'local pages identify their test data and link to the matching live page'
    );

    await desktop.evaluate(`(() => {
      const select = document.getElementById('locationSelect');
      select.value = 'Oak Park Courts';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await cdp.sleep(500);
    const courtGallery = await desktop.evaluate(`(() => {
      const panel = document.getElementById('courtImageContainer');
      const savedPhotos = [...document.querySelectorAll(
        '.court-image-choice--photo'
      )];
      return {
        visible: !panel.hidden && getComputedStyle(panel).display !== 'none',
        savedPhotos: savedPhotos.length,
        uploadRemoved: !document.getElementById('courtImageUpload'),
        firstPhotoSelected: savedPhotos[0]?.querySelector('input').checked === true,
        noImageRemoved: !document.querySelector('input[value="none"]')
      };
    })()`);
    assert(
      courtGallery.visible && courtGallery.savedPhotos === 2 && courtGallery.firstPhotoSelected,
      'create form shows every saved court image and defaults to the first one'
    );
    assert(courtGallery.uploadRemoved && courtGallery.noImageRemoved,
      'create form has no court-image upload or No image choice');

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
      uploadRemoved: !document.getElementById('courtImageUpload')
    }))()`);
    assert(!emptyGallery.panelVisible && emptyGallery.choices === 0 && emptyGallery.uploadRemoved,
      'a court with no saved photos does not show an empty image panel or upload');

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
      set('players', '3');
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
        totalPlayers: game.totalPlayers,
        confirmedPlayers: game.players.length,
        waitlistNotificationSaved: game.notificationPreferences?.waitlistStarts === true
      };
    })()`);
    assert(
      noImageResult.gameId && noImageResult.imageCount === 0 && !noImageResult.selectedImageId,
      'a game with no saved court photo still creates without an image'
    );
    assert(noImageResult.waitlistNotificationSaved,
      'the waitlist-start notification default is saved with the game');
    assert(
      noImageResult.totalPlayers === 4 && noImageResult.confirmedPlayers === 1,
      'three additional players plus the playing organizer creates a four-player game'
    );
    const createSuccessView = await desktop.evaluate(`(() => ({
      formHidden: document.querySelector('.form-section').hidden,
      shareVisible: getComputedStyle(document.getElementById('shareLink')).display !== 'none',
      heading: document.querySelector('.page-header h1').textContent.trim(),
      hasManagementReminder: Boolean(document.querySelector('.management-reminder')),
      canCreateAnother: Boolean(document.querySelector('a[href="/create.html"].create-another-link'))
    }))()`);
    assert(
      createSuccessView.formHidden && createSuccessView.shareVisible &&
      createSuccessView.heading === 'Game Created',
      'successful creation replaces the reset form with the invitation step'
    );
    assert(!createSuccessView.hasManagementReminder && !createSuccessView.canCreateAnother,
      'the success step omits the management reminder and create-another link');

    for (const player of [
      { phone: fx.JOIN_PHONE, name: 'Roster Player One', duprRating: 3.5 },
      { phone: fx.FORM_PHONE, name: 'Roster Player Two', duprRating: 4.1 }
    ]) {
      const response = await fetch(
        `${local.baseUrl}/api/roster/${fx.HOST_PHONE}/${player.phone}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(player)
        }
      );
      assert(response.ok, `${player.name} is available in the host roster fixture`);
    }

    await desktop.goto(
      `${local.baseUrl}/manage.html?id=${fx.open.gameId}&token=${fx.open.hostToken}`
    );
    await cdp.sleep(500);
    const manageReady = await desktop.evaluate(`(() => {
      const name = [...document.querySelectorAll('.player-name')]
        .find((node) => node.textContent.startsWith('<img'));
      const imageChoiceWidth = document.querySelector('.court-image-choice--photo')
        ?.getBoundingClientRect().width;
      const noImageWidth = document.getElementById('noImageOption')?.getBoundingClientRect().width;
      document.querySelector('[data-tab="Players"]').click();
      return {
        visible: getComputedStyle(document.getElementById('gameManagement')).display !== 'none',
        namespaces: Boolean(
          ManageApp.core && ManageApp.players && ManageApp.communications && ManageApp.media
        ),
        playerText: name && name.textContent,
        injectedElement: Boolean(name && name.querySelector('img')),
        playersActive: document.getElementById('Players').classList.contains('active'),
        locationOnly: !document.getElementById('court' + 'Number') &&
          !document.body.innerText.includes(['Court', 'Number'].join(' ')),
        additionalPlayers: document.getElementById('players').value,
        additionalPlayersHelp: document.getElementById('playersHelp').textContent,
        personality: document.getElementById('personalityId').value,
        intendedInviteeChoices: document.querySelectorAll(
          '.intended-invitee-checkbox'
        ).length,
        inviteeCopyIsHonest: document.querySelector('#intendedInviteesTitle + p')
          ?.textContent.includes('does not know who receives'),
        imageUpdateCopy: document.querySelector('.court-images-intro')?.textContent
          .includes('player link you already sent'),
        manualPlayerSamplesRemoved:
          !document.getElementById('playerName').hasAttribute('placeholder') &&
          !document.getElementById('playerPhone').hasAttribute('placeholder'),
        imageChoiceWidth,
        noImageWidth
      };
    })()`);
    assert(manageReady.visible && manageReady.namespaces, 'management feature modules initialize');
    assert(manageReady.playersActive, 'management tab listeners work without inline handlers');
    assert(manageReady.locationOnly, 'management details use location without a separate court field');
    assert(
      manageReady.additionalPlayers === '5' &&
        manageReady.additionalPlayersHelp.includes('Player 1'),
      'management shows five additional players for a six-player game with the host playing'
    );
    assert(
      manageReady.personality === 'realist' &&
        manageReady.intendedInviteeChoices === 2 &&
        manageReady.inviteeCopyIsHonest,
      'management edits Realist and tracks intended invitees without claiming delivery'
    );
    assert(manageReady.imageUpdateCopy,
      'court image copy explains that the existing player link updates automatically');
    assert(
      manageReady.manualPlayerSamplesRemoved,
      'manual player name and phone fields have no pre-populated sample text'
    );
    assert(
      manageReady.imageChoiceWidth === manageReady.noImageWidth &&
        manageReady.noImageWidth <= 110,
      `No Image is a compact choice matching the court image tiles ` +
        `(${manageReady.imageChoiceWidth}px/${manageReady.noImageWidth}px)`
    );
    assert(
      manageReady.playerText.startsWith('<img') && !manageReady.injectedElement,
      'HTML-like player names remain text in the live page'
    );

    const inviteeTracking = await desktop.evaluate(`(async () => {
      const choices = [...document.querySelectorAll('.intended-invitee-checkbox')];
      choices[0].checked = true;
      document.getElementById('saveIntendedInvitees').click();
      await new Promise((resolve) => setTimeout(resolve, 400));
      const hostGame = await fetch(
        '/api/games/${fx.open.gameId}?token=${fx.open.hostToken}'
      ).then((response) => response.json());
      const publicGame = await fetch('/api/games/${fx.open.gameId}')
        .then((response) => response.json());
      const invitation = await fetch(
        '/api/games/${fx.open.gameId}/invitation-message',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: '${fx.open.hostToken}' })
        }
      ).then((response) => response.json());
      return {
        intended: hostGame.invitedPlayers?.length,
        publicLeak: Object.prototype.hasOwnProperty.call(publicGame, 'invitedPlayers'),
        invitationHasLink: invitation.message?.includes(
          '/game.html?id=${fx.open.gameId}'
        ),
        invitationHasDetails: invitation.message?.includes('Oak Park Courts') &&
          invitation.message?.includes('do not reply to this text message')
      };
    })()`);
    assert(
      inviteeTracking.intended === 1 &&
        !inviteeTracking.publicLeak &&
        inviteeTracking.invitationHasLink &&
        inviteeTracking.invitationHasDetails,
      'intended invitees stay private and server-built invitations preserve every instruction'
    );

    const rosterPickerReady = await desktop.evaluate(`(() => {
      document.querySelector('[data-collapsible="addPlayerSection"]').click();
      const choices = [...document.querySelectorAll('.roster-player-checkbox')];
      const names = [...document.querySelectorAll('.roster-player-name')]
        .map((node) => node.textContent.trim());
      choices.forEach((choice) => {
        choice.checked = true;
        choice.dispatchEvent(new Event('change', { bubbles: true }));
      });
      const button = document.getElementById('addRosterPlayersBtn');
      const result = {
        count: choices.length,
        names,
        buttonText: button.textContent,
        buttonEnabled: !button.disabled
      };
      button.click();
      return result;
    })()`);
    assert(
      rosterPickerReady.count === 2 &&
        rosterPickerReady.names.join('|') === 'Roster Player One|Roster Player Two',
      'management loads the host roster as safe multi-select choices'
    );
    assert(
      rosterPickerReady.buttonEnabled &&
        rosterPickerReady.buttonText === 'Add 2 Selected Players',
      'the roster action reflects the number of selected players'
    );
    await cdp.sleep(1000);
    const rosterAddResult = await desktop.evaluate(`(() => {
      const names = [
        ...document.querySelectorAll('#confirmedPlayers .player-name'),
        ...document.querySelectorAll('#waitlistPlayers .player-name')
      ].map((node) => node.textContent.trim());
      return {
        firstAdded: names.includes('Roster Player One'),
        secondAdded: names.includes('Roster Player Two'),
        status: document.getElementById('status').textContent,
        pickerEmpty: document.getElementById('rosterPickerStatus').textContent
      };
    })()`);
    assert(
      rosterAddResult.firstAdded && rosterAddResult.secondAdded,
      'multiple selected roster players are added through the management page'
    );
    assert(
      rosterAddResult.status === '2 roster players added successfully' &&
        rosterAddResult.pickerEmpty === 'Everyone on your roster is already listed for this game.',
      'the roster picker reports success and filters players already in the game'
    );

    await desktop.evaluate(`(() => {
      document.getElementById('playerName').value = 'Manual Waitlist Player';
      document.getElementById('addToWaitlist').checked = true;
      document.getElementById('addPlayerForm').requestSubmit();
    })()`);
    await cdp.sleep(700);
    const manualWaitlistAdded = await desktop.evaluate(`(() =>
      [...document.querySelectorAll('#waitlistPlayers .player-name')]
        .some((node) => node.textContent.trim() === 'Manual Waitlist Player')
    )()`);
    assert(
      manualWaitlistAdded,
      'the manual Waitlist choice sends the destination expected by the server'
    );

    const activeDeleteResponse = await fetch(
      `${local.baseUrl}/api/games/${fx.full.gameId}/permanent`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: fx.full.hostToken })
      }
    );
    assert(
      activeDeleteResponse.status === 400,
      'an active upcoming game remains protected from permanent deletion'
    );

    const cancelResponse = await fetch(
      `${local.baseUrl}/api/games/${fx.approval.gameId}`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: fx.approval.hostToken,
          reason: 'Browser smoke cancellation'
        })
      }
    );
    assert(cancelResponse.ok, 'future fixture can be cancelled for My Games coverage');

    await desktop.evaluate(
      `localStorage.setItem('hostPhone', '${fx.HOST_PHONE}')`
    );
    await desktop.goto(`${local.baseUrl}/my-games.html`);
    await cdp.sleep(500);
    const myGamesGrouping = await desktop.evaluate(`(() => {
      const createGameButton = getComputedStyle(document.querySelector('.create-game-btn'));
      const nativeButton = getComputedStyle(document.querySelector('#upcomingList button'));
      return {
        cancelledInUpcoming: document.querySelectorAll('#upcomingList .game-item.cancelled').length,
        cancelledInPast: document.querySelectorAll('#pastList .game-item.cancelled').length,
        cancelledPastLocation: document.querySelector('#pastList .game-item.cancelled .game-title')
          ?.textContent.trim(),
        cancelledHasDelete: Boolean(
          document.querySelector('#pastList .game-item.cancelled [data-delete]')
        ),
        buttonAlignment: {
          linkDisplay: createGameButton.display,
          linkAlign: createGameButton.alignItems,
          linkJustify: createGameButton.justifyContent,
          nativeDisplay: nativeButton.display,
          nativeAlign: nativeButton.alignItems,
          nativeJustify: nativeButton.justifyContent
        }
      };
    })()`);
    assert(
      ['flex', 'inline-flex'].includes(myGamesGrouping.buttonAlignment.linkDisplay) &&
        myGamesGrouping.buttonAlignment.linkAlign === 'center' &&
        myGamesGrouping.buttonAlignment.linkJustify === 'center' &&
        ['flex', 'inline-flex'].includes(myGamesGrouping.buttonAlignment.nativeDisplay) &&
        myGamesGrouping.buttonAlignment.nativeAlign === 'center' &&
        myGamesGrouping.buttonAlignment.nativeJustify === 'center',
      'native and link-style button labels are centered in both directions'
    );
    assert(
      myGamesGrouping.cancelledInUpcoming === 0 &&
        myGamesGrouping.cancelledInPast === 1 &&
        myGamesGrouping.cancelledPastLocation === 'Riverside Athletic Club',
      'a cancelled upcoming game moves from Upcoming to Past Games'
    );
    assert(
      myGamesGrouping.cancelledHasDelete,
      'a cancelled upcoming game offers immediate permanent deletion'
    );

    const deletePanelOpened = await desktop.evaluate(`(() => {
      const card = document.querySelector('#pastList .game-item.cancelled');
      card.querySelector('[data-delete]').click();
      const panel = card.querySelector('.delete-panel');
      const opened = getComputedStyle(panel).display !== 'none';
      card.querySelector('[data-delete-confirm]').click();
      return opened;
    })()`);
    assert(deletePanelOpened, 'cancelled-game deletion still requires confirmation');
    await cdp.sleep(500);
    const cancelledDeleteResult = await desktop.evaluate(`(() => ({
      cardRemoved: !document.querySelector('#pastList .game-item.cancelled'),
      successMessage: document.getElementById('status').textContent
    }))()`);
    const deletedGameResponse = await fetch(
      `${local.baseUrl}/api/games/${fx.approval.gameId}`
    );
    assert(
      cancelledDeleteResult.cardRemoved &&
        cancelledDeleteResult.successMessage === 'Game deleted.' &&
        deletedGameResponse.status === 404,
      'a host can permanently delete a cancelled upcoming game immediately'
    );

    await desktop.goto(`${local.baseUrl}/dev.html`);
    const devPassword = JSON.stringify(process.env.DEV_PASSWORD || 'vibe123');
    const devLogin = await desktop.evaluate(`(async () => {
      const res = await fetch('/api/dev/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: ${devPassword} })
      });
      if (res.ok) {
        showApp();
        document.querySelector('[data-tab="slogans"]').click();
      }
      return res.ok;
    })()`);
    await cdp.sleep(500);
    const sloganEditor = await desktop.evaluate(`(() => ({
      slogans: document.querySelectorAll('#sloganList .slogan-entry').length,
      names: document.querySelectorAll('#sloganNameList .name-chip').length,
      sloganForm: Boolean(document.getElementById('sloganForm')),
      nameForm: Boolean(document.getElementById('sloganNameForm')),
      editButtons: document.querySelectorAll('[data-action="edit-slogan"]').length
    }))()`);
    assert(
      devLogin &&
        sloganEditor.slogans > 0 &&
        sloganEditor.names > 0 &&
        sloganEditor.sloganForm &&
        sloganEditor.nameForm &&
        sloganEditor.editButtons === sloganEditor.slogans,
      'developer area can manage the slogan and name rotations'
    );

    const messageRandomizer = await desktop.evaluate(`(async () => {
      document.querySelector('[data-tab="message-randomizer"]').click();
      await new Promise((resolve) => setTimeout(resolve, 650));
      const inventoryResponse = await fetch(
        '/api/dev/randomizer-messages?personalityId=realist'
      );
      const inventory = await inventoryResponse.json();
      document.querySelector(
        '#randomizerSurfaceRows tr[data-surface-id="site-slogan"] [data-action="surface-preview"]'
      ).click();
      await new Promise((resolve) => setTimeout(resolve, 250));
      const previewPanel = document.getElementById('randomizerPreviewPanel');
      const previewRect = previewPanel.getBoundingClientRect();
      return {
        visible: !document.getElementById('tab-message-randomizer').classList.contains('hidden'),
        personality: document.getElementById('randomizerPersonality').value,
        surfaces: document.querySelectorAll('#randomizerSurfaceRows tr').length,
        messages: inventory.messages.length,
        slogans: inventory.messages.filter(
          (message) => message.surfaceId === 'site-slogan' &&
            message.locked && message.vetted
        ).length,
        youreIn: inventory.messages.filter(
          (message) => message.surfaceId === 'youre-in' &&
            message.locked && message.vetted
        ).length,
        favoriteLabels: document.getElementById('randomizerMessageList')
          .textContent.includes('Locked Favorite') &&
          document.getElementById('randomizerMessageList').textContent.includes('Vetted'),
        reusablePrompt:
          document.getElementById('randomizerReusablePrompt').value.includes(
            'Generate 50 distinct candidate messages'
          ) &&
          document.getElementById('randomizerReusablePrompt').value.includes(
            'Do not change the app until I explicitly say'
          ) &&
          document.getElementById('randomizerPromptSurface').options.length === 15 &&
          Boolean(document.getElementById('randomizerCopyPrompt')),
        targetPlayers: document.getElementById('randomizerRulePlayer').options.length,
        preview: document.querySelector('#randomizerPreviewOutput .randomizer-preview')
          ?.textContent.trim(),
        previewSurface: document.getElementById('randomizerPreviewSurface').value,
        previewPanelVisible: previewRect.top >= 0 && previewRect.top < window.innerHeight,
        externalScript: [...document.scripts].some(
          (script) => script.src.endsWith('/js/message-randomizer-admin.js')
        )
      };
    })()`);
    assert(
      messageRandomizer.visible &&
        messageRandomizer.personality === 'realist' &&
        messageRandomizer.surfaces === 15 &&
        messageRandomizer.messages >= 41 &&
        messageRandomizer.slogans === 19 &&
        messageRandomizer.youreIn === 22 &&
        messageRandomizer.favoriteLabels &&
        messageRandomizer.reusablePrompt &&
        messageRandomizer.targetPlayers > 1 &&
        messageRandomizer.preview &&
        messageRandomizer.preview !== 'Resolving stored inventory…' &&
        messageRandomizer.previewSurface === 'site-slogan' &&
        messageRandomizer.previewPanelVisible &&
        messageRandomizer.externalScript,
      'developer Message Randomizer shows vetted favorites, targeting, and a working surface preview'
    );

    const imageInventory = await desktop.evaluate(`(async () => {
      document.querySelector('[data-tab="images"]').click();
      await new Promise((resolve) => setTimeout(resolve, 350));
      const developerUploadResponse = await fetch(
        '/api/dev/courts/${encodeURIComponent('Oak Park Courts')}/image',
        {
          method: 'POST',
          headers: { 'Content-Type': 'image/png' },
          body: new Uint8Array(${JSON.stringify([...PNG_1PX])})
        }
      );
      const developerUpload = await developerUploadResponse.json();
      await loadImages();
      const apiResponse = await fetch('/api/dev/images');
      const apiData = await apiResponse.json();
      const wantedIds = ${JSON.stringify([
        firstCourtImage.imageId,
        secondCourtImage.imageId,
        firstGamePhoto.id,
        secondGamePhoto.id
      ])}.concat(developerUpload.imageId);
      const wanted = apiData.images.filter((image) => wantedIds.includes(image.id));
      const cards = wantedIds.map((id) =>
        document.querySelector('[data-image-id="' + id + '"]')
      );
      return {
        responseOk: apiResponse.ok && developerUploadResponse.ok,
        developerImageId: developerUpload.imageId,
        developerUploader: wanted.find((image) => image.id === developerUpload.imageId)?.uploaderName,
        tabLabel: document.querySelector('[data-tab="images"]').textContent.trim(),
        visible: !document.getElementById('tab-images').classList.contains('hidden'),
        sourceTitle: document.getElementById('imageSourceTitle').textContent.trim(),
        wanted: wanted.length,
        courtImages: wanted.filter((image) => image.type === 'court').length,
        gamePhotos: wanted.filter((image) => image.type === 'game').length,
        uploaderNames: [...new Set(wanted.map((image) => image.uploaderName))],
        cards: cards.filter(Boolean).length,
        cardUploaders: cards.map((card) =>
          [...(card?.querySelectorAll('.image-card-details dd') || [])][0]?.textContent.trim()
        ),
        deleteLabels: cards.map((card) =>
          card?.querySelector('[data-action="delete-image"]')?.textContent.trim()
        )
      };
    })()`);
    assert(
      imageInventory.responseOk &&
        imageInventory.tabLabel === 'Images' &&
        imageInventory.visible &&
        imageInventory.sourceTitle === 'Showing Local Test Images' &&
        imageInventory.wanted === 5 &&
        imageInventory.courtImages === 3 &&
        imageInventory.gamePhotos === 2 &&
        imageInventory.uploaderNames.includes('Scott H.') &&
        imageInventory.uploaderNames.includes('Developer Area') &&
        imageInventory.developerUploader === 'Developer Area' &&
        imageInventory.cards === 5 &&
        imageInventory.deleteLabels.every((label) => label === 'Delete Image'),
      'developer Images tab shows every image type, uploader names, and delete controls'
    );

    const linkedCourtImageDelete = await desktop.evaluate(`(async () => {
      const originalConfirm = window.confirm;
      window.confirm = () => true;
      document.querySelector(
        '[data-image-id="${imageInventory.developerImageId}"] [data-action="delete-image"]'
      ).click();
      await new Promise((resolve) => setTimeout(resolve, 500));
      window.confirm = originalConfirm;
      return !document.querySelector('[data-image-id="${imageInventory.developerImageId}"]');
    })()`);
    const [deletedCourtLibraryImage, deletedLegacyCourtImage, libraryAfterDeveloperDelete] =
      await Promise.all([
        fetch(`${local.baseUrl}/api/court-images/${imageInventory.developerImageId}`),
        fetch(`${local.baseUrl}/api/courts/${encodeURIComponent('Oak Park Courts')}/image`),
        fetch(`${local.baseUrl}/api/courts/${encodeURIComponent('Oak Park Courts')}/library`)
          .then((response) => response.json())
      ]);
    assert(
      linkedCourtImageDelete &&
        deletedCourtLibraryImage.status === 404 &&
        deletedLegacyCourtImage.status === 404 &&
        !libraryAfterDeveloperDelete.images.some(
          (image) => image.id === imageInventory.developerImageId
        ),
      'deleting a developer court image removes its library and legacy copies together'
    );

    const developerImageDelete = await desktop.evaluate(`(async () => {
      const originalConfirm = window.confirm;
      window.confirm = () => true;
      document.querySelector(
        '[data-image-id="${firstGamePhoto.id}"] [data-action="delete-image"]'
      ).click();
      await new Promise((resolve) => setTimeout(resolve, 500));
      window.confirm = originalConfirm;
      return {
        removed: !document.querySelector('[data-image-id="${firstGamePhoto.id}"]'),
        remainingGamePhoto: Boolean(
          document.querySelector('[data-image-id="${secondGamePhoto.id}"]')
        )
      };
    })()`);
    const deletedPhotoResponse = await fetch(`${local.baseUrl}${firstGamePhoto.url}`);
    assert(
      developerImageDelete.removed &&
        developerImageDelete.remainingGamePhoto &&
        deletedPhotoResponse.status === 404,
      'a developer can permanently delete any uploaded image from the Images tab'
    );
    await desktop.evaluate(
      `document.querySelector('[data-tab="slogans"]').click()`
    );
    await cdp.sleep(250);
    const sloganEditControls = await desktop.evaluate(`(() => {
      const original = document.querySelector('#sloganList .copy').textContent;
      document.querySelector('[data-action="edit-slogan"]').click();
      const form = document.querySelector('.slogan-edit-form');
      const input = form.querySelector('input');
      const result = {
        value: input.value,
        focused: document.activeElement === input,
        save: form.querySelector('button[type="submit"]').textContent.trim(),
        cancel: form.querySelector('[data-action="cancel-edit-slogan"]').textContent.trim()
      };
      form.querySelector('[data-action="cancel-edit-slogan"]').click();
      result.cancelled = document.querySelector('#sloganList .copy').textContent === original;
      return result;
    })()`);
    assert(
      sloganEditControls.value &&
        sloganEditControls.focused &&
        sloganEditControls.save === 'Save' &&
        sloganEditControls.cancel === 'Cancel' &&
        sloganEditControls.cancelled,
      'developer area opens and cancels inline slogan editing'
    );

    const rosterDirectory = await desktop.evaluate(`(async () => {
      document.querySelector('[data-tab="rosters"]').click();
      await new Promise((resolve) => setTimeout(resolve, 350));
      const player = document.querySelector(
        '[data-player-phone="${fx.JOIN_PHONE}"]'
      );
      return {
        visible: !document.getElementById('tab-rosters').classList.contains('hidden'),
        hosts: document.querySelectorAll('#hostRosterList .host-roster').length,
        players: document.querySelectorAll('#masterRosterList .master-player').length,
        playerFound: Boolean(player),
        editButton: player?.querySelector('[data-roster-action="edit"]')?.textContent.trim(),
        deleteButton: player?.querySelector('[data-roster-action="delete"]')?.textContent.trim(),
        phone: player?.querySelector('.roster-person-phone')?.textContent.trim(),
        hostRoster: player?.querySelector('.roster-person-meta')?.textContent.trim(),
        sourceTitle: document.getElementById('rosterSourceTitle').textContent.trim(),
        sourceSwitchHidden: document.getElementById('rosterSourceToggle').classList.contains('hidden')
      };
    })()`);
    assert(
      rosterDirectory.visible &&
        rosterDirectory.hosts > 0 &&
        rosterDirectory.players > 0 &&
        rosterDirectory.playerFound &&
        rosterDirectory.editButton === 'Edit' &&
        rosterDirectory.deleteButton === 'Delete' &&
        rosterDirectory.phone === '(555) 555-0777' &&
        rosterDirectory.hostRoster === 'Host Roster: Scott H.' &&
        rosterDirectory.sourceTitle === 'Showing Local Test Data' &&
        rosterDirectory.sourceSwitchHidden,
      'developer area identifies each player’s host roster while automated local servers stay locked away from production'
    );

    const rosterEdit = await desktop.evaluate(`(async () => {
      const player = document.querySelector('[data-player-phone="${fx.JOIN_PHONE}"]');
      player.querySelector('[data-roster-action="edit"]').click();
      const form = player.querySelector('.player-edit-form');
      form.elements.name.value = 'Sam Rivera Edited';
      form.requestSubmit();
      await new Promise((resolve) => setTimeout(resolve, 450));
      const updated = document.querySelector('[data-player-phone="${fx.JOIN_PHONE}"]');
      return {
        masterName: updated?.querySelector('.roster-person-name')?.textContent.trim(),
        hostHasName: document.getElementById('hostRosterList').textContent.includes('Sam Rivera Edited')
      };
    })()`);
    assert(
      rosterEdit.masterName === 'Sam Rivera Edited' && rosterEdit.hostHasName,
      'editing a master player updates the master list and host roster'
    );

    const rosterDelete = await desktop.evaluate(`(async () => {
      const player = document.querySelector('[data-player-phone="${fx.JOIN_PHONE}"]');
      player.querySelector('[data-roster-action="delete"]').click();
      const warning = player.querySelector('.player-delete-confirm');
      const warned = !warning.classList.contains('hidden') &&
        warning.textContent.includes('every host roster and every game roster');
      warning.querySelector('[data-roster-action="confirm-delete"]').click();
      await new Promise((resolve) => setTimeout(resolve, 450));
      return {
        warned,
        removed: !document.querySelector('[data-player-phone="${fx.JOIN_PHONE}"]')
      };
    })()`);
    assert(
      rosterDelete.warned && rosterDelete.removed,
      'deleting a master player requires a specific warning and removes the player everywhere'
    );

    const styleCommandCenter = await desktop.evaluate(`(() => {
      document.querySelector('[data-tab="style-command-center"]').click();
      const rootStyles = getComputedStyle(document.documentElement);
      const activePanel = document.getElementById('tab-style-command-center');
      const compactButton = activePanel.querySelector('.style-button-compact');
      const standardButton = activePanel.querySelector(
        '.style-button:not(.style-button-compact):not(.style-button-large)'
      );
      const largeButton = activePanel.querySelector('.style-button-large');
      return {
        visible: !activePanel.classList.contains('hidden'),
        active: document.querySelector('[data-tab="style-command-center"]').classList.contains('active'),
        brand: rootStyles.getPropertyValue('--brand').trim(),
        ink: rootStyles.getPropertyValue('--ink').trim(),
        canvas: rootStyles.getPropertyValue('--canvas').trim(),
        surface: rootStyles.getPropertyValue('--surface').trim(),
        warning: rootStyles.getPropertyValue('--warning').trim(),
        danger: rootStyles.getPropertyValue('--danger').trim(),
        tokens: activePanel.querySelectorAll('.style-token').length,
        rules: activePanel.querySelectorAll('.style-rule').length,
        statuses: activePanel.querySelectorAll('.style-status').length,
        compactHeight: getComputedStyle(compactButton).minHeight,
        standardHeight: getComputedStyle(standardButton).minHeight,
        largeHeight: getComputedStyle(largeButton).minHeight,
        invalidField: activePanel.querySelector('[aria-invalid="true"]') !== null
      };
    })()`);
    assert(
      styleCommandCenter.visible &&
        styleCommandCenter.active &&
        styleCommandCenter.brand.toLowerCase() === '#166534' &&
        styleCommandCenter.ink.toLowerCase() === '#172033' &&
        styleCommandCenter.canvas.toLowerCase() === '#f4f6f3' &&
        styleCommandCenter.surface.toLowerCase() === '#ffffff' &&
        styleCommandCenter.warning.toLowerCase() === '#a85d00' &&
        styleCommandCenter.danger.toLowerCase() === '#b42318' &&
        styleCommandCenter.tokens === 6 &&
        styleCommandCenter.rules === 4 &&
        styleCommandCenter.statuses === 3 &&
        styleCommandCenter.compactHeight === '36px' &&
        styleCommandCenter.standardHeight === '44px' &&
        styleCommandCenter.largeHeight === '52px' &&
        styleCommandCenter.invalidField,
      'developer area shows the Court Classic palette and every selected component rule'
    );

    const rulesTab = await desktop.evaluate(`(() => {
      document.querySelector('[data-tab="rules"]').click();
      const activePanel = document.getElementById('tab-rules');
      const rules = [...activePanel.querySelectorAll('.build-rule')];
      return {
        visible: !activePanel.classList.contains('hidden'),
        active: document.querySelector('[data-tab="rules"]').classList.contains('active'),
        sections: activePanel.querySelectorAll('.rule-section').length,
        rules: rules.length,
        firstRule: rules[0]?.querySelector('strong')?.textContent.trim(),
        lastRule: rules.at(-1)?.querySelector('strong')?.textContent.trim()
      };
    })()`);
    assert(
      rulesTab.visible &&
        rulesTab.active &&
        rulesTab.sections === 6 &&
        rulesTab.rules === 41 &&
        rulesTab.firstRule === 'Prove Every Change As A User' &&
        rulesTab.lastRule === 'Trust Image Bytes, Not File Claims',
      'developer area lists every current app-building rule in the Rules tab'
    );

    const replyOptionEditor = await desktop.evaluate(`(async () => {
      document.querySelector('[data-tab="reply-options"]').click();
      await new Promise((resolve) => setTimeout(resolve, 250));
      const response = await fetch('/api/dev/reply-options');
      const data = await response.json();
      return {
        responseOk: response.ok,
        systemCards: document.querySelectorAll('#systemReplyOptions .reply-option').length,
        commands: [...document.querySelectorAll('#systemReplyOptions .reply-command')]
          .map((element) => element.textContent.trim()).join(','),
        form: Boolean(document.getElementById('replyOptionForm')),
        audienceChoices: document.getElementById('replyOptionAudience').options.length,
        availableCommands: document.getElementById('replyOptionCommand').options.length,
        tokens: document.getElementById('replyOptionTokens').textContent,
        apiCommands: data.systemOptions.map((option) => option.command).join(',')
      };
    })()`);
    assert(
      replyOptionEditor.responseOk &&
        replyOptionEditor.systemCards === 3 &&
        replyOptionEditor.commands === '1,2,9' &&
        replyOptionEditor.form &&
        replyOptionEditor.audienceChoices === 3 &&
        replyOptionEditor.availableCommands === 7 &&
        replyOptionEditor.tokens.includes('{LOCATION}') &&
        replyOptionEditor.tokens.includes('{MANAGEMENT_LINK}') &&
        replyOptionEditor.apiCommands === '1,2,9',
      'developer area inventories built-in SMS replies and can create role-specific options'
    );

    const youreInEditor = await desktop.evaluate(`(async () => {
      const textMessagingTab = document.getElementById('textMessagingTab');
      textMessagingTab.click();
      const dropdownOpened = {
        label: textMessagingTab.textContent.trim().replace('▼', '').trim(),
        expanded: textMessagingTab.getAttribute('aria-expanded') === 'true',
        visible: !document.getElementById('textMessagingMenu').classList.contains('hidden')
      };
      document.querySelector('[data-tab="youre-in"]').click();
      await new Promise((resolve) => setTimeout(resolve, 250));
      const categoryTabs = [
        'youre-in', 'waitlist-confirmation', 'application-confirmation',
        'roster-status-change', 'player-cancellation', 'upcoming-reminder',
        'game-cancelled', 'organizer-announcement', 'game-created', 'host-alerts',
        'management-links', 'game-details', 'cancellation-help'
      ];
      const messages = document.querySelectorAll('#youreInList .slogan-entry').length;
      const editButtons = document.querySelectorAll('[data-action="edit-youre-in"]').length;
      const first = document.querySelector('#youreInList .copy')?.textContent || '';
      document.getElementById('addAnotherText').click();
      const bulkFields = document.querySelectorAll('#bulkMessageFields .text-message-input').length;
      const bulkButton = document.getElementById('addAllTexts').textContent.trim();
      const detailsEditor = {
        form: Boolean(document.getElementById('textMessageDetailsForm')),
        value: document.getElementById('textMessageDetailsTemplate')?.value || '',
        save: document.querySelector('#textMessageDetailsForm button[type="submit"]')?.textContent.trim()
      };
      const youreInLiveNote = !document.getElementById('textMessageLiveNote').classList.contains('hidden');
      document.querySelector('[data-tab="waitlist-confirmation"]').click();
      await new Promise((resolve) => setTimeout(resolve, 40));
      const waitlistToggle = {
        visible: !document.getElementById('textMessageMode').classList.contains('hidden'),
        off: document.getElementById('useRandomTexts').checked === false,
        fallback: document.getElementById('textMessageModeDetail').textContent.includes('current app text'),
        tokens: document.getElementById('textMessageTokenList').textContent.includes('{DEFAULT_TEXT}')
      };
      document.querySelector('[data-tab="application-confirmation"]').click();
      await new Promise((resolve) => setTimeout(resolve, 40));
      const consecutiveToggleVisible =
        !document.getElementById('textMessageMode').classList.contains('hidden');
      document.querySelector('[data-tab="youre-in"]').click();
      await new Promise((resolve) => setTimeout(resolve, 40));
      document.querySelector('[data-action="edit-youre-in"]')?.click();
      const form = document.querySelector('.youre-in-edit-form');
      const input = form?.querySelector('textarea');
      const result = {
        messages,
        editButtons,
        startsWithYoureIn: first.startsWith("You're IN"),
        form: Boolean(document.getElementById('youreInForm')),
        dropdownOpened,
        topLevelCategoryTabs:
          document.querySelectorAll('.tabs > button[data-tab="youre-in"]').length,
        dropdownActive: textMessagingTab.classList.contains('active'),
        dropdownClosed:
          textMessagingTab.getAttribute('aria-expanded') === 'false' &&
          document.getElementById('textMessagingMenu').classList.contains('hidden'),
        categoryTabs: categoryTabs.filter((id) => document.querySelector('[data-tab="' + id + '"]')).length,
        preview: document.getElementById('textMessagePreviewBody')?.textContent.includes('Pickleball at'),
        bulkFields,
        bulkButton,
        bulkPaste: Boolean(document.getElementById('bulkPasteTexts')),
        detailsEditor,
        youreInLiveNote,
        waitlistToggle,
        consecutiveToggleVisible,
        focused: document.activeElement === input,
        save: form?.querySelector('button[type="submit"]')?.textContent.trim(),
        cancel: form?.querySelector('[data-action="cancel-edit-youre-in"]')?.textContent.trim()
      };
      form?.querySelector('[data-action="cancel-edit-youre-in"]')?.click();
      result.cancelled = !document.querySelector('.youre-in-edit-form');
      return result;
    })()`);
    assert(
      youreInEditor.messages === 22 &&
        youreInEditor.editButtons === youreInEditor.messages &&
        youreInEditor.startsWithYoureIn &&
        youreInEditor.form &&
        youreInEditor.dropdownOpened.label === 'Text Messaging' &&
        youreInEditor.dropdownOpened.expanded &&
        youreInEditor.dropdownOpened.visible &&
        youreInEditor.topLevelCategoryTabs === 0 &&
        youreInEditor.dropdownActive &&
        youreInEditor.dropdownClosed &&
        youreInEditor.categoryTabs === 13 &&
        youreInEditor.preview &&
        youreInEditor.bulkFields === 2 &&
        youreInEditor.bulkButton === 'Add All 2 Openings' &&
        youreInEditor.bulkPaste &&
        youreInEditor.detailsEditor.form &&
        youreInEditor.detailsEditor.value.includes('{LOCATION}') &&
        youreInEditor.detailsEditor.value.includes('{TOTAL_PLAYERS}') &&
        youreInEditor.detailsEditor.save === 'Save Details' &&
        youreInEditor.youreInLiveNote &&
        youreInEditor.waitlistToggle.visible &&
        youreInEditor.waitlistToggle.off &&
        youreInEditor.waitlistToggle.fallback &&
        youreInEditor.waitlistToggle.tokens &&
        youreInEditor.consecutiveToggleVisible &&
        youreInEditor.focused &&
        youreInEditor.save === 'Save' &&
        youreInEditor.cancel === 'Cancel' &&
        youreInEditor.cancelled,
      'developer area dropdown shows all text categories, previews, bulk entry, and inline editing'
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
      external: [...document.scripts].some((s) => s.src.endsWith('/js/game-page.js')),
      locationOnly: !document.getElementById('court' + 'Number') &&
        !document.body.innerText.includes(['Court', 'Number'].join(' '))
    }))()`);
    assert(gameReady.visible && gameReady.pageUtils, 'mobile game page initializes with shared utilities');
    assert(gameReady.external, 'game page uses its external script');
    assert(gameReady.locationOnly, 'player game details use location without a separate court field');

    const hostDelete = await desktop.evaluate(`(async () => {
      document.querySelector('[data-tab="rosters"]').click();
      await new Promise((resolve) => setTimeout(resolve, 250));
      const host = document.querySelector('[data-host-phone="${fx.HOST_PHONE}"]');
      host.querySelector('[data-host-action="delete"]').click();
      const warning = host.querySelector('.host-delete-confirm');
      const warned = !warning.classList.contains('hidden') &&
        warning.textContent.includes('including every game they host') &&
        warning.textContent.includes('People listed with other hosts will remain there');
      warning.querySelector('[data-host-action="confirm-delete"]').click();
      await new Promise((resolve) => setTimeout(resolve, 450));
      const response = await fetch('/api/dev/rosters?source=local');
      const directory = await response.json();
      return {
        warned,
        removed: !document.querySelector('[data-host-phone="${fx.HOST_PHONE}"]'),
        gamesRemoved: directory.hosts.every((item) => item.phone !== '${fx.HOST_PHONE}')
      };
    })()`);
    assert(
      hostDelete.warned && hostDelete.removed && hostDelete.gamesRemoved,
      'deleting a host requires a specific warning and removes the host’s games and roster'
    );

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
