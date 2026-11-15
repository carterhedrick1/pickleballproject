function invitationAvailability(game) {
    const total = Number.parseInt(game.totalPlayers, 10) || 0;
    const hostSeat = game.organizerPlaying !== false && !(game.players || []).some(p => p.isOrganizer) ? 1 : 0;
    const available = Math.max(0, total - (game.players || []).length - hostSeat);
    if ((game.registrationMode || game.gameMode) === 'waitlist') {
        return `Host selects players. Apply to be considered; applying does not reserve a spot.`;
    }
    if (!available) return 'Game is full. Join the waitlist; a spot is not guaranteed.';
    return `${available === 1 ? 'Spot' : 'Spots'}: ${available}\n\nFirst ${available} to respond ${available === 1 ? 'is' : 'are'} in.`;
}
export { invitationAvailability };
