// Current lists are a projection. outPlayers remains cancellation history in storage.
import { normalizePhone } from './invite-status.js';

function currentAttendance(game = {}) {
    game = game || {};
    const seen = new Set();
    const result = {};
    for (const group of ['players', 'waitlist', 'outPlayers']) {
        result[group] = (game[group] || []).filter((person) => {
            const phone = normalizePhone(person.phone);
            const key = phone ? `phone:${phone}` : person.id ? `id:${person.id}` : null;
            if (key && seen.has(key)) return false;
            if (key) seen.add(key);
            return true;
        });
    }
    return result;
}

export { currentAttendance };
