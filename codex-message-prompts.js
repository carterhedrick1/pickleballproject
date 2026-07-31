const DEFAULT_CODEX_PROMPT_SECTIONS = Object.freeze([
  `Help me build 20 new, owner-approved Realist messages for the "{{CATEGORY_NAME}}" category ({{CATEGORY_ID}}) in IN or OUT's Message Randomizer.`,
  `Category purpose: {{CATEGORY_PURPOSE}}
Allowed template tokens: {{ALLOWED_TOKENS}}
Maximum length: {{MAX_LENGTH}} characters.`,
  `Use the existing Realist personality and the current vetted messages in the repository as the style source. Keep every idea short, direct, dryly funny, and appropriate for this category.`,
  `Preserve all operational facts and instructions. Do not invent player facts, dates, times, locations, roster states, links, or reply commands.`,
  `Work in two phases.`,
  `Brainstorming And Selection:
1. Inspect the repository's current Realist messages, this category's implementation, and its validation and safety rules. Do not change any files yet.
2. Generate 50 distinct candidate messages themed around the "{{CATEGORY_NAME}}" experience.
3. Number them 1 through 50 so I can reply with the numbers I like.
4. Wait for my selections. Keep an exact running shortlist and tell me how many of the 20 slots are filled.
5. If fewer than 20 are selected, generate a smaller follow-up batch based on the tone and patterns I chose. Continue numbering at 51 so references never become ambiguous.
6. Repeat the selection process until exactly 20 messages are approved.
7. Do not change the app until I explicitly say, "Please add them."`,
  `Implementation After I Say "Please Add Them":
1. Add exactly the 20 approved messages to the Realist "{{CATEGORY_NAME}}" category as manual drafts. Preserve all existing messages.
2. Do not activate, lock, vet, archive, replace, or delete messages unless I explicitly request it.
3. Use an idempotent one-time migration so deployment adds the drafts once without duplicating them or recreating messages I later edit.
4. Add automated coverage confirming the approved count, normalized uniqueness, category length limit, allowed tokens, and safety validation.
5. Follow the repository's AGENTS.md workflow completely: run targeted checks and npm run verify:deploy; regenerate Screens with npm run docs; publish and verify Screens locally; restart only the confirmed IN or OUT server on port 3002; verify local health and the affected Developer UI; commit on main so the automatic push and Render deployment run; wait for a new production start time; verify production health and all approved drafts through the authenticated Developer API; publish Screens to production; and confirm the refreshed publication time and Actual Screens gallery.
6. Preserve unrelated work and report the commit, test results, deployment result, production draft count, and whether the messages remain inactive.`,
  `During brainstorming, keep responses focused on the numbered candidates and running shortlist.`,
  `Begin with the 50 candidates now.`
]);

const CODEX_PROMPT_PLACEHOLDERS = Object.freeze([
  { token: '{{CATEGORY_NAME}}', description: 'Message category name' },
  { token: '{{CATEGORY_ID}}', description: 'Message category ID' },
  { token: '{{CATEGORY_PURPOSE}}', description: 'Message category purpose' },
  { token: '{{ALLOWED_TOKENS}}', description: 'Allowed message template tokens' },
  { token: '{{MAX_LENGTH}}', description: 'Maximum message length' }
]);

function renderCodexPromptSections(sections, surface) {
  const values = {
    CATEGORY_NAME: surface?.name || 'Selected Message Category',
    CATEGORY_ID: surface?.id || 'selected-category',
    CATEGORY_PURPOSE: surface?.purpose || 'Use the selected category’s communication goal.',
    ALLOWED_TOKENS: surface?.allowedTokens?.length
      ? surface.allowedTokens.map((token) => `{${token}}`).join(', ')
      : 'None',
    MAX_LENGTH: surface?.maxLength || 240
  };
  return sections.map((section) => String(section).replace(
    /\{\{(CATEGORY_NAME|CATEGORY_ID|CATEGORY_PURPOSE|ALLOWED_TOKENS|MAX_LENGTH)\}\}/g,
    (_match, key) => String(values[key])
  ));
}

function buildNumberedCodexPrompt(sections, surface) {
  return renderCodexPromptSections(sections, surface)
    .map((section, index) => `Paragraph ${index + 1}:\n${section}`)
    .join('\n\n');
}

module.exports = {
  DEFAULT_CODEX_PROMPT_SECTIONS,
  CODEX_PROMPT_PLACEHOLDERS,
  renderCodexPromptSections,
  buildNumberedCodexPrompt
};
