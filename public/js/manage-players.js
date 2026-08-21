// players features for the management page.

let hostRoster = [];
let hostRosterState = 'idle';

function normalizedPlayerPhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

function currentGamePhones() {
    return new Set([
        ...(gameData?.players || []),
        ...(gameData?.waitlist || []),
        ...(gameData?.outPlayers || [])
    ].map((player) => normalizedPlayerPhone(player.phone)).filter(Boolean));
}

function updateRosterSelectionState() {
    const button = document.getElementById('addRosterPlayersBtn');
    if (!button) return;

    const count = document.querySelectorAll(
        '#rosterPlayerList .roster-player-checkbox:checked'
    ).length;
    button.disabled = count === 0;
    button.textContent = count === 1 ? 'Add 1 Selected Player' :
        (count > 1 ? `Add ${count} Selected Players` : 'Add Selected Players');
}

function renderHostRoster() {
    // Both pickers read the same roster, and the invite one must be redrawn on every path
    // through this function - an empty roster and a failed fetch are exactly the states where
    // it would otherwise sit on "Loading your roster..." with live buttons underneath.
    try {
        renderRosterAddPicker();
    } finally {
        renderInvitePicker();
    }
}

function renderRosterAddPicker() {
    const list = document.getElementById('rosterPlayerList');
    const status = document.getElementById('rosterPickerStatus');
    const actions = document.getElementById('rosterPickerActions');
    if (!list || !status || !actions) return;

    list.innerHTML = '';
    status.classList.remove('error-text');

    if (hostRosterState === 'loading' || hostRosterState === 'idle') {
        status.textContent = 'Loading your roster...';
        actions.hidden = true;
        return;
    }

    if (hostRosterState === 'error') {
        status.textContent = 'Could not load your roster. Please refresh the page to try again.';
        status.classList.add('error-text');
        actions.hidden = true;
        return;
    }

    const listedPhones = currentGamePhones();
    const available = hostRoster.filter(
        (player) => !listedPhones.has(normalizedPlayerPhone(player.phone))
    );

    if (hostRoster.length === 0) {
        status.textContent = 'Your roster is empty. Add people on the Roster page.';
        actions.hidden = true;
        return;
    }

    if (available.length === 0) {
        status.textContent = 'Everyone on your roster is already listed for this game.';
        actions.hidden = true;
        return;
    }

    status.textContent = `${available.length} ${available.length === 1 ? 'player is' : 'players are'} available.`;
    available.forEach((player) => {
        list.appendChild(
            ManageRender.createRosterOption(document, player, updateRosterSelectionState)
        );
    });
    actions.hidden = false;
    updateRosterSelectionState();
}

async function loadHostRoster() {
    if (!gameData?.hostPhone) {
        hostRoster = [];
        hostRosterState = 'loaded';
        renderHostRoster();
        return;
    }

    if (hostRosterState === 'loaded') {
        renderHostRoster();
        return;
    }

    if (hostRosterState === 'loading') return;
    hostRosterState = 'loading';
    renderHostRoster();

    try {
        const response = await fetch(`/api/roster/${encodeURIComponent(gameData.hostPhone)}`, {
            headers: {
                'X-Game-Id': gameId,
                'X-Host-Token': hostToken
            }
        });
        if (!response.ok) throw new Error(`Server returned ${response.status}`);
        const data = await response.json();
        hostRoster = Array.isArray(data.roster) ? data.roster : [];
        hostRosterState = 'loaded';
    } catch (error) {
        console.error('Error loading host roster:', error);
        hostRosterState = 'error';
    }

    renderHostRoster();
}

// Where each person stands in this game, so a name in the picker carries its own answer and
// the host is never asked to remember who they already heard from.
const RESPONSE_BADGES = {
    confirmed: { label: 'IN', tone: 'in' },
    waitlist: { label: 'Waitlist', tone: 'waiting' },
    out: { label: 'OUT', tone: 'out' }
};

function responseByPhone() {
    const byPhone = new Map();
    const groups = [
        ['confirmed', gameData?.players],
        ['waitlist', gameData?.waitlist],
        ['out', gameData?.outPlayers]
    ];
    for (const [response, entries] of groups) {
        for (const entry of entries || []) {
            const phone = normalizedPlayerPhone(entry?.phone);
            if (phone && !byPhone.has(phone)) byPhone.set(phone, response);
        }
    }
    return byPhone;
}

function inviteRecordByPhone() {
    return new Map(
        InviteStatus.inviteStatus(gameData || {}).invited
            .map((entry) => [normalizedPlayerPhone(entry.phone), entry])
    );
}

/** The one chip that best describes somebody: their answer, or why they still owe you one. */
function inviteBadge(response, record) {
    if (response) return RESPONSE_BADGES[response];
    if (!record) return null;
    if (record.lastTextStatus === 'failed') return { label: 'Text Failed', tone: 'out' };
    return { label: 'No Reply', tone: 'muted' };
}

function renderInvitePicker() {
    const list = document.getElementById('intendedInviteeList');
    const status = document.getElementById('intendedInviteeStatus');
    if (!list || !status) return;

    // Any roster change redraws this list, and a host part-way through ticking six names must
    // not lose them because somebody joined the game in the meantime.
    const stillTicked = new Set(selectedInviteePhones().map(normalizedPlayerPhone));
    list.innerHTML = '';
    status.classList.remove('error-text');
    renderInviteAddForm();

    if (hostRosterState === 'loading' || hostRosterState === 'idle') {
        status.textContent = 'Loading your roster...';
        updateInviteSelectionState();
        return;
    }

    if (hostRosterState === 'error') {
        status.textContent = 'Could not load your roster. Please refresh the page to try again.';
        status.classList.add('error-text');
        updateInviteSelectionState();
        return;
    }

    if (!hostRoster.length) {
        status.replaceChildren(
            document.createTextNode('Your roster is empty. Add your regulars on the '),
            Object.assign(document.createElement('a'), {
                href: '/roster.html',
                textContent: 'Roster page'
            }),
            document.createTextNode('.')
        );
        updateInviteSelectionState();
        return;
    }

    // Whoever still needs asking comes first; people who already answered sink to the bottom
    // where they stay visible without being in the way.
    const responses = responseByPhone();
    const records = inviteRecordByPhone();
    const rank = (player) => {
        const phone = normalizedPlayerPhone(player.phone);
        if (responses.has(phone)) return 2;
        return records.has(phone) ? 1 : 0;
    };
    const ordered = hostRoster.map((player, index) => ({ player, index }))
        .sort((a, b) => rank(a.player) - rank(b.player) || a.index - b.index)
        .map((entry) => entry.player);

    ordered.forEach((player) => {
        const phone = normalizedPlayerPhone(player.phone);
        const record = records.get(phone);
        const meta = [];
        if (record && !responses.has(phone)) {
            const ago = PageUtils.formatTimeAgo(record.lastTextedAt);
            if (ago) meta.push(record.textCount > 1 ? `texted ${record.textCount}×, last ${ago}` : `texted ${ago}`);
        }
        const option = ManageRender.createRosterOption(
            document,
            player,
            updateInviteSelectionState,
            { badge: inviteBadge(responses.get(phone), record), meta }
        );
        if (stillTicked.has(phone)) option.querySelector('input').checked = true;
        list.appendChild(option);
    });

    status.textContent = `${hostRoster.length} ${hostRoster.length === 1 ? 'person' : 'people'} on your roster.`;
    updateInviteSelectionState();
    updateInviteOverflowHint();
}

// Says out loud how many people are below the fold of the checklist, and keeps saying it as the
// host scrolls. Reads the live geometry rather than the roster length, so it stays right on a
// phone (where the list is uncapped and this never shows) and after a window resize.
function updateInviteOverflowHint() {
    const list = document.getElementById('intendedInviteeList');
    const fade = document.getElementById('intendedInviteeFade');
    const more = document.getElementById('intendedInviteeMore');
    if (!list || !fade || !more) return;

    // Measured against the list's own box rather than offsetTop, which is relative to the
    // positioned wrapper and would be off by the list's top margin.
    const visibleBottom = list.getBoundingClientRect().bottom;
    const options = [...list.querySelectorAll('.roster-player-option')];
    // A row counts as below the fold once more than a sliver of it is out of sight.
    const below = options.filter(
        (option) => option.getBoundingClientRect().top + 12 > visibleBottom
    ).length;

    fade.hidden = below === 0;
    more.hidden = below === 0;
    if (below) more.textContent = `${below} More Below — Scroll The List`;
}

function selectedInviteePhones() {
    return Array.from(document.querySelectorAll(
        '#intendedInviteeList .roster-player-checkbox:checked'
    )).map((input) => input.dataset.phone).filter(Boolean);
}

// The count belongs on the button itself: it confirms the selection at the moment of the tap,
// which is the question a host actually has before sending.
function updateInviteSelectionState() {
    const button = document.getElementById('textInvitations');
    if (!button) return;
    const count = selectedInviteePhones().length;
    button.disabled = count === 0;
    button.textContent = count === 0
        ? 'Text The Invitation'
        : `Text The Invitation (${count})`;
}

function clearInviteSelection() {
    document.querySelectorAll('#intendedInviteeList .roster-player-checkbox:checked')
        .forEach((input) => { input.checked = false; });
    updateInviteSelectionState();
}

// A texted invitation is the only invite path the app can actually vouch for, so the send
// records itself against the game and the roster below updates from the response.
async function textInvitations(phones, { confirmTitle, confirmQuestion } = {}) {
    if (!CentralTime.getGameStatus(gameData).canEdit) {
        showStatus('This game has ended, so invitations can no longer be sent.', 'error');
        return;
    }

    const playerPhones = phones && phones.length ? phones : selectedInviteePhones();
    if (playerPhones.length === 0) {
        showStatus('Tick at least one person to invite.', 'error');
        return;
    }

    const people = `${playerPhones.length} ${playerPhones.length === 1 ? 'person' : 'people'}`;
    showConfirmModal(
        confirmTitle || 'Text The Invitation',
        confirmQuestion || `Text the invitation to ${people} now?`,
        async () => {
            const sendStartedAt = Date.now();
            try {
                showStatus(`Texting the invitation to ${people}...`, 'info');
                const response = await fetch(`/api/games/${gameId}/invitations`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token: hostToken, playerPhones })
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(data.error || 'Could not send the invitations');

                gameData.invitedPlayers = data.invitedPlayers || gameData.invitedPlayers;
                clearInviteSelection();
                renderInvitePicker();
                renderInvitations();

                const sentText = `Invitation texted to ${data.sentCount} ${data.sentCount === 1 ? 'person' : 'people'}`;
                showStatus(
                    data.failedCount
                        ? `${sentText}. ${data.failedCount} did not go through.`
                        : `${sentText}.`,
                    data.failedCount ? 'error' : 'success'
                );
            } catch (error) {
                console.error('Error texting invitations:', error);
                const recovered = await recoverInvitationSend(playerPhones, sendStartedAt);
                if (recovered) {
                    gameData.invitedPlayers = recovered.invitedPlayers;
                    clearInviteSelection();
                    renderInvitePicker();
                    renderInvitations();
                    const sentText = `Invitation texted to ${recovered.sentCount} ${recovered.sentCount === 1 ? 'person' : 'people'}`;
                    showStatus(
                        recovered.failedCount
                            ? `${sentText}. ${recovered.failedCount} did not go through.`
                            : `${sentText}.`,
                        recovered.failedCount ? 'error' : 'success'
                    );
                    return;
                }
                const detail = /load failed|failed to fetch|network/i.test(error.message)
                    ? 'The connection ended before the server answered. Check Who You Invited before trying again.'
                    : error.message;
                showStatus('Could not send the invitations: ' + detail, 'error');
            }
        },
        { destructive: false, confirmLabel: 'Send It' }
    );
}

// Safari reports a dropped response as "Load failed" even when the server finished the work.
// Read the host-only game back before claiming failure. This never retries a text, so recovering
// the answer cannot accidentally send somebody the same invitation twice.
async function recoverInvitationSend(phones, sendStartedAt) {
    const wanted = new Set(phones.map(normalizedPlayerPhone));
    const earliest = sendStartedAt - 5000;
    const retryDelays = [0, 500, 1500];

    for (const delay of retryDelays) {
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        try {
            const response = await fetch(`/api/games/${gameId}`, { headers: hostAuthHeaders() });
            if (!response.ok) continue;
            const latestGame = await response.json();
            const recent = (latestGame.invitedPlayers || []).filter((person) =>
                wanted.has(normalizedPlayerPhone(person.phone)) &&
                Number.isFinite(Date.parse(person.lastTextedAt)) &&
                Date.parse(person.lastTextedAt) >= earliest
            );
            const matched = new Set(recent.map((person) => normalizedPlayerPhone(person.phone)));
            if (matched.size !== wanted.size) continue;

            return {
                invitedPlayers: latestGame.invitedPlayers,
                sentCount: recent.filter((person) => person.lastTextStatus === 'sent').length,
                failedCount: recent.filter((person) => person.lastTextStatus !== 'sent').length
            };
        } catch (recoveryError) {
            console.warn('Could not check whether the invitation send finished:', recoveryError);
        }
    }
    return null;
}

// invitedPlayers has been stored for a long time without ever being compared against who
// actually replied. This is that comparison, on the page where a host can act on it: everyone
// who was asked, what they said, and who still owes an answer.
function renderInvitations() {
    const list = document.getElementById('invitedList');
    const summary = document.getElementById('inviteSummary');
    const nudgeAll = document.getElementById('nudgeNonResponders');
    if (!list || !summary || !nudgeAll) return;

    const { invited, responded, nonResponders, counts } = InviteStatus.inviteStatus(gameData || {});
    list.innerHTML = '';

    if (invited.length === 0) {
        summary.textContent = 'Nobody has been invited yet.';
        nudgeAll.hidden = true;
        return;
    }

    const parts = [`${counts.invited} invited`];
    if (counts.confirmed) parts.push(`${counts.confirmed} in`);
    if (counts.waitlist) parts.push(`${counts.waitlist} waiting`);
    if (counts.out) parts.push(`${counts.out} out`);
    parts.push(counts.noReply ? `${counts.noReply} no reply` : 'everyone replied');
    summary.textContent = parts.join(' · ');

    // A failed text is the one row a host has to do something about, so it sorts to the top;
    // then everybody still silent, then the answers.
    const ordered = [
        ...nonResponders.filter((person) => person.lastTextStatus === 'failed'),
        ...nonResponders.filter((person) => person.lastTextStatus !== 'failed'),
        ...responded
    ];

    ordered.forEach((person) => {
        const meta = [];
        if (person.lastTextedAt) {
            const ago = PageUtils.formatTimeAgo(person.lastTextedAt);
            meta.push(person.textCount > 1
                ? `Texted ${person.textCount} times, last ${ago}`
                : `Texted ${ago}`);
        } else {
            meta.push('Invitation copied');
        }
        if (person.lastTextStatus === 'failed') meta.push('The last text did not go through');

        list.appendChild(ManageRender.createPlayerItem(document, person, {
            meta,
            badge: inviteBadge(person.response, person),
            actions: person.response ? [] : [
                {
                    label: 'Text Again',
                    className: 'btn-secondary',
                    onClick: () => textInvitations([person.phone], {
                        confirmTitle: 'Text Again',
                        confirmQuestion: `Send ${person.name || person.phone} the invitation again?`
                    })
                }
            ]
        }));
    });

    nudgeAll.hidden = nonResponders.length === 0;
    nudgeAll.textContent = nonResponders.length === 1
        ? 'Text The One Person Waiting'
        : `Text All ${nonResponders.length} Waiting`;
}

// Copying the invitation is the one path the app cannot verify, so the people ticked at that
// moment are recorded as invited without any delivery history. The list is replaced wholesale
// by this endpoint, so it has to be sent as the union with everyone already on it.
async function recordCopiedInvitees() {
    const ticked = selectedInviteePhones();
    if (!ticked.length) return;

    const existing = (gameData?.invitedPlayers || []).map((player) => player.phone);
    const playerPhones = [...new Set([...existing, ...ticked])];

    try {
        const response = await fetch(`/api/games/${gameId}/invitees`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: hostToken, playerPhones })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Could not record who you invited');
        gameData.invitedPlayers = data.intendedInvitees || [];
        clearInviteSelection();
        renderInvitePicker();
        renderInvitations();
    } catch (error) {
        console.error('Could not record the copied invitees:', error);
        showStatus(`Invitation copied, but ${error.message.toLowerCase()}.`, 'error');
    }
}

// Adding to the saved roster needs the verified phone session, which the management link alone
// does not grant: a game token that could write roster rows would also be a game token that
// could text any number in the world through the invitation route.
function hasVerifiedHostSession() {
    const phone = localStorage.getItem('hostPhone') || '';
    const token = localStorage.getItem('hostVerificationToken') || '';
    return Boolean(token) && normalizedPlayerPhone(phone) === normalizedPlayerPhone(gameData?.hostPhone);
}

function renderInviteAddForm() {
    const form = document.getElementById('inviteAddNew');
    if (!form) return;
    form.hidden = !(hostRosterState === 'loaded' && hasVerifiedHostSession());
}

async function addPersonToRoster() {
    const nameInput = document.getElementById('inviteNewName');
    const phoneInput = document.getElementById('inviteNewPhone');
    const status = document.getElementById('inviteAddStatus');
    const button = document.getElementById('inviteAddPerson');
    const name = nameInput.value.trim();
    const phone = normalizedPlayerPhone(phoneInput.value);

    status.classList.remove('error-text');
    if (!name || phone.length !== 10) {
        status.textContent = 'Enter a name and a 10-digit phone number.';
        status.classList.add('error-text');
        return;
    }
    if (hostRoster.some((player) => normalizedPlayerPhone(player.phone) === phone)) {
        status.textContent = `${name} is already on your roster.`;
        status.classList.add('error-text');
        return;
    }

    button.disabled = true;
    status.textContent = 'Adding...';
    try {
        const response = await fetch(
            `/api/roster/${encodeURIComponent(gameData.hostPhone)}/${encodeURIComponent(phone)}`,
            {
                method: 'PUT',
                headers: HostVerification.authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ name })
            }
        );
        const data = await response.json().catch(() => ({}));
        if (response.status === 401) {
            throw new Error('Your verified session expired. Add them on the Roster page.');
        }
        if (!response.ok) throw new Error(data.error || 'Could not add that person');

        hostRoster.push({ phone, name, duprId: '', duprRating: null, gamesCount: 0 });
        hostRoster.sort((a, b) => (a.name || a.phone)
            .localeCompare(b.name || b.phone, undefined, { sensitivity: 'base' }));
        nameInput.value = '';
        phoneInput.value = '';
        status.textContent = `${name} added.`;
        renderHostRoster();
        // Ticked straight away: adding somebody here is only ever a prelude to inviting them.
        const added = document.querySelector(
            `#intendedInviteeList .roster-player-checkbox[data-phone="${CSS.escape(phone)}"]`
        );
        if (added) {
            added.checked = true;
            updateInviteSelectionState();
        }
    } catch (error) {
        status.textContent = error.message;
        status.classList.add('error-text');
    } finally {
        button.disabled = false;
    }
}

async function postHostPlayer(player, addTo) {
    const response = await fetch(`/api/games/${gameId}/manual-player`, {
        method: 'POST',
        headers: hostAuthHeaders({
            'Content-Type': 'application/json'
        }),
        body: JSON.stringify({
            name: player.name,
            phone: player.phone,
            addTo,
            token: hostToken
        })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || 'Failed to add player');
    }
    return data;
}

async function addPlayersFromRoster() {
    if (!CentralTime.getGameStatus(gameData).canEdit) {
        showStatus('This game has ended, so players can no longer be added.', 'error');
        return;
    }

    const selectedPhones = new Set(
        [...document.querySelectorAll('#rosterPlayerList .roster-player-checkbox:checked')]
            .map((input) => normalizedPlayerPhone(input.dataset.phone))
    );
    const selectedPlayers = hostRoster.filter(
        (player) => selectedPhones.has(normalizedPlayerPhone(player.phone))
    );

    if (selectedPlayers.length === 0) {
        showStatus('Please select at least one player to add.', 'error');
        return;
    }

    const addTo = document.querySelector('input[name="rosterAddTo"]:checked').value;
    const button = document.getElementById('addRosterPlayersBtn');
    button.disabled = true;
    showStatus(
        `Adding ${selectedPlayers.length} roster ${selectedPlayers.length === 1 ? 'player' : 'players'}...`,
        'info'
    );

    const added = [];
    const failed = [];
    let smsFailures = 0;

    for (const player of selectedPlayers) {
        try {
            const result = await postHostPlayer(player, addTo);
            added.push(player);
            if (player.phone && result.sms && !result.sms.success) smsFailures += 1;
        } catch (error) {
            failed.push({ player, message: error.message });
        }
    }

    await fetchGameData();

    const addedText = `${added.length} roster ${added.length === 1 ? 'player' : 'players'} added`;
    if (failed.length) {
        const failedNames = failed.map(({ player }) => player.name || player.phone).join(', ');
        showStatus(
            `${added.length ? `${addedText}. ` : ''}Could not add ${failedNames}.`,
            'error'
        );
        return;
    }

    const smsText = smsFailures
        ? ` (${smsFailures} SMS ${smsFailures === 1 ? 'notification' : 'notifications'} failed)`
        : '';
    showStatus(`${addedText} successfully${smsText}.`, smsFailures ? 'error' : 'success');
}

// joinedAt and promotedAt have always been stored; until now only the stats page read them.
function confirmedPlayerMeta(player) {
    const meta = [];
    const signedUp = PageUtils.formatTimeAgo(player.joinedAt);
    if (signedUp) {
        meta.push(signedUp === 'just now' ? 'Signed up just now' : `Signed up ${signedUp}`);
    }
    const promoted = PageUtils.formatTimeAgo(player.promotedAt);
    if (promoted) {
        meta.push(promoted === 'just now'
            ? 'Promoted from the waitlist just now'
            : `Promoted from the waitlist ${promoted}`);
    }
    return meta;
}

function updatePlayerLists() {
    const confirmedPlayers = document.getElementById('confirmedPlayers');
    const waitlistPlayers = document.getElementById('waitlistPlayers');
    const outPlayersContainer = document.getElementById('outPlayers'); // Add this line
    const playerCount = document.getElementById('playerCount');
    const totalPlayers = document.getElementById('totalPlayers');
    const waitlistCount = document.getElementById('waitlistCount');
    
    // Clear existing lists - MAKE SURE TO CLEAR OUT PLAYERS TOO
    confirmedPlayers.innerHTML = '';
    waitlistPlayers.innerHTML = '';
    outPlayersContainer.innerHTML = ''; // Add this line to clear out players
    
    // Update counts
    playerCount.textContent = gameData.players.length;
    totalPlayers.textContent = gameData.totalPlayers;
    waitlistCount.textContent = gameData.waitlist.length;

    // Add this new code for dynamic text:
    const playerCountElement = document.querySelector('.player-section.confirmed .player-count');
    if (playerCountElement) {
        const count = gameData.players.length;
        const total = gameData.totalPlayers;
        // "1/4 player" reads as a fraction of a person - the unit follows the capacity.
        const playerText = total === 1 ? 'player' : 'players';
        playerCountElement.innerHTML = `<span id="playerCount">${count}</span>/<span id="totalPlayers">${total}</span> ${playerText}`;
    }

    const waitlistCountElement = document.querySelector('.player-section.waitlist .player-count');
    if (waitlistCountElement) {
        const count = gameData.waitlist.length;
        const playerText = count === 1 ? 'player' : 'players';
        waitlistCountElement.innerHTML = `<span id="waitlistCount">${count}</span> ${playerText} waiting`;
    }

    const outCount = document.getElementById('outCount');
    if (outCount) {
        const count = (gameData.outPlayers || []).length;
        const outCountElement = document.querySelector('.player-section.out-players .player-count');
        if (outCountElement) {
            const playerText = count === 1 ? 'player' : 'players';
            outCountElement.innerHTML = `<span id="outCount">${count}</span> ${playerText} can't make it`;
        }
    }
    
    // Populate confirmed players
    if (gameData.players.length === 0) {
        confirmedPlayers.innerHTML = '<p style="text-align: center; color: var(--text-muted); font-style: italic;">No players yet</p>';
    } else {
        gameData.players.forEach((player) => {
            // The organizer's seat is held by organizerPlaying, which nothing on this page can
            // switch off, so offering Remove or To Waitlist here only leads to a game that is
            // permanently one player short.
            const actions = player.isOrganizer ? [] : [
                {
                    label: 'To Waitlist',
                    className: 'btn-secondary',
                    onClick: () => moveToWaitlist(player.id)
                },
                {
                    label: 'Remove',
                    className: 'btn-danger',
                    onClick: () => removePlayer(player.id)
                }
            ];
            confirmedPlayers.appendChild(ManageRender.createPlayerItem(document, player, {
                meta: player.isOrganizer
                    ? ['You are hosting this game']
                    : confirmedPlayerMeta(player),
                actions
            }));
        });
    }
    
    // Populate waitlist
    if (gameData.waitlist.length === 0) {
        waitlistPlayers.innerHTML = '<p style="text-align: center; color: var(--text-muted); font-style: italic;">Nobody waiting</p>';
    } else {
        gameData.waitlist.forEach((player, index) => {
            const waiting = PageUtils.formatDuration(player.joinedAt);
            waitlistPlayers.appendChild(ManageRender.createPlayerItem(document, player, {
                meta: [
                    `Position: #${index + 1}`,
                    // Who has been waiting longest is the whole reason a host reads this list.
                    waiting && (waiting === 'just now'
                        ? 'Joined the waitlist just now'
                        : `Waiting ${waiting}`)
                ].filter(Boolean),
                actions: [
                    {
                        label: 'Promote',
                        className: 'btn-secondary',
                        onClick: () => promoteToGame(player.id)
                    },
                    {
                        label: 'Remove',
                        className: 'btn-danger',
                        onClick: () => removeWaitlisted(player.id)
                    }
                ]
            }));
        });
    }

    // Populate out players - FIXED VERSION
    if (!gameData.outPlayers || gameData.outPlayers.length === 0) {
        outPlayersContainer.innerHTML = '<p style="text-align: center; color: var(--text-muted); font-style: italic;">Nobody marked as out</p>';
    } else {
        gameData.outPlayers.forEach((player) => {
            outPlayersContainer.appendChild(
                ManageRender.createPlayerItem(document, player, {
                    actions: [
                        {
                            label: 'Add Back',
                            className: 'btn-secondary',
                            onClick: () => addOutPlayerBackToGame(player.id)
                        },
                        {
                            label: 'Clear',
                            className: 'btn-danger',
                            onClick: () => removeOutPlayer(player.id)
                        }
                    ]
                })
            );
        });
    }
    
    // Update player checkboxes for messaging
    updatePlayerCheckboxes();

    // The header counts come from the same roster, so they refresh together.
    updateGameSummary();

    // A reply moves somebody from "no reply" to their answer, so this recomputes with the
    // roster - and the picker's chips come from the same comparison.
    renderInvitations();
    renderInvitePicker();
}

async function addPlayerManually() {
    if (!CentralTime.getGameStatus(gameData).canEdit) {
        showStatus('This game has ended, so players can no longer be added.', 'error');
        return;
    }
    
    try {
        const name = document.getElementById('playerName').value;
        const phone = document.getElementById('playerPhone').value;
        const addTo = document.querySelector('input[name="addTo"]:checked').value;
        
        showStatus('Adding player...', 'info');

        const data = await postHostPlayer({ name, phone }, addTo);
        console.log('Player added manually:', data);
        
        // Reset form
        document.getElementById('playerName').value = '';
        document.getElementById('playerPhone').value = '';
        
        // Refresh game data
        await fetchGameData();
        
        // Build status message
        let statusMessage = `${name} added`;
        
        // Add SMS status info
        if (phone && data.sms && data.sms.success) {
            statusMessage += ' and notified via SMS';
        } else if (phone && data.sms && !data.sms.success) {
            statusMessage += ' (SMS notification failed)';
        } else if (!phone) {
            statusMessage += ' — they will not get texts';
        }
        
        showStatus(statusMessage, 'success');
        
    } catch (error) {
        console.error('Error adding player:', error);
        showStatus('Error adding player: ' + error.message, 'error');
    }
}

async function moveToWaitlist(playerId) {
  try {
    showStatus('Moving player to waitlist...', 'info');
    
    // First find the player in the game data
    const player = gameData.players.find(p => p.id === playerId);
    if (!player) {
      throw new Error('Player not found');
    }
    
    // Use new dedicated endpoint
    const response = await fetch(`/api/games/${gameId}/move-to-waitlist/${playerId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        token: hostToken
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to move player to waitlist');
    }
    
    const data = await response.json();
    console.log('Player moved to waitlist:', data);
    
    // Refresh game data
    await fetchGameData();
    
    // Show status with SMS info
    let statusMessage = `${player.name} moved to waitlist`;
    if (data.sms && data.sms.success) {
      statusMessage += ' and notified via SMS';
    } else if (data.sms && !data.sms.success) {
      statusMessage += ' (SMS notification failed)';
    }
    
    showStatus(statusMessage, 'success');
    
  } catch (error) {
    console.error('Error moving player:', error);
    showStatus('Error moving player: ' + error.message, 'error');
  }
}

async function promoteToGame(playerId) {
  try {
    // Check if game is full before promoting
    if (gameData.players.length >= parseInt(gameData.totalPlayers)) {
      showStatus('Cannot promote: Game is already full', 'error');
      return;
    }
    
    showStatus('Promoting player to game...', 'info');
    
    // First find the player in the waitlist
    const player = gameData.waitlist.find(p => p.id === playerId);
    if (!player) {
      throw new Error('Player not found in waitlist');
    }
    
    // Use new dedicated endpoint
    const response = await fetch(`/api/games/${gameId}/promote-from-waitlist/${playerId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        token: hostToken
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to promote player');
    }
    
    const data = await response.json();
    console.log('Player promoted:', data);
    
    // Refresh game data
    await fetchGameData();
    
    // Show status with SMS info
    let statusMessage = `${player.name} promoted to confirmed players`;
    if (data.sms && data.sms.success) {
      statusMessage += ' and notified via SMS';
    } else if (data.sms && !data.sms.success) {
      statusMessage += ' (SMS notification failed)';
    }
    
    showStatus(statusMessage, 'success');
    
  } catch (error) {
    console.error('Error promoting player:', error);
    showStatus('Error promoting player: ' + error.message, 'error');
    
    // Refresh to ensure UI is consistent
    await fetchGameData();
  }
}

async function removePlayer(playerId) {
  try {
    // First find the player in the game data
    const player = gameData.players.find(p => p.id === playerId);
    if (!player) {
      throw new Error('Player not found');
    }
    
    showConfirmModal(
      'Remove Player', 
      `Are you sure you want to remove ${player.name} from the game?`, 
      async () => {
        try {
          showStatus('Removing player...', 'info');
          
          const response = await fetch(`/api/games/${gameId}/players/${playerId}`, {
            method: 'DELETE',
            headers: hostAuthHeaders()
          });
          
          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to remove player');
          }
          
          const data = await response.json();
          console.log('Player removal response:', data);
          
          // Refresh game data
          await fetchGameData();
          
          // Build status message
          let statusMessage = `${player.name} removed from game`;
          
          // Add SMS status info
          if (data.removalSms && data.removalSms.success) {
            statusMessage += ', player notified via SMS';
          } else if (data.removalSms && !data.removalSms.success) {
            statusMessage += ' (SMS notification to removed player failed)';
          }
          
          // Add promotion info if someone was promoted
          if (data.promotedPlayer) {
            statusMessage += `. ${data.promotedPlayer.name} promoted from waitlist`;
            if (data.promotionSms && data.promotionSms.success) {
              statusMessage += ' and notified via SMS';
            } else if (data.promotionSms && !data.promotionSms.success) {
              statusMessage += ' (promotion SMS failed)';
            }
          }
          
          showStatus(statusMessage, 'success');
          
        } catch (error) {
          console.error('Error removing player:', error);
          showStatus('Error removing player: ' + error.message, 'error');
        }
      }
    );
    
  } catch (error) {
    console.error('Error removing player:', error);
    showStatus('Error removing player: ' + error.message, 'error');
  }
}

async function removeWaitlisted(playerId) {
  try {
    // First find the player in the waitlist
    const player = gameData.waitlist.find(p => p.id === playerId);
    if (!player) {
      throw new Error('Player not found in waitlist');
    }
    
    showConfirmModal(
      'Remove From Waitlist',
      `Are you sure you want to remove ${player.name} from the waitlist?`, 
      async () => {
        try {
          showStatus('Removing from waitlist...', 'info');
          
          const response = await fetch(`/api/games/${gameId}/players/${playerId}`, {
            method: 'DELETE',
            headers: hostAuthHeaders()
          });
          
          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to remove from waitlist');
          }
          
          const data = await response.json();
          console.log('Waitlist removal response:', data);
          
          // Refresh game data
          await fetchGameData();
          
          // Build status message
          let statusMessage = `${player.name} removed from waitlist`;
          
          // Add SMS status info if applicable
          if (data.removalSms && data.removalSms.success) {
            statusMessage += ', player notified via SMS';
          } else if (data.removalSms && !data.removalSms.success) {
            statusMessage += ' (SMS notification failed)';
          }
          
          showStatus(statusMessage, 'success');
          
        } catch (error) {
          console.error('Error removing from waitlist:', error);
          showStatus('Error removing from waitlist: ' + error.message, 'error');
        }
      }
    );
    
  } catch (error) {
    console.error('Error removing from waitlist:', error);
    showStatus('Error removing from waitlist: ' + error.message, 'error');
  }
}

// Somebody who said OUT and then found a sitter is the most common roster change there is, and
// until now the only way back in was for the host to retype their name and number by hand.
async function addOutPlayerBackToGame(playerId) {
  if (!CentralTime.getGameStatus(gameData).canEdit) {
    showStatus('This game has ended, so players can no longer be added.', 'error');
    return;
  }

  const player = (gameData.outPlayers || []).find((entry) => entry.id === playerId);
  if (!player) {
    showStatus('That player is no longer on the "out" list.', 'error');
    return;
  }

  const gameIsFull = gameData.players.length >= parseInt(gameData.totalPlayers, 10);
  const destination = gameIsFull ? 'waitlist' : 'add';
  const destinationLabel = gameIsFull ? 'the waitlist' : 'the confirmed players';

  showConfirmModal(
    'Add Player Back',
    `Add ${player.name} back to ${destinationLabel}?`,
    async () => {
      try {
        showStatus('Adding player back...', 'info');
        const data = await postHostPlayer({ name: player.name, phone: player.phone }, destination);

        // Clearing the "out" entry second means a failure above leaves the roster untouched
        // rather than dropping the player off both lists.
        await fetch(`/api/games/${gameId}/out-players/${playerId}`, {
          method: 'DELETE',
          headers: hostAuthHeaders()
        });

        await fetchGameData();

        let statusMessage = `${player.name} added back to ${destinationLabel}`;
        if (player.phone && data.sms && data.sms.success) {
          statusMessage += ' and notified by text.';
        } else if (player.phone && data.sms && !data.sms.success) {
          statusMessage += ', but the text did not go out.';
        } else {
          statusMessage += '.';
        }
        showStatus(statusMessage, 'success');
      } catch (error) {
        console.error('Error adding out player back:', error);
        showStatus('Could not add that player back: ' + error.message, 'error');
      }
    },
    { destructive: false, confirmLabel: 'Add Them Back' }
  );
}

async function removeOutPlayer(playerId) {
  try {
    const player = (gameData.outPlayers || []).find((entry) => entry.id === playerId);
    showConfirmModal(
      'Remove Player',
      `Remove ${player ? player.name : 'this player'} from the "out" list?`,
      async () => {
        try {
          showStatus('Removing player...', 'info');
          
          const response = await fetch(`/api/games/${gameId}/out-players/${playerId}`, {
            method: 'DELETE',
            headers: hostAuthHeaders()
          });
          
          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to remove player');
          }
          
          // Refresh game data
          await fetchGameData();
          
          showStatus('Player removed from the "out" list.', 'success');
          
        } catch (error) {
          console.error('Error removing out player:', error);
          showStatus('Error removing player: ' + error.message, 'error');
        }
      }
    );
  } catch (error) {
    console.error('Error removing out player:', error);
    showStatus('Error removing player: ' + error.message, 'error');
  }
}



window.ManageApp.players = {

    updatePlayerLists,
    loadHostRoster,
    textInvitations,
    recoverInvitationSend,
    renderInvitations,
    renderInvitePicker,
    updateInviteOverflowHint,
    recordCopiedInvitees,
    addPersonToRoster,
    addPlayersFromRoster,
    addPlayerManually,
    moveToWaitlist,
    promoteToGame,
    removePlayer,
    removeWaitlisted,
    removeOutPlayer,
    addOutPlayerBackToGame

};
