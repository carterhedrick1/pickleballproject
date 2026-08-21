// The management page's one entry point.
//
// manage.html used to load five scripts whose order mattered: manage-scripts.js had to come
// first because it declared the shared values and the helpers the others called, and each file
// ended by hanging its own functions off a window.ManageApp object. Any reordering of those
// tags broke the page in a way nothing would catch until a host clicked the wrong button.
//
// Now the page loads this one module, the imports below decide the order, and boot() is the
// only start-up sequence - the two DOMContentLoaded blocks that used to race each other at the
// bottom of manage-scripts.js are gone.
import * as state from './state.js';
import * as game from './game.js';
import * as players from './players.js';
import * as communications from './communications.js';
import * as media from './media.js';

/**
 * The page's public face.
 *
 * Modules do not create globals, and two things outside this directory reach for these
 * functions by name: manage.html's own inline handlers for the tab strip, and the browser
 * smoke, which drives the roster and recipient list directly (scripts/refactor-browser-smoke.js
 * calls ManageApp.players.updatePlayerLists and ManageApp.communications.getSelectedRecipients).
 * So the namespace stays, assembled in one place rather than in four.
 */
window.ManageApp = {
    state: {
        get gameData() { return state.gameData; },
        get gameId() { return state.gameId; },
        get hostToken() { return state.hostToken; }
    },
    core: {
        fetchGameData: game.fetchGameData,
        updateGameDetails: game.updateGameDetails,
        showStatus: game.showStatus,
        openTab: game.openTab,
        openTabFromSelect: game.openTabFromSelect,
        toggleCollapsible: game.toggleCollapsible,
        closeModal: game.closeModal,
        copyToClipboard: game.copyToClipboard
    },
    players,
    communications,
    media
};

function boot() {
    // The host token comes out of the URL once and is then kept out of it, so copying the
    // address bar can no longer hand control of the game to whoever the URL is pasted to.
    const { gameId, hostToken } = state.readGameFromUrl();

    if (!gameId || !hostToken) {
        game.showUnauthorized();
        return;
    }

    game.fetchGameData();

    // Loaded once rather than with every roster refresh: the log is a look-back, and it has its
    // own Refresh button for the "I never got the reminder" conversation.
    communications.loadDeliveryLog();

    game.setupEventListeners();

    media.setupPhotos();
    media.setupCourtImages();

    // Restore the active tab after everything is loaded.
    setTimeout(game.restoreActiveTab, 100);
    game.styleGroupCheckboxesAfterLoad();
}

// A module script is deferred, so the document is already parsed by the time this runs - but
// not necessarily fired DOMContentLoaded yet, which is why this still waits for it rather than
// calling boot() outright.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
