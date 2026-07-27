const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { formatDateForSMS } = require('../utils/sms-format');

function formatDateInTimeZone(date, timeZone) {
  const script = [
    `const { formatDateForSMS } = require(${JSON.stringify(require.resolve('../utils/sms-format'))});`,
    `process.stdout.write(formatDateForSMS(${JSON.stringify(date)}));`
  ].join('');

  return execFileSync(process.execPath, ['-e', script], {
    env: { ...process.env, TZ: timeZone },
    encoding: 'utf8'
  });
}

describe('SMS formatting', () => {
  it('keeps a game calendar date unchanged in every server time zone', () => {
    assert.equal(formatDateForSMS('2026-07-28'), 'Tue, Jul 28');
    assert.equal(formatDateInTimeZone('2026-07-28', 'America/Chicago'), 'Tue, Jul 28');
    assert.equal(formatDateInTimeZone('2026-07-28', 'America/Los_Angeles'), 'Tue, Jul 28');
    assert.equal(formatDateInTimeZone('2026-07-28', 'Asia/Tokyo'), 'Tue, Jul 28');
  });
});
