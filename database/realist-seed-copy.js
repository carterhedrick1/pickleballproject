/**
 * The Realist copy that ships with the app, and the dev_asset names that record it was seeded.
 *
 * Kept apart from the seeding logic in ./message-seeds.js because this is content, not code:
 * it is read by tests that pin the counts and wording, and it changes for editorial reasons
 * rather than technical ones. Everything here seeds as a draft on a disabled surface unless
 * the seeder says otherwise, so nothing reaches a player until the owner approves it.
 */

const REALIST_ID = 'realist';
const MIGRATION_ASSET_NAME = 'message-randomizer-migration-v1';
const VETTED_SLOGAN_REPAIR_ASSET_NAME = 'message-randomizer-vetted-slogans-v2';
const INVITATION_OPENING_DRAFT_ASSET_NAME = 'message-randomizer-invitation-openings-v1';
const GAME_DETAILS_DRAFT_ASSET_NAME = 'message-randomizer-game-details-v1';
const PAGE_MOMENT_DRAFT_ASSET_NAME = 'message-randomizer-page-moments-v1';
const REALIST_INVITATION_OPENING_DRAFTS = Object.freeze([
  'A pickleball invitation has arrived. Your excuses may begin.',
  'A game is forming. Confidence remains optional.',
  'You were invited for your availability. Let’s not make this complicated.',
  'Your athletic future has narrowed to two buttons.',
  'Please consult your calendar, not your feelings.',
  'We found a court. Now we are finding out who can make a decision.',
  'Your presence is requested. Your scouting report was not.',
  'Pickleball is available. Athletic excellence remains optional.',
  'Here lies an opportunity to play pickleball and briefly feel athletic.',
  'An invitation, a calendar, and two possible answers. Stay focused.',
  'Pickleball wants a commitment. Nothing emotional, just scheduling.',
  'This invitation has fewer choices than your paddle bag.',
  'Your calendar is about to reveal how serious you are about pickleball.',
  'A game is being arranged. Your excuses remain unrequested.',
  'A game is forming. Your talent was not part of the calculation.',
  'Please determine whether your schedule supports recreational overconfidence.',
  'Your next athletic exaggeration starts with one decision.',
  'The details are below. The dramatic deliberation is optional.',
  'The court has requested your presence and waived the skill requirement.',
  'Your schedule is the only qualification under review.'
]);
const REALIST_GAME_DETAILS_DRAFTS = Object.freeze([
  'Information has been organized. Try not to make it emotional.',
  'Everything currently worth knowing is below. Adjust expectations accordingly.',
  'Your request has produced details. Technology occasionally works.',
  'Here is what the system knows. It has no opinions about your backhand.',
  'Everything below is useful. A rare moment for your phone.',
  'The details are below. Please pace your excitement.',
  'Here is the plan, assuming everyone can read.',
  'The details are here. No paddle upgrade was required.',
  'The facts are ready. Your excuses were not consulted.'
]);
// Drafts for the on-page moments. Seeded as drafts on disabled surfaces, so nothing
// is player-visible until the owner approves the lines and turns the surface on.
const REALIST_PAGE_MOMENT_DRAFTS = Object.freeze({
  'empty-my-games': Object.freeze([
    "No games yet. The court isn't going to book itself.",
    'Zero games hosted. The group chat is winning.',
    'This page is waiting on you, and it is not subtle about it.',
    'An empty schedule is a choice. A fixable one.',
    'No games on record. Your paddle is judging you from the trunk.',
    'Still nothing. The button is right there.',
    'Hosting history: none. Reputation: pending.',
    'Every game you host ends up here. So far, so empty.'
  ]),
  'empty-roster': Object.freeze([
    "Nobody yet. Rosters don't fill themselves - that's the games' job.",
    "Somewhere, four people are texting \"who's in?\" for the tenth time.",
    'No regulars on file. We both know you have regulars.',
    'Add a name or host a game. Either way this page stops looking like this.',
    "Your roster is empty. Your contact list isn't. Do the math.",
    'Zero players saved. Bold strategy for someone organizing games.',
    'This is where your people go. Currently: no people.',
    'Empty. The waitlist concept needs bodies to work.'
  ]),
  'post-create-success': Object.freeze([
    "Game created. The hard part was you deciding. That's done.",
    "Done. Now the invitations do the nagging so you don't have to.",
    'Created. Your job now is pressing one button and staying out of the way.',
    'The game exists. Attendance is now a them problem.',
    "Every reply from here on is one text you didn't send.",
    'Created. The group chat era of your life is over.',
    "That's it. The app chases people now.",
    'Game on the books. Indecision is no longer your problem to host.'
  ])
});
const LEGACY_V1_SLOGAN_REPLACEMENTS = new Map([
  ['Fill the court, not the group chat.', 'Fill the court, not a group chat.'],
  ['We don\'t care why. We care if.', 'No one cares why. We care if.'],
  ['Ghost us and the app moves on without you.', 'Ghost us and we move on without you.'],
  ['Life\'s too short to text six people twice.', 'Life\'s too short to text six people ten times.'],
  ['"I\'m 90% in" means you\'re out.', '"I\'m 90% in" means you\'re Out.'],
  ['Nobody is putting you down as a maybe.', 'Nobody is putting you down as a Maybe.'],
  ['Quick responses improve your DUPR.', 'Quick responses will improve your DUPR Rating.'],
  [
    'You found time to read this. Find a second to respond.',
    'You had time to read this. Find a second to respond.'
  ]
]);
const DEFAULT_REALIST_DESCRIPTION =
  'Short, direct, dryly funny reality checks about committing, responding, and showing up.';
const DEFAULT_REALIST_GUIDANCE =
  'Sound like a blunt friend who values availability over excuses. Keep the joke concise, observational, and useful. Never change operational facts or instructions.';
module.exports = {
  REALIST_ID,
  MIGRATION_ASSET_NAME,
  VETTED_SLOGAN_REPAIR_ASSET_NAME,
  INVITATION_OPENING_DRAFT_ASSET_NAME,
  GAME_DETAILS_DRAFT_ASSET_NAME,
  PAGE_MOMENT_DRAFT_ASSET_NAME,
  REALIST_INVITATION_OPENING_DRAFTS,
  REALIST_GAME_DETAILS_DRAFTS,
  REALIST_PAGE_MOMENT_DRAFTS,
  LEGACY_V1_SLOGAN_REPLACEMENTS,
  DEFAULT_REALIST_DESCRIPTION,
  DEFAULT_REALIST_GUIDANCE
};
