// Classifies an inbound SMS reply into the one thing the sender is asking for.
//
// Pure and synchronous on purpose: everything here is decidable from the message text and
// the saved conversation context, so it can be unit-tested without a database or an HTTP
// request. The dispatcher in services/sms-webhook.js acts on the result.
//
// Order matters and is preserved from the original inline chain: while a numbered
// selection is pending (the sender was just shown a list), ANY bare number - including
// "1", "2" and "9" - answers that list rather than acting as a top-level command.

/**
 * @param {string} messageText - the reply body, already trimmed by the caller or not
 * @param {string|null} lastCommand - saved conversation context ('details_selection',
 *   'cancellation_selection', or anything else previously stored), or null
 * @returns {{ type: string, index?: number, context?: string, text?: string }}
 *   type is one of: 'selection', 'management_links', 'game_details', 'cancellation',
 *   'other'. 'selection' carries the zero-based index and the context it answers.
 *   'other' carries the trimmed text for the custom reply option lookup.
 */
function parseSmsCommand(messageText, lastCommand) {
  const text = String(messageText == null ? '' : messageText).trim();

  if (/^\d+$/.test(text) && lastCommand) {
    return { type: 'selection', index: parseInt(text, 10) - 1, context: lastCommand };
  }
  if (text === '1') return { type: 'management_links' };
  if (text === '2') return { type: 'game_details' };
  if (text === '9') return { type: 'cancellation' };
  return { type: 'other', text };
}

module.exports = { parseSmsCommand };
