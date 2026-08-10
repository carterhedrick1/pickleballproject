let hostPhone = '';
let loadedGames = [];

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('textMeLinks').addEventListener('click', textMeMyLinks);
    HostVerification.init({
        contentId: 'gamesBody',
        switchButtonId: 'switchNumber',
        showStatus,
        onVerified: (phone) => {
            hostPhone = phone;
            return loadGames();
        }
    });
});

function showStatus(message, type) {
    const el = document.getElementById('status');
    el.textContent = message;
    el.className = 'status ' + (type || 'info');
    el.style.display = message ? 'block' : 'none';
}

const prettyPhone = HostVerification.prettyPhone;

/** Field-by-field parse: new Date('YYYY-MM-DD') is UTC and shows the day before here. */
function formatDateForDisplay(dateStr) {
    return PageUtils.formatLocalDate(dateStr, {
        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
    });
}

function formatTime(timeStr) {
    return PageUtils.formatTime12Hour(timeStr);
}

function esc(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : text;
    return div.innerHTML;
}

async function loadGames() {
    showStatus('Loading your games...', 'info');

    try {
        // ?all=1 is the full history - without it, cancelled games disappear after a week.
        const response = await fetch(`/api/games/by-phone/${hostPhone}?all=1`, {
            headers: HostVerification.authHeaders()
        });
        if (response.status === 401) {
            HostVerification.expireSession();
            return;
        }
        if (!response.ok) throw new Error(`Server returned ${response.status}`);
        const data = await response.json();

        loadedGames = data.games || [];
        showStatus('', '');
        render();
        document.getElementById('gamesBody').style.display = 'block';
    } catch (error) {
        console.error('Error loading games:', error);
        showStatus('Could not load your games. Please try again.', 'error');
    }
}

function render() {
    document.getElementById('whichPhone').textContent = prettyPhone(hostPhone);

    const upcoming = [];
    const past = [];
    loadedGames.forEach((game) => {
        (PageUtils.belongsInPastGames(game) ? past : upcoming).push(game);
    });

    upcoming.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    past.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));

    const total = loadedGames.length;
    document.getElementById('summaryLine').textContent = total
        ? `You've hosted ${total} ${total === 1 ? 'game' : 'games'}.`
        : '';

    document.getElementById('emptyState').style.display = total ? 'none' : 'block';
    document.getElementById('upcomingHeading').style.display = upcoming.length ? 'block' : 'none';
    document.getElementById('pastWrapper').style.display = past.length ? 'block' : 'none';
    // Cancelled games land in this group too, and a cancelled game dated next Thursday
    // is not "past" to the host who just cancelled it - say the group holds both.
    document.getElementById('pastSummary').textContent = past.some((game) => game.cancelled)
        ? `Past & Cancelled Games (${past.length})`
        : `Past Games (${past.length})`;

    renderInto('upcomingList', upcoming);
    renderInto('pastList', past);
}

function renderInto(containerId, games) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    games.forEach((game) => container.appendChild(gameCard(game)));
}

function gameCard(game) {
    const card = document.createElement('div');
    card.className = 'game-item' + (game.cancelled ? ' cancelled' : '');

    // Cancellation tells the players first, so a cancelled game is safe for its host to erase
    // immediately. Active upcoming games remain protected until their scheduled start passes.
    const canDelete = PageUtils.canPermanentlyDelete(game);
    // A weekly game is retyped from scratch every week today. Offering the repeat on played and
    // cancelled games only keeps it away from the game the host is currently filling.
    const isPast = PageUtils.belongsInPastGames(game);

    const badges = [];
    if (game.cancelled) {
        badges.push(`<span class="badge cancelled">Cancelled${game.cancellationReason ? ': ' + esc(game.cancellationReason) : ''}</span>`);
    }
    badges.push(`<span class="badge">${game.playerCount} of ${game.totalPlayers} players in</span>`);
    if (game.waitlistCount) {
        badges.push(`<span class="badge">${game.waitlistCount} ${game.waitlistCount === 1 ? 'player' : 'players'} waiting</span>`);
    }
    // Whether the invitations are still outstanding is the reason a host opens a game, so the
    // answer belongs on the card rather than three taps inside it.
    if (game.invitedCount) {
        badges.push(`<span class="badge">${game.invitedCount} invited</span>`);
    }
    if (game.awaitingReplyCount) {
        badges.push(`<span class="badge waiting">${game.awaitingReplyCount} ${game.awaitingReplyCount === 1 ? 'has' : 'have'} not replied</span>`);
    }
    if (game.registrationMode === 'waitlist') {
        badges.push('<span class="badge">You pick the players</span>');
    }
    if (game.photoCount) {
        badges.push(`<span class="badge">${game.photoCount} ${game.photoCount === 1 ? 'photo' : 'photos'}</span>`);
    }

    card.innerHTML = `
        <div class="game-title">${esc(game.location)}</div>
        <div class="game-detail">${formatDateForDisplay(game.date)} at ${formatTime(game.time)}</div>
        <div class="game-badges">${badges.join('')}</div>
        <div class="card-actions">
            <a class="btn btn-primary" href="${game.managementLink}">Manage</a>
            ${isPast ? `<a class="btn" href="/create.html?repeat=${encodeURIComponent(game.gameId)}&token=${encodeURIComponent(game.hostToken)}">Run It Again</a>` : ''}
            <button type="button" class="btn" id="copyButton-${game.gameId}">Copy Invitation</button>
            <button type="button" class="btn" data-notes-toggle>Notes</button>
            ${canDelete ? '<button type="button" class="btn btn-danger" data-delete>Delete</button>' : ''}
        </div>
        <div class="notes-panel" style="display: none;">
            <textarea placeholder="e.g. Gate code 4417">${esc(game.hostNotes || '')}</textarea>
            <button type="button" class="btn" data-notes-save>Save Note</button>
            <div class="notes-status"></div>
        </div>
        ${canDelete ? `
        <div class="delete-panel" style="display: none;">
            <p>Delete this game for good? Its photos and its place in your stats go too, and there is no undo.</p>
            <button type="button" class="btn btn-danger" data-delete-confirm>Yes, Delete It</button>
            <button type="button" class="btn" data-delete-cancel>Keep It</button>
            <div class="delete-status"></div>
        </div>` : ''}
    `;

    card.querySelector(`#copyButton-${CSS.escape(game.gameId)}`)
        .addEventListener('click', () => copyInvitation(game));

    const panel = card.querySelector('.notes-panel');
    card.querySelector('[data-notes-toggle]').addEventListener('click', () => {
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });
    card.querySelector('[data-notes-save]').addEventListener('click', () => {
        saveNote(game, panel.querySelector('textarea').value, panel.querySelector('.notes-status'));
    });

    // A note already written is worth seeing without a click.
    if (game.hostNotes) panel.style.display = 'block';

    // Delete asks first, in the card rather than a browser confirm() dialog, so the
    // warning about photos and stats is actually readable before the second click.
    if (canDelete) {
        const deletePanel = card.querySelector('.delete-panel');
        const deleteStatus = card.querySelector('.delete-status');
        card.querySelector('[data-delete]').addEventListener('click', () => {
            deletePanel.style.display = 'block';
        });
        card.querySelector('[data-delete-cancel]').addEventListener('click', () => {
            deletePanel.style.display = 'none';
            deleteStatus.textContent = '';
        });
        card.querySelector('[data-delete-confirm]').addEventListener('click', (e) => {
            deleteGame(game, e.currentTarget, deleteStatus);
        });
    }

    return card;
}

async function deleteGame(game, button, statusEl) {
    button.disabled = true;
    statusEl.style.color = 'var(--text-muted)';
    statusEl.textContent = 'Deleting...';

    try {
        const response = await fetch(`/api/games/${game.gameId}/permanent`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: game.hostToken })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Server returned ${response.status}`);

        // Drop it locally rather than refetching, so the Past games section stays open.
        loadedGames = loadedGames.filter((g) => g.gameId !== game.gameId);
        render();
        showStatus('Game deleted.', 'success');
    } catch (error) {
        console.error('Error deleting game:', error);
        button.disabled = false;
        statusEl.style.color = 'var(--danger)';
        statusEl.textContent = error.message || 'Could not delete that game. Please try again.';
    }
}

function copyInvitation(game) {
    // The generator wants the game shape create.html stores, not the summary the
    // history endpoint returns, so map the fields across.
    const gameData = {
        location: game.location,
        date: game.date,
        time: game.time,
        duration: game.duration,
        totalPlayers: game.totalPlayers,
        organizerPlaying: game.organizerPlaying,
        registrationMode: game.registrationMode
    };

    if (typeof InvitationGenerator !== 'undefined' && InvitationGenerator.copyInvitationToClipboard) {
        InvitationGenerator.copyInvitationToClipboard(gameData, game.gameId, 'copyButton-' + game.gameId);
    } else {
        showStatus('Could not copy the invitation. Please try again.', 'error');
    }
}

async function saveNote(game, text, statusEl) {
    statusEl.textContent = 'Saving...';

    // The management link carries the token this needs.
    const token = new URLSearchParams(game.managementLink.split('?')[1] || '').get('token');

    try {
        const response = await fetch(`/api/games/${game.gameId}/notes`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, hostNotes: text })
        });
        if (!response.ok) throw new Error(`Server returned ${response.status}`);

        game.hostNotes = text;
        statusEl.textContent = 'Saved.';
    } catch (error) {
        console.error('Error saving note:', error);
        statusEl.textContent = 'Could not save that note.';
    }
}

async function textMeMyLinks() {
    showStatus('Sending...', 'info');
    try {
        const response = await fetch('/api/games/lookup-and-notify', {
            method: 'POST',
            headers: HostVerification.authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ phone: hostPhone, sendSms: true })
        });
        const data = await response.json();
        showStatus(
            data.gamesFound
                ? 'Sent — check your phone.'
                : 'There are no recent games to send.',
            data.gamesFound ? 'success' : 'info'
        );
    } catch (error) {
        console.error('Error sending links:', error);
        showStatus('Could not send that text. Please try again.', 'error');
    }
}
