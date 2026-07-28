(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.PlayerCapacity = api;
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
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

    return {
        totalFromAdditional,
        additionalFromTotal
    };
}));
