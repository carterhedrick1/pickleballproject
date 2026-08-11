// The Developer Area's inventory of every functional SMS category.
//
// These previews intentionally use realistic sample values instead of template tokens so the
// page shows what a person actually sees on their phone. The You're In rotation is always live.
// Every other category has an opt-in toggle and keeps its current hard-coded text until enabled.

const TEXT_MESSAGE_CONFIG_ASSET_NAME = 'text-message-draft-config';
const DEFAULT_TEXT_TOKEN = '{DEFAULT_TEXT}';
const DETAILS_MAX_LENGTH = 1600;

const TEXT_MESSAGE_CATEGORIES = Object.freeze([
  {
    id: 'youre-in',
    title: "You're In",
    addTitle: "Add A You're In Text",
    listTitle: "You're In Rotation",
    recipient: 'Confirmed Player',
    description:
      'One text is selected whenever a player is confirmed automatically or chosen by the host. Game details and reply instructions are added after it.',
    preview:
      "You're IN. The others have been warned.\n\nPickleball at Oak Park Courts on Sat, Aug 1 at 9:00 AM! You are Player 2 of 4. Reply 2 for who is playing and game details, or 9 to cancel.",
    detailsPreview:
      'Pickleball at Oak Park Courts on Sat, Aug 1 at 9:00 AM! You are Player 2 of 4. Reply 2 for who is playing and game details, or 9 to cancel.',
    defaultDetailsTemplate:
      'Pickleball at {LOCATION} on {DATE} at {TIME}! You are Player {POSITION} of {TOTAL_PLAYERS}. Reply 2 for who is playing and game details, or 9 to cancel.',
    tokens: ['DEFAULT_TEXT', 'LOCATION', 'DATE', 'TIME', 'POSITION', 'TOTAL_PLAYERS'],
    maxLength: 240,
    detailsMaxLength: DETAILS_MAX_LENGTH,
    requiresOne: true,
    live: true
  },
  {
    id: 'waitlist-confirmation',
    title: 'Waitlist Confirmation',
    addTitle: 'Add A Waitlist Confirmation Text',
    listTitle: 'Waitlist Confirmation Texts',
    recipient: 'Waitlisted Player',
    description:
      'Sent when a player joins a numbered first-come waitlist. The app adds their live position and game details.',
    preview:
      "You've been added to the waitlist for the pickleball game at Oak Park Courts on Sat, Aug 1 at 9:00 AM. You are #1 on the waitlist. We'll notify you if a spot opens up. Reply 2 for game details, or 9 to cancel.",
    defaultDetailsTemplate:
      "You've been added to the waitlist for the pickleball game at {LOCATION} on {DATE} at {TIME}. You are #{POSITION} on the waitlist. We'll notify you if a spot opens up. Reply 2 for game details, or 9 to cancel.",
    tokens: ['DEFAULT_TEXT', 'LOCATION', 'DATE', 'TIME', 'POSITION'],
    maxLength: 240,
    detailsMaxLength: DETAILS_MAX_LENGTH
  },
  {
    id: 'application-confirmation',
    title: 'Application Confirmation',
    addTitle: 'Add An Application Confirmation Text',
    listTitle: 'Application Confirmation Texts',
    recipient: 'Applicant',
    description:
      'Sent in approval mode after a player applies. Positions and the player list stay hidden until the organizer selects players.',
    preview:
      "Thanks for signing up for pickleball at Oak Park Courts on Sat, Aug 1 at 9:00 AM! The organizer will review applications and select players. You'll be notified if selected. Reply 9 to cancel your application.",
    defaultDetailsTemplate:
      "Thanks for signing up for pickleball at {LOCATION} on {DATE} at {TIME}! The organizer will review applications and select players. You'll be notified if selected. Reply 9 to cancel your application.",
    tokens: ['DEFAULT_TEXT', 'LOCATION', 'DATE', 'TIME'],
    maxLength: 240,
    detailsMaxLength: DETAILS_MAX_LENGTH
  },
  {
    id: 'roster-status-change',
    title: 'Roster Status Change',
    addTitle: 'Add A Roster Status Change Text',
    listTitle: 'Roster Status Change Texts',
    recipient: 'Affected Player',
    description:
      'Sent when the organizer moves a confirmed player to the waitlist, selects them, promotes them, or removes them.',
    preview:
      "You've been moved to the waitlist for the pickleball game at Oak Park Courts on Sat, Aug 1 at 9:00 AM. You are #1 on the waitlist. We'll notify you if a spot opens up. Reply 2 for details, or 9 to cancel.",
    previewNote:
      "Selection and promotion use the You're In text. Organizer removal uses registration or waitlist wording.",
    defaultDetailsTemplate: DEFAULT_TEXT_TOKEN,
    tokens: ['DEFAULT_TEXT', 'LOCATION', 'DATE', 'TIME', 'STATUS'],
    maxLength: 240,
    detailsMaxLength: DETAILS_MAX_LENGTH
  },
  {
    id: 'player-cancellation',
    title: 'Player Cancellation',
    addTitle: 'Add A Player Cancellation Text',
    listTitle: 'Player Cancellation Texts',
    recipient: 'Departing Player',
    description:
      'Confirms a reservation, waitlist spot, or approval-mode application cancellation. It also acknowledges an unregistered “out” response.',
    preview:
      'Your pickleball reservation at Oak Park Courts on Sat, Aug 1 at 9:00 AM has been cancelled. Thanks for letting us know!',
    defaultDetailsTemplate: DEFAULT_TEXT_TOKEN,
    tokens: ['DEFAULT_TEXT', 'LOCATION', 'DATE', 'TIME', 'STATUS'],
    maxLength: 240,
    detailsMaxLength: DETAILS_MAX_LENGTH
  },
  {
    id: 'upcoming-reminder',
    title: 'Upcoming Game Reminder',
    addTitle: 'Add An Upcoming Game Reminder Text',
    listTitle: 'Upcoming Game Reminder Texts',
    recipient: 'Confirmed Player',
    description:
      'Sent once to confirmed players when their game enters the 24-hour reminder window.',
    preview:
      'Reminder: Your pickleball game is tomorrow at 9:00 AM — Oak Park Courts. Reply 2 for details, or 9 to cancel.',
    defaultDetailsTemplate:
      'Reminder: Your pickleball game is {DAY} at {TIME} — {LOCATION}. Reply 2 for details, or 9 to cancel.',
    tokens: ['DEFAULT_TEXT', 'LOCATION', 'DATE', 'TIME', 'DAY'],
    maxLength: 240,
    detailsMaxLength: DETAILS_MAX_LENGTH
  },
  {
    id: 'game-day-reminder',
    title: 'Game Day Reminder',
    addTitle: 'Add A Game Day Reminder Text',
    listTitle: 'Game Day Reminder Texts',
    recipient: 'Confirmed Player',
    description:
      'Sent once to confirmed players about two hours before the game starts. Kept separate from the 24-hour reminder because a text written around "tomorrow" is wrong this close to the start.',
    preview:
      "Your pickleball game starts at 9:00 AM — Oak Park Courts. Reply 9 now if you can't make it, so somebody else can take the spot.",
    defaultDetailsTemplate:
      "Your pickleball game starts at {TIME} — {LOCATION}. Reply 9 now if you can't make it, so somebody else can take the spot.",
    tokens: ['DEFAULT_TEXT', 'LOCATION', 'DATE', 'TIME', 'DAY'],
    maxLength: 240,
    detailsMaxLength: DETAILS_MAX_LENGTH
  },
  {
    id: 'game-cancelled',
    title: 'Entire Game Cancelled',
    addTitle: 'Add An Entire Game Cancelled Text',
    listTitle: 'Entire Game Cancelled Texts',
    recipient: 'Confirmed And Waitlisted Players',
    description:
      'Sent to every confirmed and waitlisted player when the organizer cancels the entire game.',
    preview:
      'CANCELLED: Your pickleball game at Oak Park Courts on Sat, Aug 1 at 9:00 AM is off. Reason: Courts are closed.',
    defaultDetailsTemplate:
      'CANCELLED: Your pickleball game at {LOCATION} on {DATE} at {TIME} is off. Reason: {REASON}',
    tokens: ['DEFAULT_TEXT', 'LOCATION', 'DATE', 'TIME', 'REASON'],
    maxLength: 240,
    detailsMaxLength: DETAILS_MAX_LENGTH
  },
  {
    id: 'game-invitation',
    title: 'Game Invitation',
    addTitle: 'Add A Game Invitation Text',
    listTitle: 'Game Invitation Texts',
    recipient: 'Invited Roster Player',
    description:
      'Sent when the organizer texts an invitation from the management page. The body is the same invitation the Copy Invitation button produces, so the two can never drift apart.',
    preview:
      "Let us know if you're IN or OUT for pickleball by clicking the link below:\n\nhttps://inorout.club/game.html?id=example\n\nLocation: Oak Park Courts\nDate: Saturday, August 1, 2026\nTime: 9:00 AM",
    previewNote:
      'The full invitation is built by the invitation builder and arrives here as {DEFAULT_TEXT}.',
    defaultDetailsTemplate: DEFAULT_TEXT_TOKEN,
    tokens: ['DEFAULT_TEXT', 'LOCATION', 'DATE', 'TIME', 'ORGANIZER'],
    maxLength: 900,
    detailsMaxLength: DETAILS_MAX_LENGTH
  },
  {
    id: 'game-details-changed',
    title: 'Game Details Changed',
    addTitle: 'Add A Game Details Changed Text',
    listTitle: 'Game Details Changed Texts',
    recipient: 'Confirmed And Waitlisted Players',
    description:
      'Sent to everyone signed up when the organizer moves the court, date, time, or duration. Editing only the message or the personality sends nothing.',
    preview:
      'UPDATED: Your pickleball game changed time.\n\nOak Park Courts\nSat, Aug 1 at 10:30 AM\nDuration: 90 minutes\n\nReply 2 for details, or 9 to cancel.',
    previewNote:
      'The message always restates the full time and place, not only the part that changed.',
    defaultDetailsTemplate: DEFAULT_TEXT_TOKEN,
    tokens: ['DEFAULT_TEXT', 'LOCATION', 'DATE', 'TIME', 'DURATION'],
    maxLength: 240,
    detailsMaxLength: DETAILS_MAX_LENGTH
  },
  {
    id: 'organizer-announcement',
    title: 'Organizer-Written Announcement',
    addTitle: 'Add An Organizer-Written Announcement Text',
    listTitle: 'Organizer-Written Announcement Texts',
    recipient: 'Organizer-Selected Players',
    description:
      'The organizer writes this message and can send it to confirmed players, the waitlist, or selected individuals.',
    preview:
      'We moved to courts 3 and 4. Please arrive 10 minutes early so we can warm up.',
    previewNote:
      "There is no fixed default body today. The organizer's message is delivered exactly as written.",
    defaultDetailsTemplate: '{ANNOUNCEMENT}',
    tokens: ['DEFAULT_TEXT', 'ANNOUNCEMENT', 'LOCATION', 'DATE', 'TIME'],
    maxLength: 240,
    detailsMaxLength: DETAILS_MAX_LENGTH
  },
  {
    id: 'game-created',
    title: 'Game Creation Confirmation',
    addTitle: 'Add A Game Creation Confirmation Text',
    listTitle: 'Game Creation Confirmation Texts',
    recipient: 'Organizer',
    description:
      'Sent to the organizer immediately after a new game is successfully created.',
    preview:
      'Your pickleball game at Oak Park Courts on Sat, Aug 1 at 9:00 AM has been created! Reply "1" for your management link, or "2" for game details.',
    defaultDetailsTemplate:
      'Your pickleball game at {LOCATION} on {DATE} at {TIME} has been created! Reply "1" for your management link, or "2" for game details.',
    tokens: ['DEFAULT_TEXT', 'LOCATION', 'DATE', 'TIME'],
    maxLength: 240,
    detailsMaxLength: DETAILS_MAX_LENGTH
  },
  {
    id: 'host-alerts',
    title: 'Host Activity Alerts',
    addTitle: 'Add A Host Activity Alert Text',
    listTitle: 'Host Activity Alert Texts',
    recipient: 'Organizer',
    description:
      'Alerts the organizer about joins, cancellations, a full game, one remaining spot, a new waitlist, or an approval-mode opening.',
    preview:
      'HOST ALERT: Jamie just joined your pickleball game at Oak Park Courts on Sat, Aug 1. Only 1 spot remaining.',
    previewNote:
      'This is the player-joined version. The current app has five other event-specific versions.',
    tokens: [
      'DEFAULT_TEXT',
      'EVENT',
      'PLAYER_NAME',
      'LOCATION',
      'DATE',
      'TIME',
      'SPOTS_LEFT',
      'WAITLIST_COUNT',
      'TOTAL_PLAYERS',
      'PROMOTED_NAME'
    ],
    defaultDetailsTemplate: DEFAULT_TEXT_TOKEN,
    maxLength: 240,
    detailsMaxLength: DETAILS_MAX_LENGTH
  },
  {
    id: 'management-links',
    title: 'Management Link Delivery',
    addTitle: 'Add A Management Link Delivery Text',
    listTitle: 'Management Link Delivery Texts',
    recipient: 'Organizer',
    description:
      'Sent after the organizer replies 1 or requests a management link from My Games.',
    preview:
      "Here's your management link for Oak Park Courts on Sat, Aug 1 at 9:00 AM: https://inorout.club/manage.html?id=example&token=example",
    previewNote:
      'When the organizer has multiple games, the current app sends a list or highlights the next game.',
    defaultDetailsTemplate: DEFAULT_TEXT_TOKEN,
    tokens: ['DEFAULT_TEXT'],
    maxLength: 240,
    detailsMaxLength: DETAILS_MAX_LENGTH
  },
  {
    id: 'game-details',
    title: 'Game Details',
    addTitle: 'Add A Game Details Text',
    listTitle: 'Game Details Texts',
    recipient: 'Organizer Or Player',
    description:
      'Sent after a user replies 2. The visible roster, waitlist, role, and next command vary by recipient.',
    preview:
      'Oak Park Courts\nSat, Aug 1 at 9:00 AM\nDuration: 90 minutes\n\nConfirmed Players (2/4):\n• Scott (Organizer)\n• Jamie\n\nYou are: Confirmed Player\nReply "9" to cancel',
    previewNote:
      'People registered for multiple games first receive a numbered game-selection list.',
    defaultDetailsTemplate: DEFAULT_TEXT_TOKEN,
    tokens: ['DEFAULT_TEXT'],
    maxLength: 240,
    detailsMaxLength: DETAILS_MAX_LENGTH
  },
  {
    id: 'cancellation-help',
    title: 'Cancellation Workflow And Command Help',
    addTitle: 'Add A Cancellation Workflow And Command Help Text',
    listTitle: 'Cancellation Workflow And Command Help Texts',
    recipient: 'Person Texting The App',
    description:
      'Guides reply-9 cancellations and answers unknown commands, invalid selections, missing games, and processing errors.',
    preview:
      'Reply "1" for your management link, "2" for game details, or "9" to cancel your spot. If you need anything else, reach out to the organizer.',
    previewNote:
      'Cancellation menus, confirmations, no-game responses, and error replies use additional current versions.',
    defaultDetailsTemplate: DEFAULT_TEXT_TOKEN,
    tokens: ['DEFAULT_TEXT'],
    maxLength: 240,
    detailsMaxLength: DETAILS_MAX_LENGTH
  }
]);

const CATEGORY_BY_ID = new Map(
  TEXT_MESSAGE_CATEGORIES.map((category) => [category.id, category])
);

function getTextMessageCategory(id) {
  return CATEGORY_BY_ID.get(id) || null;
}

function normalizeMessages(value, maxLength) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const messages = [];
  value.forEach((item) => {
    const message = String(item == null ? '' : item).trim();
    if (!message || message.length > maxLength || seen.has(message)) return;
    seen.add(message);
    messages.push(message);
  });
  return messages;
}

function normalizeDetailsTemplate(value, fallback, maxLength = DETAILS_MAX_LENGTH) {
  const detailsTemplate = String(value == null ? '' : value).trim();
  if (!detailsTemplate || detailsTemplate.length > maxLength) return String(fallback);
  return detailsTemplate;
}

function normalizeDraftConfig(value) {
  const categories = value && typeof value === 'object' && value.categories
    ? value.categories
    : {};
  const normalized = {};
  TEXT_MESSAGE_CATEGORIES.forEach((category) => {
    if (category.live) return;
    normalized[category.id] = {
      enabled: categories[category.id]?.enabled === true,
      messages: normalizeMessages(
        categories[category.id] && categories[category.id].messages,
        category.maxLength
      ),
      detailsTemplate: normalizeDetailsTemplate(
        categories[category.id] && categories[category.id].detailsTemplate,
        category.defaultDetailsTemplate,
        category.detailsMaxLength
      )
    };
  });
  return { categories: normalized };
}

module.exports = {
  TEXT_MESSAGE_CONFIG_ASSET_NAME,
  DEFAULT_TEXT_TOKEN,
  TEXT_MESSAGE_CATEGORIES,
  getTextMessageCategory,
  normalizeMessages,
  normalizeDetailsTemplate,
  normalizeDraftConfig
};
