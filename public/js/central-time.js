// The one Central Time model, shared by the server and every page.
//
// A game is stored as a Central Time wall clock - "2026-08-11" plus "18:00" - because that is
// what a host types and what a player reads. Deciding whether that game has started, ended or
// is still upcoming means turning the wall clock into a real instant, and the app used to do
// it five different ways:
//
//   1. utils/central-time.js shifted "now" into a Date whose *local* fields read as Central and
//      compared it against a naive parse of the game's wall clock. Both sides sat in the same
//      invented frame, so it gave the right answer while never naming a real instant.
//   2. public/js/game-utils.js worked out the -05:00/-06:00 offset from hand-written US DST
//      rules. Those rules are right until Congress changes them, they decide by date alone (so
//      the hour a clock actually moves is wrong), and adding a duration to the start hour
//      produced strings like "25:30:00", which parse as Invalid Date - a game ending after
//      midnight was therefore never expired.
//   3. getTimeUntilGame built the game time in the *browser's* timezone, so a player in New
//      York was told a game was an hour further away than it was.
//   4. Assorted `new Date(game.date)` parses, which read a bare YYYY-MM-DD as UTC midnight.
//   5. utils/calendar-invite.js, which was already correct - it asks Intl for the offset that
//      America/Chicago really had at that moment. That is the model kept here, and the .ics
//      builder now shares it rather than keeping its own copy.
//
// Everything below is built on wallClockToInstant. Nothing here does offset arithmetic by hand,
// so a change to the DST rules arrives with the platform's timezone data instead of a patch.
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.CentralTime = api;
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const CENTRAL_TIME_ZONE = 'America/Chicago';
    const MINUTE_MS = 60 * 1000;
    const HOUR_MS = 60 * MINUTE_MS;
    const DAY_MS = 24 * HOUR_MS;

    const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
    const CLOCK_TIME = /^(\d{1,2}):(\d{2})/;

    // One formatter, built once: constructing an Intl.DateTimeFormat is the expensive part, and
    // the reminder sweep asks about every game on every tick.
    const CENTRAL_PARTS = new Intl.DateTimeFormat('en-US', {
        timeZone: CENTRAL_TIME_ZONE,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    function partsInCentral(instant) {
        return CENTRAL_PARTS.formatToParts(instant).reduce(function (values, part) {
            values[part.type] = part.value;
            return values;
        }, {});
    }

    /** How far Central Time sat from UTC at a given instant, in milliseconds (negative). */
    function centralOffsetMs(instant) {
        const parts = partsInCentral(instant);
        const asIfUtc = Date.UTC(
            Number(parts.year),
            Number(parts.month) - 1,
            Number(parts.day),
            // Hour 24 is how some engines spell midnight in this format.
            Number(parts.hour) % 24,
            Number(parts.minute),
            Number(parts.second)
        );
        return asIfUtc - instant.getTime();
    }

    /**
     * Turns a Central Time wall clock into the instant it actually names.
     *
     * @param {string} dateStr YYYY-MM-DD
     * @param {string} timeStr HH:MM
     * @returns {Date|null} null when either value is unusable
     */
    function wallClockToInstant(dateStr, timeStr) {
        const date = CALENDAR_DATE.exec(String(dateStr == null ? '' : dateStr));
        const time = CLOCK_TIME.exec(String(timeStr == null ? '' : timeStr));
        if (!date || !time) return null;

        const hours = Number(time[1]);
        const minutes = Number(time[2]);
        if (hours > 23 || minutes > 59) return null;

        const wallClockAsUtc = Date.UTC(
            Number(date[1]),
            Number(date[2]) - 1,
            Number(date[3]),
            hours,
            minutes
        );
        if (Number.isNaN(wallClockAsUtc)) return null;

        // Two passes: the first offset is read at roughly the right moment, the second at the
        // instant that offset produces. They differ only for the hour a clock change moves.
        const firstPass = wallClockAsUtc - centralOffsetMs(new Date(wallClockAsUtc));
        return new Date(wallClockAsUtc - centralOffsetMs(new Date(firstPass)));
    }

    /**
     * The Central Time wall clock at a given instant, in the same shape a game is stored in.
     * This is what replaced "a Date whose local fields pretend to be Central": the fixtures and
     * the reminder day-naming want the strings, not a Date in an invented frame.
     *
     * @returns {{date:string, time:string, year:number, month:number, day:number,
     *            hour:number, minute:number}}
     */
    function centralWallClock(instant) {
        const parts = partsInCentral(instant || new Date());
        const hour = Number(parts.hour) % 24;
        const pad = function (value) { return String(value).padStart(2, '0'); };
        return {
            date: `${parts.year}-${parts.month}-${parts.day}`,
            time: `${pad(hour)}:${parts.minute}`,
            year: Number(parts.year),
            month: Number(parts.month),
            day: Number(parts.day),
            hour: hour,
            minute: Number(parts.minute)
        };
    }

    /** Central-Time calendar day N days from an instant, as YYYY-MM-DD. */
    function centralDateKey(instant, dayOffset) {
        const shifted = new Date((instant || new Date()).getTime() + (dayOffset || 0) * DAY_MS);
        return centralWallClock(shifted).date;
    }

    function durationMinutes(value) {
        const minutes = parseInt(value, 10);
        return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
    }

    /** When a game starts, as a real instant. */
    function gameStart(game) {
        if (!game) return null;
        return wallClockToInstant(game.date, game.time);
    }

    /** When a game finishes: its start plus its duration. A game with no duration ends at its start. */
    function gameEnd(game) {
        const start = gameStart(game);
        if (!start) return null;
        return new Date(start.getTime() + durationMinutes(game.duration) * MINUTE_MS);
    }

    function nowOrDefault(now) {
        return now instanceof Date ? now : new Date();
    }

    /**
     * True while the game is still in the future. An unscheduled or unreadable game is not
     * upcoming - the callers use this to decide whether to text people about it.
     */
    function isGameUpcoming(dateStr, timeStr, now) {
        const start = wallClockToInstant(dateStr, timeStr);
        if (!start) return false;
        return start.getTime() > nowOrDefault(now).getTime();
    }

    /** True once the first point has been played, whether or not the game is over. */
    function hasGameStarted(dateStr, timeStr, now) {
        const start = wallClockToInstant(dateStr, timeStr);
        if (!start) return false;
        return nowOrDefault(now).getTime() >= start.getTime();
    }

    /**
     * True once start + duration has passed.
     *
     * This is the signup cutoff, and it is deliberately game *end* rather than game start: a
     * late "IN" while people are already on the court is still useful to the host. The browser
     * hides the form at the same moment (getGameStatus below), which is the point of both
     * living here.
     */
    function hasGameEnded(dateStr, timeStr, duration, now) {
        const start = wallClockToInstant(dateStr, timeStr);
        if (!start) return false;
        const end = start.getTime() + durationMinutes(duration) * MINUTE_MS;
        return nowOrDefault(now).getTime() > end;
    }

    /**
     * True for a game that has started and is recent enough that its host still needs it.
     * Photos, thank-you notes and roster corrections all happen after the final point.
     */
    function isGameRecentlyFinished(dateStr, timeStr, days, now) {
        const start = wallClockToInstant(dateStr, timeStr);
        if (!start) return false;

        const moment = nowOrDefault(now).getTime();
        if (start.getTime() > moment) return false;
        const window = (typeof days === 'number' ? days : 30) * DAY_MS;
        return moment - start.getTime() <= window;
    }

    /**
     * What a page should say and offer about a game.
     *
     * The three type names are what game-page.js and manage-scripts.js branch on, so they are
     * fixed: 'cancelled', 'expired', 'active'. A game in progress is 'active' - it can still be
     * joined and edited until it ends.
     */
    function getGameStatus(game, now) {
        if (game && game.cancelled) {
            return {
                type: 'cancelled',
                message: 'This game has been cancelled.',
                canJoin: false,
                canEdit: false
            };
        }

        if (game && hasGameEnded(game.date, game.time, game.duration, now)) {
            return {
                type: 'expired',
                message: 'This game has ended.',
                canJoin: false,
                canEdit: false
            };
        }

        return {
            type: 'active',
            message: 'Game is active',
            canJoin: true,
            canEdit: true
        };
    }

    /** Kept under its old name because that is what the two management screens call. */
    function isGameExpired(dateStr, timeStr, duration, now) {
        return hasGameEnded(dateStr, timeStr, duration, now);
    }

    /**
     * How long until a game starts, in words.
     *
     * Measured between two instants, so it reads the same for a player whose phone is set to
     * Denver as for one in Chicago. It used to build the game time in the browser's own
     * timezone and be an hour out for everybody east or west of Central.
     */
    function getTimeUntilGame(dateStr, timeStr, now) {
        const start = wallClockToInstant(dateStr, timeStr);
        if (!start) return '';

        const remaining = start.getTime() - nowOrDefault(now).getTime();
        if (remaining < 0) return 'Game has started';

        const days = Math.floor(remaining / DAY_MS);
        if (days > 0) return `${days} day${days !== 1 ? 's' : ''} away`;

        const hours = Math.floor(remaining / HOUR_MS);
        if (hours > 0) return `${hours} hour${hours !== 1 ? 's' : ''} away`;

        const minutes = Math.floor(remaining / MINUTE_MS);
        return `${minutes} minute${minutes !== 1 ? 's' : ''} away`;
    }

    return {
        CENTRAL_TIME_ZONE,
        centralOffsetMs,
        wallClockToInstant,
        centralWallClock,
        centralDateKey,
        gameStart,
        gameEnd,
        isGameUpcoming,
        hasGameStarted,
        hasGameEnded,
        isGameRecentlyFinished,
        isGameExpired,
        getGameStatus,
        getTimeUntilGame
    };
}));
