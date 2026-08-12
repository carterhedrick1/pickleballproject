const test = require('node:test');
const assert = require('node:assert/strict');

const slogans = require('../public/js/slogans');

test('ships the requested slogan and name rotation', () => {
  assert.equal(slogans.DEFAULT_SLOGANS.length, 18);
  assert.deepEqual(slogans.DEFAULT_NAMES, ['Scott', 'Mike', 'Brett', 'Zac']);
  assert.equal(
    slogans.DEFAULT_SLOGANS[14],
    'Availability beats ability. Ask {NAME}.'
  );
  assert.equal(
    slogans.DEFAULT_SLOGANS[17],
    'Ignore this and you will be paddle-stacking at The Y next time.'
  );
});

test('replaces every name placeholder using the rotating name list', () => {
  const sequence = [0, 0.75];
  const selected = slogans.choose(
    {
      slogans: ['Ask {NAME}. Then ask {NAME} again.'],
      names: ['Scott', 'Mike', 'Brett', 'Zac']
    },
    () => sequence.shift()
  );

  assert.equal(selected, 'Ask Zac. Then ask Zac again.');
});

test('normalizes editable values and falls back when a list is empty', () => {
  assert.deepEqual(
    slogans.normalizeConfig({
      slogans: ['  First  ', 'First', '', 'Second'],
      names: []
    }),
    {
      slogans: ['First', 'Second'],
      names: ['Scott', 'Mike', 'Brett', 'Zac']
    }
  );
});
