// Who was invited, and who has actually said something back.
//
// invitedPlayers has been stored on games for a while, but nothing ever compared it against the
// roster, so "three people never replied" was a question the app could not answer. The diff
// lives here rather than in the page so the management screen and stats.js agree on it.
(function attachInviteStatus(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.InviteStatus = api;
})(typeof window !== 'undefined' ? window : globalThis, function buildInviteStatus() {
    function normalizePhone(value) {
        const digits = String(value == null ? '' : value).replace(/\D/g, '');
        return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    }

    function respondedPhones(game) {
        const responded = new Map();
        const groups = [
            ['confirmed', game && game.players],
            ['waitlist', game && game.waitlist],
            ['out', game && game.outPlayers]
        ];
        for (const [status, entries] of groups) {
            for (const entry of entries || []) {
                const phone = normalizePhone(entry && entry.phone);
                // First list wins, matching how the roster itself reads: someone who cancelled
                // and re-joined is confirmed, not out.
                if (phone && !responded.has(phone)) responded.set(phone, status);
            }
        }
        return responded;
    }

    /**
     * @param {object} game a full game, including invitedPlayers
     * @returns {{invited: object[], responded: object[], nonResponders: object[], texted: number}}
     */
    function inviteStatus(game) {
        const responded = respondedPhones(game);
        const invited = [];
        const answered = [];
        const nonResponders = [];
        let texted = 0;

        const seen = new Set();
        for (const invitee of (game && game.invitedPlayers) || []) {
            const phone = normalizePhone(invitee && invitee.phone);
            if (!phone || seen.has(phone)) continue;
            seen.add(phone);

            const entry = {
                phone: invitee.phone,
                name: invitee.name || '',
                invitedAt: invitee.invitedAt || null,
                lastTextedAt: invitee.lastTextedAt || null,
                textCount: invitee.textCount || 0,
                lastTextStatus: invitee.lastTextStatus || null,
                response: responded.get(phone) || null
            };
            invited.push(entry);
            if (entry.textCount > 0) texted += 1;
            (entry.response ? answered : nonResponders).push(entry);
        }

        return { invited, responded: answered, nonResponders, texted };
    }

    return { normalizePhone, inviteStatus };
});
