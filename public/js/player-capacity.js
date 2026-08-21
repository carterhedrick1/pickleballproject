// The one place that knows a host's "how many players?" means two different numbers.
//
// The create and manage forms ask for players *besides* the host; a game stores the total. Both
// conversions live here so the form, the invitation text and the server cannot disagree about
// whether the organizer is one of the four.
function toWholeNumber(value) {
    const number = parseInt(value, 10);
    return Number.isFinite(number) ? number : 0;
}

function totalFromAdditional(additionalPlayers, organizerPlaying) {
    return toWholeNumber(additionalPlayers) + (organizerPlaying === true ? 1 : 0);
}

function additionalFromTotal(totalPlayers, organizerPlaying) {
    return Math.max(
        0,
        toWholeNumber(totalPlayers) - (organizerPlaying === true ? 1 : 0)
    );
}

export {
    totalFromAdditional,
    additionalFromTotal
};
