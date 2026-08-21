// Who this browser belongs to, so a player who has RSVP'd once never fills the form in again.
//
// The name and phone are kept for the site rather than for one game: most players are invited
// to the same organizer's games over and over, and the second invitation should already know
// them. Nothing here is a credential - it only saves typing and lets the game page ask the
// server "what is my status in this game". Every read and write is wrapped, because Safari in
// private mode throws on localStorage rather than returning null, and a player-facing page must
// never break over a convenience.
const STORAGE_KEY = 'inorout-player';

function defaultStorage() {
    try {
        return typeof window !== 'undefined' ? window.localStorage : null;
    } catch (error) {
        return null;
    }
}

function digitsOnly(value) {
    const digits = String(value == null ? '' : value).replace(/\D/g, '');
    return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

function prettyPhone(phone) {
    const digits = digitsOnly(phone);
    return digits.length === 10
        ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
        : String(phone == null ? '' : phone);
}

/** The first name a greeting should use, falling back to the whole value. */
function firstName(name) {
    return String(name == null ? '' : name).trim().split(/\s+/)[0] || '';
}

/**
 * @returns {{name: string, phone: string}|null} null when this browser has no usable
 * identity saved - including when storage is unavailable or holds something corrupt.
 */
function read(storage = defaultStorage()) {
    if (!storage) return null;
    try {
        const saved = JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
        if (!saved || typeof saved !== 'object') return null;
        const phone = digitsOnly(saved.phone);
        const name = String(saved.name == null ? '' : saved.name).trim();
        // A stored entry is only useful if it can identify the player to the server, and
        // ten digits is what every lookup matches on.
        if (phone.length !== 10 || !name) return null;
        return { name, phone };
    } catch (error) {
        return null;
    }
}

/**
 * Remembers the player. Ignores anything incomplete rather than saving a half-identity
 * that would prefill the form with a phone number the server will reject.
 * @returns {boolean} whether it was saved
 */
function save(identity, storage = defaultStorage()) {
    if (!storage) return false;
    const phone = digitsOnly(identity && identity.phone);
    const name = String((identity && identity.name) == null ? '' : identity.name).trim();
    if (phone.length !== 10 || !name) return false;
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify({ name, phone }));
        return true;
    } catch (error) {
        return false;
    }
}

function clear(storage = defaultStorage()) {
    if (!storage) return;
    try {
        storage.removeItem(STORAGE_KEY);
    } catch (error) {
        // Nothing to do: the page behaves as though nobody was remembered.
    }
}

export {
    STORAGE_KEY,
    digitsOnly,
    prettyPhone,
    firstName,
    read,
    save,
    clear
};
