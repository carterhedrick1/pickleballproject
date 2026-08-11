// Stable event names for outbound text telemetry. These describe why a text was sent, while
// text-message-categories.js describes which editable copy/template produced its body.

const SMS_EVENT_DEFINITIONS = Object.freeze([
  {
    id: 'player-confirmed',
    title: 'Player Confirmed Or Promoted',
    recipient: 'Confirmed Player',
    description: 'A player joins an open spot, is selected by the organizer, or is promoted from the waitlist.'
  },
  {
    id: 'player-waitlisted',
    title: 'Player Added To Waitlist',
    recipient: 'Waitlisted Player',
    description: 'A first-come game is full and a player receives their numbered waitlist position.'
  },
  {
    id: 'application-submitted',
    title: 'Application Submitted',
    recipient: 'Applicant',
    description: 'A player applies to an approval-mode game and is told that selection is pending.'
  },
  {
    id: 'player-moved-to-waitlist',
    title: 'Player Moved To Waitlist',
    recipient: 'Affected Player',
    description: 'The organizer moves a confirmed player back to the waitlist.'
  },
  {
    id: 'player-removed-by-organizer',
    title: 'Player Removed By Organizer',
    recipient: 'Affected Player',
    description: 'The organizer removes a confirmed player, waitlisted player, or applicant.'
  },
  {
    id: 'player-cancelled',
    title: 'Player Cancellation Confirmed',
    recipient: 'Departing Player',
    description: 'A player cancels from the web page or by replying 9 and receives confirmation.'
  },
  {
    id: 'upcoming-game-reminder',
    title: 'Upcoming Game Reminder',
    recipient: 'Confirmed Player',
    description: 'A confirmed player receives the scheduled reminder before an upcoming game.'
  },
  {
    id: 'game-day-reminder',
    title: 'Game Day Reminder',
    recipient: 'Confirmed Player',
    description: 'A confirmed player is reminded about two hours before the game starts.'
  },
  {
    id: 'entire-game-cancelled',
    title: 'Entire Game Cancelled',
    recipient: 'Confirmed And Waitlisted Players',
    description: 'The organizer cancels a game and every eligible player is notified.'
  },
  {
    id: 'game-details-changed',
    title: 'Game Details Changed',
    recipient: 'Confirmed And Waitlisted Players',
    description: 'The organizer moves the court, date, time, or duration and tells everyone signed up.'
  },
  {
    id: 'game-invitation',
    title: 'Game Invitation Sent',
    recipient: 'Invited Roster Player',
    description: 'The organizer texts the invitation to people on their roster, or nudges the ones who never replied.'
  },
  {
    id: 'organizer-announcement',
    title: 'Organizer Announcement',
    recipient: 'Organizer-Selected Players',
    description: 'The organizer sends a broadcast or individual announcement.'
  },
  {
    id: 'game-created',
    title: 'Game Created',
    recipient: 'Organizer',
    description: 'A new game is saved and the organizer receives the initial confirmation.'
  },
  {
    id: 'host-player-joined',
    title: 'Host Alert: Player Joined',
    recipient: 'Organizer',
    description: 'An opted-in organizer is alerted when a confirmed player joins.'
  },
  {
    id: 'host-player-joined-filled',
    title: 'Host Alert: Player Joined And Filled The Game',
    recipient: 'Organizer',
    description:
      'An organizer opted into both join and full alerts is told once when the last spot goes.'
  },
  {
    id: 'host-player-cancelled',
    title: 'Host Alert: Player Cancelled',
    recipient: 'Organizer',
    description: 'An opted-in organizer is alerted when a player gives up a spot.'
  },
  {
    id: 'host-game-full',
    title: 'Host Alert: Game Full',
    recipient: 'Organizer',
    description: 'An opted-in organizer is alerted when every confirmed spot is filled.'
  },
  {
    id: 'host-one-spot-left',
    title: 'Host Alert: One Spot Left',
    recipient: 'Organizer',
    description: 'An opted-in organizer is alerted when one confirmed spot remains.'
  },
  {
    id: 'host-waitlist-started',
    title: 'Host Alert: Waitlist Started',
    recipient: 'Organizer',
    description: 'An opted-in organizer is alerted when the first player joins the waitlist.'
  },
  {
    id: 'host-approval-spot-opened',
    title: 'Host Alert: Approval Spot Opened',
    recipient: 'Organizer',
    description: 'An approval-mode organizer is alerted that a confirmed spot needs a replacement.'
  },
  {
    id: 'management-link-requested',
    title: 'Management Link Requested',
    recipient: 'Organizer',
    description: 'An organizer replies 1 or requests a management link from My Games.'
  },
  {
    id: 'host-verification-code',
    title: 'Host Verification Code',
    recipient: 'Organizer',
    description: 'An organizer verifies their phone before opening private host pages.'
  },
  {
    id: 'game-details-requested',
    title: 'Game Details Requested',
    recipient: 'Organizer Or Player',
    description: 'A person replies 2 and receives game details, a game list, or related guidance.'
  },
  {
    id: 'cancellation-workflow',
    title: 'Cancellation Or Command Help',
    recipient: 'Person Texting The App',
    description: 'A person replies 9, enters an invalid command, or needs cancellation guidance.'
  },
  {
    id: 'custom-reply-option',
    title: 'Custom Reply Option',
    recipient: 'Organizer Or Player',
    description: 'A person uses a developer-configured SMS reply command.'
  }
]);

const SMS_EVENT_IDS = new Set(SMS_EVENT_DEFINITIONS.map((event) => event.id));

function normalizeSmsEventId(value) {
  const eventId = String(value || '').trim();
  return SMS_EVENT_IDS.has(eventId) ? eventId : 'unclassified';
}

module.exports = {
  SMS_EVENT_DEFINITIONS,
  normalizeSmsEventId
};
