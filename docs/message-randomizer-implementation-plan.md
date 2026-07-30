# Message Randomizer Implementation Plan

## Objective

Build a personality-driven message system that keeps IN or OUT's operational details
reliable while regularly showing players fresh, funny copy. The first implemented
personality is **Realist**. The architecture must support additional personalities later,
including **Let's Go!** and **Gentle Parent**, without implementing their content now.

The organizer selects the personality used for a game. The password-protected Developer
Area controls personality descriptions, favorite messages, generated-message inventory,
locked-to-fresh ratios, targeting rules, previews, and rollout settings.

## Confirmed Realist Source Material

The existing, owner-vetted copy is the canonical Realist voice:

- All 19 messages currently saved in the Slogans tab.
- All 22 messages currently saved in the You're In rotation.

The migration must read the saved production configurations instead of relying only on
code defaults. This preserves edits that exist in `slogan-config` and `youre-in-config`.

All 41 messages become:

1. Locked favorites that are never silently edited or discarded.
2. Style examples supplied to the fresh-message generator.
3. Surface-tagged content, so a site slogan is not accidentally used as a confirmation
   message and a You're In opening is not used in an incompatible context.

## Product Principles

1. **The joke must never break the job.** Dates, times, locations, roster positions,
   capacity, cancellation reasons, links, and SMS reply commands remain deterministic.
2. **Generate ahead, select instantly.** Player-facing requests must select from stored
   inventory. They must not wait for an AI generation request.
3. **Fresh means low repetition, not uncontrolled output.** Store generated candidates,
   validate them, track usage, and keep a no-repeat window.
4. **Favorites stay favorites.** A configurable percentage of selections comes from the
   locked pool.
5. **Target people by identity, not just display name.** Match players by normalized phone
   number while showing their name in the Developer Area.
6. **Safe failure.** If generation, configuration, or selection fails, use the current
   deterministic message.
7. **Private configuration stays private.** Personality prompts, targeting rules, phone
   numbers, and message history are available only through authenticated Developer APIs.

## Current Repository Baseline

The implementation should extend the following existing systems instead of creating
parallel versions:

- `public/js/slogans.js` selects one slogan per page and shares it between the header and
  footer.
- `youre-in-messages.js` and `services/youre-in-rotation.js` select a random You're In
  opening and append deterministic game details.
- `text-message-categories.js` inventories 13 functional SMS categories.
- `services/text-message-rotation.js` supports random openings for the remaining SMS
  categories, although only You're In is currently live by default.
- `public/js/invitation-generator.js` builds a fixed invitation that the organizer copies
  into another application.
- `routes/dev.js`, `database/dev.js`, and the `dev_assets` table persist current developer
  configuration.
- Games are persisted as JSON, so a `personalityId` can be added without a games-table
  migration.
- `host_roster` and Developer roster APIs provide stable player identity through normalized
  phone numbers.
- `sms_events` records delivery-event metrics but does not record which randomized message
  was selected.

## Scope

### Included

- A new top-level **Message Randomizer** Developer Area tab.
- One enabled personality: Realist.
- Editable personality description and generation guidance.
- Locked favorites and generated-message inventory.
- A configurable locked/fresh ratio, globally and optionally by message surface.
- No-repeat selection with deterministic fallbacks.
- Per-game personality selection for organizers.
- Personality-bearing copy for site slogans, invitation copy, and supported SMS openings.
- Player-specific exact messages and bounded generation directions.
- Target-only, known-game-audience, and invitation-copy targeting.
- Generation and selection telemetry.
- Migration of the existing Slogans and You're In configurations.

### Not Included In The First Release

- Actual Let's Go! or Gentle Parent message generation.
- Randomized buttons, headings, validation errors, legal text, consent text, or essential
  transactional instructions.
- Live AI calls in page-load or SMS-send request paths.
- Claims that IN or OUT knows who received a copied invitation.
- Automatically rewriting organizer-authored announcements unless the organizer explicitly
  opts into a personality wrapper or rewrite.

## Terminology And Message Surfaces

Use stable surface IDs in storage and APIs. Initial surfaces:

| Surface ID | Purpose | Current Source |
| --- | --- | --- |
| `site-slogan` | Shared header/footer line | Slogans configuration |
| `invitation-opening` | Personality line in copied invitation | New |
| `youre-in` | Confirmed-player opening | You're In rotation |
| `waitlist-confirmation` | Waitlist opening | Text message category |
| `application-confirmation` | Application opening | Text message category |
| `roster-status-change` | Move/select/remove opening | Text message category |
| `player-cancellation` | Cancellation acknowledgement opening | Text message category |
| `upcoming-reminder` | Reminder opening | Text message category |
| `game-cancelled` | Cancelled-game opening | Text message category |
| `organizer-announcement` | Optional wrapper only | Text message category |
| `game-created` | Organizer confirmation opening | Text message category |
| `host-alerts` | Host activity opening | Text message category |
| `management-links` | Management-link opening | Text message category |
| `game-details` | Requested-details opening | Text message category |
| `cancellation-help` | Command-help opening | Text message category |

Each surface defines:

- Allowed template values.
- Maximum personality-copy length.
- Whether an empty personality opening is valid.
- Its deterministic details builder or current default.
- Whether targeted group copy is permitted.
- Whether generated content can go live automatically.

## Data Model

Use relational tables for searchable inventory, targeting, and usage history. Continue to
use game JSON for the selected personality.

### `message_personalities`

- `id` — stable slug such as `realist`.
- `name`.
- `description` — owner-editable personality definition.
- `generation_guidance` — additional editable constraints/examples.
- `enabled`.
- `is_default`.
- `locked_percent` — integer from 0 through 100.
- `fresh_pool_minimum`.
- `generation_batch_size`.
- `created_at`, `updated_at`.

Only one personality may be the default. Seed Realist as enabled and default.

### `personality_surface_settings`

- `personality_id`.
- `surface_id`.
- `enabled`.
- `locked_percent_override` — nullable.
- `fresh_pool_minimum_override` — nullable.
- `auto_publish_generated` — defaults false during rollout.
- `updated_at`.

### `randomizer_messages`

- `id` — UUID.
- `personality_id`.
- `surface_id`.
- `text`.
- `source` — `migrated`, `manual`, or `generated`.
- `status` — `draft`, `active`, or `archived`.
- `locked`.
- `generation_direction` — nullable.
- `generator_name` and `generator_version` — nullable metadata.
- `prompt_version` — nullable.
- `usage_count`.
- `last_used_at`.
- `created_at`, `updated_at`.

Add a normalized-text uniqueness constraint per personality and surface so punctuation or
whitespace-only duplicates cannot enter the pool.

### `message_target_rules`

- `id` — UUID.
- `personality_id`.
- `target_phone` — normalized phone, never returned by public APIs.
- `target_display_name`.
- `game_id` — nullable for all games.
- `trigger_status` — `confirmed`, `waitlisted`, `applicant`, `out`, or `any-known`.
- `surface_id`.
- `audience` — `target-only`, `confirmed`, `known-game-audience`, or `invitation-copy`.
- `mode` — `exact` or `direction`.
- `exact_text` — nullable.
- `generation_direction` — nullable.
- `enabled`.
- `starts_at`, `ends_at` — nullable.
- `created_at`, `updated_at`.

### `message_selection_events`

- `id` — UUID.
- `message_id` — nullable when falling back to legacy copy.
- `personality_id`.
- `surface_id`.
- `game_id` — nullable.
- `recipient_hash` — nullable and generated with the existing privacy-safe hashing approach.
- `target_rule_id` — nullable.
- `source_bucket` — `exact-target`, `directed-target`, `locked`, `fresh`, or `fallback`.
- `selected_at`.

Keep raw message bodies out of long-lived telemetry; join to the message inventory when an
authenticated Developer view needs the text.

### Game JSON

Add:

```json
{
  "personalityId": "realist"
}
```

Older games without the property resolve to the enabled default personality. Add
`personalityId` to the allowlist in `utils/game-update.js`.

## Migration

Create an idempotent migration routine that runs after schema initialization:

1. Seed the Realist personality if it does not exist.
2. Read the saved `slogan-config`.
3. Insert every saved slogan as an active, locked, migrated `site-slogan` message.
4. Read the saved `youre-in-config`.
5. Insert every saved opening as an active, locked, migrated `youre-in` message.
6. Preserve the current deterministic You're In details template.
7. Mark migration completion with a versioned developer asset or migration record.
8. Do not delete the legacy assets during the initial rollout.

During compatibility rollout, old APIs may read from the new inventory or remain as
fallbacks. Remove duplicate editing paths only after production behavior is verified.

## Generation Engine

Add a server-side provider adapter so selection logic is not coupled to one AI vendor.
Use Node's existing `fetch` rather than adding a dependency unless the selected provider
requires one.

### Prompt Inputs

- Personality name, editable description, and generation guidance.
- Vetted locked favorites from both Realist source surfaces as voice examples.
- The requested surface and its communication goal.
- Allowed template values.
- Maximum length.
- Number of candidates.
- Recent generated messages to avoid.
- Optional bounded player-target direction.
- Permanent safety constraints.

The generator must return structured JSON containing only candidate messages.

### Permanent Constraints

Keep these outside the editable personality description:

- Do not invent facts about a player.
- Do not reference protected characteristics, health, disability, religion, sexuality,
  finances, trauma, or family circumstances.
- Do not produce threats, slurs, sexual content, or encouragement of harassment.
- Do not imply a player has been excluded when they have not.
- Do not alter dates, times, locations, roster status, links, or reply commands.
- Keep Realist copy short and direct.
- Preserve supported template tokens exactly.

### Validation

Reject candidates that:

- Are blank, duplicated, too long, or malformed.
- Contain unsupported or missing required tokens.
- Contain URLs or phone numbers unless the surface permits them.
- Contain operational claims that belong in deterministic details.
- Match a recently archived/generated item after normalization.
- Fail the safety filter.

### Refill Behavior

- Provide a Developer Area **Generate Fresh Messages** button.
- Automatically enqueue a refill when unused active fresh inventory falls below the
  configured minimum.
- Run refills outside the player-facing response path.
- Use a single-flight lock per personality/surface to prevent duplicate concurrent jobs.
- Apply backoff after provider failures.
- Display last success, last failure, pool count, and failure reason in the Developer Area.
- Continue serving locked or legacy fallback copy during every failure mode.

## Selection Engine

Create one server-side resolver used by site slogans, invitation generation, and SMS
categories.

Inputs:

- `personalityId`.
- `surfaceId`.
- `game`.
- Recipient identity when applicable.
- Template values.
- Optional deterministic fallback text.

### Precedence

1. Active exact target rule matching player, game, trigger status, surface, and audience.
2. Active direction-based target inventory matching the same context.
3. General personality inventory selected by the locked/fresh scheduler.
4. Current legacy/fixed text.

### Ratio

Use a deficit or rolling-window scheduler, not an independent random coin flip. Over a
configurable window, the selected locked and fresh counts should converge on the configured
percentage even when traffic is low.

Example: at 40% locked, the engine should produce approximately four locked selections and
six fresh selections per ten eligible uses, subject to inventory availability.

If the chosen bucket is empty, use the other bucket and record the fallback bucket decision.

### No-Repeat Rules

- SMS: exclude recently used message IDs for the recipient and surface.
- Game group messages: exclude messages recently used for that game and surface.
- Site slogans: return a message ID and let the browser remember a small recent list in
  local storage; the public endpoint excludes those IDs.
- Do not repeat until all eligible messages have been used, then relax oldest-first.
- Continue sharing one resolved site slogan between the header and footer on a page.

### Rendering

Render supported tokens only after selection. Combine the personality opening with the
deterministic details using the existing blank-line section format.

## Developer Area Experience

Add **Message Randomizer** to `STANDARD_TAB_IDS` and the top-level tab bar.

### Personality Panel

- Personality selector.
- Enabled/default controls.
- Editable description and generation guidance.
- Locked/Fresh ratio slider with numeric fields.
- Pool thresholds.
- Save and validation status.

Only Realist is enabled initially. Do not show unusable choices to organizers.

### Surface Matrix

For every surface show:

- On/off status.
- Locked and fresh counts.
- Ratio override.
- Auto-publish status.
- Last generated and last selected times.
- Preview button.

### Message Library

Filter by surface, source, status, and locked state. Each row supports:

- Edit.
- Lock/Unlock.
- Activate/Archive.
- Regenerate Similar.
- Usage count and last-used time.

The migrated 41 messages must visibly carry **Locked Favorite** and **Vetted** labels.

### Generation Review

Generated messages first enter `draft` while `auto_publish_generated` is off. The developer
can preview, edit, activate, lock, or reject them in bulk. After confidence is established,
auto-publish may be enabled per surface.

### Targeted Rules

The rule builder:

- Selects a player from the protected master roster.
- Stores/matches the normalized phone while displaying the name.
- Selects optional game scope, trigger status, surface, and audience.
- Accepts either exact copy or a bounded generation direction.
- Shows a final rendered preview and audience summary.
- Requires an explicit activation action.

### Preview And Test

Allow the developer to choose:

- Personality.
- Surface.
- Example game.
- Example recipient.
- Target rule on/off.
- Multiple rerolls.

The preview must display:

- Final rendered message.
- Selected source bucket.
- Locked/fresh status.
- Matching target rule.
- Character count.
- Deterministic fallback.

Previewing must not increment live usage counts.

## Organizer Experience

### Create Game

Add a **Personality** field populated from a public, read-only endpoint that returns only
enabled personality IDs, names, and short public descriptions. Submit `personalityId` with
the game.

Initially the only choice is Realist. Preserve the field and API contract so later
personalities can be enabled without another game-model change.

### Manage Game

Show and allow editing of the selected personality in Game Details. Changing it affects
future copy only and does not regenerate messages that have already been shown or sent.

### Public Game Page

Game-specific personality copy must use the game's `personalityId`. General pages without a
game context use the default personality.

## Invitations And The Meaning Of "Invited"

The current app copies an invitation to the clipboard. It does not send the invitation and
does not know its recipients.

### First Release

- Randomize an `invitation-opening` when invitation copy is generated.
- Apply an `invitation-copy` target rule only when the target is already present in the
  game's known roster state.
- Make no claim that specific people received the copied message.

### Full Invite-Audience Support

To target "everyone invited" literally:

1. Add an organizer flow to choose intended invitees from the host roster.
2. Persist an `invitedPlayers` list on the game using normalized phones and display names.
3. Include those people in `known-game-audience` targeting.
4. If IN or OUT later sends invitations directly, record delivery attempts and use the
   persisted list as the authoritative audience.

This second stage should be implemented before any UI says that a message was delivered to
"all invitees."

## API Plan

Authenticated Developer APIs:

- `GET /api/dev/message-randomizer`
- `PUT /api/dev/message-personalities/:id`
- `GET /api/dev/randomizer-messages`
- `POST /api/dev/randomizer-messages`
- `PUT /api/dev/randomizer-messages/:id`
- `POST /api/dev/message-generation`
- `GET /api/dev/message-generation/status`
- `GET /api/dev/message-target-rules`
- `POST /api/dev/message-target-rules`
- `PUT /api/dev/message-target-rules/:id`
- `DELETE /api/dev/message-target-rules/:id`
- `POST /api/dev/message-randomizer/preview`
- `GET /api/dev/message-randomizer/metrics`

Public or host-authorized APIs:

- `GET /api/message-personalities` — enabled public metadata only.
- `GET /api/random-message?surface=site-slogan&exclude=...`
- A host-authorized invitation-message endpoint, so invitation selection and usage history
  happen on the server instead of only inside browser JavaScript.

Do not return internal prompts, targeting data, player phones, or inventory lists through
public APIs.

## Likely File Changes

New modules:

- `message-surfaces.js`
- `services/message-randomizer.js`
- `services/message-generation.js`
- `database/message-randomizer.js`
- `routes/message-randomizer.js`
- `public/js/message-randomizer-admin.js`
- Unit tests for configuration, generation validation, selection, targeting, and migration.

Existing modules likely updated:

- `database/schema.js`
- `database.js`
- `routes/dev.js`
- `routes/games.js`
- `routes/players.js`
- `routes/announcements.js`
- `services/reminders.js`
- `services/sms-webhook.js`
- `services/text-message-rotation.js`
- `services/youre-in-rotation.js`
- `text-message-categories.js`
- `game-logic.js`
- `utils/game-update.js`
- `public/dev.html`
- `public/create.html`
- `public/manage.html`
- `public/js/create.js`
- `public/js/manage-scripts.js`
- `public/js/invitation-generator.js`
- `public/js/slogans.js`
- `public/js/header.js`
- `public/js/footer.js`
- `scripts/capture-screens.js`
- Relevant unit, browser-smoke, and verification scripts.

Keep the final file split proportional to the repository. Do not move the entire Developer
Area inline script during this feature unless necessary for safe implementation.

## Implementation Phases

### Phase 1: Schema, Migration, And Core Resolver

- Add tables in both PostgreSQL and SQLite initialization paths.
- Add database access functions and exports.
- Seed Realist.
- Idempotently migrate the live 19 Slogans and 22 You're In messages.
- Implement normalization, ratio scheduling, no-repeat selection, rendering, and fallbacks.
- Add comprehensive unit tests before integrating a live surface.

### Phase 2: Developer Area

- Add the Message Randomizer tab.
- Build personality, ratio, surface, library, generation, targeting, and preview panels.
- Add authenticated APIs and validation.
- Keep generation manual and all generated messages in draft.
- Update browser smoke coverage and screen capture coverage.

### Phase 3: Site Slogans And You're In

- Route site slogans through the new resolver while preserving one slogan per page.
- Route You're In openings through the new resolver.
- Keep legacy assets as fallbacks.
- Verify the 41 migrated favorites are unchanged and selectable.

### Phase 4: Per-Game Personality And Invitations

- Add `personalityId` to game creation, update allowlists, local history, and management.
- Move invitation composition behind a host-authorized server endpoint.
- Add the personality opening while preserving all invitation details and instructions.
- Keep a client-side deterministic fallback if the endpoint fails.

### Phase 5: Remaining SMS Surfaces

- Integrate each SMS category through the shared resolver.
- Roll out one category at a time behind its surface toggle.
- Keep organizer-authored announcement bodies unchanged by default.
- Confirm telemetry and deterministic fallback before enabling the next category.

### Phase 6: Targeted Rules

- Add roster-based player selection.
- Implement exact-message precedence.
- Implement direction-based generation into target-specific draft inventory.
- Add audience and game-state matching.
- Add preview, expiry, and audit history.

### Phase 7: Invitee Tracking

- Add optional intended-invitee selection from the host roster.
- Persist invitees in game JSON.
- Expand known-game-audience matching.
- Clearly distinguish intended, copied, and actually delivered invitation states.

### Phase 8: Controlled Auto-Generation

- Enable background pool refills.
- Keep auto-publish off until reviewed output is consistently acceptable.
- Enable auto-publish per surface, starting with site slogans.
- Add alerting or Developer status warnings for low pools and repeated provider failures.

## Testing

### Unit Tests

- Exact preservation and idempotent migration of all 41 vetted messages.
- Personality normalization and single-default enforcement.
- Locked/fresh ratio behavior over short and long windows.
- Bucket fallback when locked or fresh inventory is empty.
- Per-recipient, per-game, and browser-exclusion no-repeat behavior.
- Target precedence and trigger/audience matching.
- Phone-based identity matching despite name changes.
- Token rendering and unsupported-token rejection.
- Generation response parsing, validation, deduplication, and safety rejection.
- Legacy fallback on database or generation failure.

### Integration And Browser Tests

- Developer tab loading, saving, filtering, previewing, and draft activation.
- Create and Manage personality selectors.
- One shared header/footer slogan.
- Invitation copy contains one personality opening and all deterministic details.
- You're In and other SMS categories preserve commands and details.
- Unauthorized callers cannot access prompts, inventory, or target rules.
- Existing game creation, joining, waitlist, cancellation, reminder, and SMS flows remain
  unchanged when a surface is disabled or the resolver falls back.

### Manual Verification

- Use local SQLite and `TEXTBELT_API_KEY=""`.
- Exercise Realist previews across all enabled surfaces.
- Verify Carter-style exact target and group-facing rules with fixture data.
- Force provider failure, empty pools, invalid candidates, and database read errors.
- Confirm no player-facing request waits on generation.
- Confirm mobile layouts in Create, Manage, and Developer Area.

## Rollout And Deployment

For every completed implementation phase:

1. Run focused tests.
2. Run `npm run verify:deploy`.
3. For user-visible phases, run `npm run docs`.
4. Run `npm run docs:publish -- --local` and verify `/dev.html` → Screens.
5. Restart the local server specifically on port 3002.
6. Confirm `/api/health` and exercise the changed behavior locally.
7. Commit on `main`, allowing the post-commit hook to push and trigger Render.
8. Wait for a new production start time.
9. Confirm production `/api/health` and the affected behavior.
10. Run `npm run docs:publish` after production is live and verify the new Screens
    publication time.

Rollout flags must allow disabling:

- The complete randomizer.
- Each personality.
- Each surface.
- Fresh-message selection.
- Auto-generation.
- Individual target rules.

## Acceptance Criteria

The Realist release is complete when:

- The exact 19 current slogans and 22 current You're In openings appear as locked, vetted
  favorites.
- The Realist description and guidance can be edited without a deployment.
- The configured locked/fresh ratio is honored and measurable.
- Immediate repeats are prevented for known recipients, games, and browsers.
- Generation failure never blocks a page load, invitation, or SMS.
- Operational details and reply instructions remain correct.
- Organizers can select an enabled personality per game.
- Site slogans, invitation openings, and enabled SMS surfaces use the shared resolver.
- Exact Carter-style rules can target the player, known game audience, or invitation copy.
- The product does not imply knowledge of copied-invitation recipients until invitees are
  explicitly tracked.
- Selection history identifies personality, surface, source bucket, and target-rule usage
  without exposing private player data publicly.
- Automated and manual deployment gates pass in local and production environments.

## Copy-Ready Implementation Prompt

```text
Implement the Message Randomizer plan in
docs/message-randomizer-implementation-plan.md.

Read AGENTS.md and the entire plan before changing anything. Work through the phases in
order, preserving existing behavior and using the repository's current abstractions instead
of building duplicate systems.

Important confirmed requirements:
- Implement only the Realist personality now, while keeping the architecture extensible.
- The 19 saved Slogans and 22 saved You're In messages are all owner-vetted Realist examples.
- Migrate the saved configurations, not just source-code defaults.
- Import all 41 as locked, vetted favorites and use them as generation style examples, while
  retaining their surface eligibility.
- Generate fresh messages ahead of player-facing requests; never make page loads or SMS sends
  wait for AI generation.
- Preserve deterministic dates, times, locations, roster state, links, cancellation reasons,
  reply commands, validation, legal, and consent copy.
- Let organizers select the enabled personality per game.
- Support a configurable locked/fresh ratio and no-repeat behavior.
- Target players by normalized phone-backed identity, not name alone.
- Support exact and direction-based target rules for the target, known game audience, and
  invitation copy.
- Do not claim to know copied-invitation recipients. Implement intended-invitee tracking
  before calling an audience “all invitees.”
- Keep legacy message systems as safe fallbacks during rollout.

Use a plan and implement autonomously. Inspect the current worktree first and preserve
unrelated user changes. Add tests alongside each layer. Complete all relevant phases unless
a genuine external credential or product decision blocks progress; if generation credentials
are absent, implement and test the provider adapter with a deterministic fake and leave live
generation safely disabled while completing the rest.

Follow the repository workflow after each completed user-visible change: run focused checks
and npm run verify:deploy, regenerate and locally publish Screens, restart only the IN or OUT
server on port 3002, exercise the behavior locally, commit on main, let the post-commit hook
deploy, verify the new production start and affected behavior, then publish and verify the
production Screens gallery.
```
