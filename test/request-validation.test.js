// The field rules themselves, away from any route.
//
// The cases worth keeping are the ones that used to be accepted: "soon" as a duration became
// NaN, February 30th parsed into March, a negative player count created a game nobody could
// join, and a list sent as a string was read as an empty list.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  ValidationError,
  requiredText,
  optionalText,
  calendarDate,
  clockTime,
  wholeNumber,
  choice,
  usPhone,
  optionalUsPhone,
  list,
  objectBody,
  flag,
  hasField
} = require('../utils/request-validation');

/** Runs check and returns the message it refused with, or fails if it accepted. */
function refusal(check) {
  try {
    check();
  } catch (error) {
    assert.ok(error instanceof ValidationError, `expected a ValidationError, got ${error}`);
    assert.equal(error.code, 'REQUEST_VALIDATION');
    assert.equal(error.status, 400);
    return error.message;
  }
  assert.fail('expected the value to be refused');
}

describe('request validation: text', () => {
  it('trims what it accepts', () => {
    assert.equal(requiredText('  Grant Park  ', 'The court'), 'Grant Park');
    assert.equal(optionalText('  note  ', 'The note'), 'note');
  });

  it('treats blank and missing as absent', () => {
    assert.equal(refusal(() => requiredText('   ', 'The court')), 'The court is required.');
    assert.equal(refusal(() => requiredText(null, 'The court')), 'The court is required.');
    assert.equal(optionalText('   ', 'The note'), '');
    assert.equal(optionalText(null, 'The note'), '');
    assert.equal(optionalText(undefined, 'The name', { fallback: 'Organizer' }), 'Organizer');
  });

  it('accepts a number where text is expected, but not an object or a list', () => {
    assert.equal(requiredText(90, 'The value'), '90');
    assert.equal(refusal(() => requiredText({}, 'The court')), 'The court must be text.');
    assert.equal(refusal(() => requiredText(['a'], 'The court')), 'The court must be text.');
    assert.equal(refusal(() => optionalText(true, 'The note')), 'The note must be text.');
  });

  it('bounds the length', () => {
    assert.equal(
      refusal(() => requiredText('x'.repeat(201), 'The court', { max: 200 })),
      'The court can be up to 200 characters.'
    );
    assert.equal(optionalText('x'.repeat(200), 'The court', { max: 200 }).length, 200);
  });
});

describe('request validation: calendar dates', () => {
  it('accepts a real date and hands it back unchanged', () => {
    assert.equal(calendarDate('2026-08-21', 'The game date'), '2026-08-21');
    assert.equal(calendarDate(' 2028-02-29 ', 'The game date'), '2028-02-29');
  });

  it('refuses a date that does not exist', () => {
    assert.equal(
      refusal(() => calendarDate('2026-02-30', 'The game date')),
      'The game date is not a real date.'
    );
    assert.equal(
      refusal(() => calendarDate('2027-02-29', 'The game date')),
      'The game date is not a real date.'
    );
    assert.equal(
      refusal(() => calendarDate('2026-13-01', 'The game date')),
      'The game date is not a real date.'
    );
  });

  it('refuses anything that is not YYYY-MM-DD', () => {
    const expected = 'The game date must be a date like 2026-08-21.';
    assert.equal(refusal(() => calendarDate('21/08/2026', 'The game date')), expected);
    assert.equal(refusal(() => calendarDate('next tuesday', 'The game date')), expected);
    assert.equal(refusal(() => calendarDate('2026-8-1', 'The game date')), expected);
    assert.equal(
      refusal(() => calendarDate('', 'The game date')),
      'The game date is required.'
    );
  });
});

describe('request validation: clock times', () => {
  it('accepts a 24-hour time and drops any seconds', () => {
    assert.equal(clockTime('18:30', 'The start time'), '18:30');
    assert.equal(clockTime('00:00', 'The start time'), '00:00');
    assert.equal(clockTime('23:59', 'The start time'), '23:59');
    assert.equal(clockTime('18:30:45', 'The start time'), '18:30');
  });

  it('refuses a time no clock shows', () => {
    const expected = 'The start time must be a time like 18:30.';
    assert.equal(refusal(() => clockTime('24:00', 'The start time')), expected);
    assert.equal(refusal(() => clockTime('18:60', 'The start time')), expected);
    assert.equal(refusal(() => clockTime('7:30', 'The start time')), expected);
    assert.equal(refusal(() => clockTime('6pm', 'The start time')), expected);
  });
});

describe('request validation: whole numbers', () => {
  it('accepts a number or the string a form field sends', () => {
    assert.equal(wholeNumber(90, 'The duration'), 90);
    assert.equal(wholeNumber('90', 'The duration'), 90);
    assert.equal(wholeNumber(' 90 ', 'The duration'), 90);
    assert.equal(wholeNumber(0, 'The count', { min: 0 }), 0);
  });

  it('refuses what parseInt used to turn into NaN or a half number', () => {
    assert.equal(
      refusal(() => wholeNumber('soon', 'The duration')),
      'The duration must be a whole number.'
    );
    assert.equal(
      refusal(() => wholeNumber('90 minutes', 'The duration')),
      'The duration must be a whole number.'
    );
    assert.equal(
      refusal(() => wholeNumber('9.5', 'The duration')),
      'The duration must be a whole number.'
    );
    assert.equal(refusal(() => wholeNumber('', 'The duration')), 'The duration is required.');
    assert.equal(refusal(() => wholeNumber(null, 'The duration')), 'The duration is required.');
    assert.equal(refusal(() => wholeNumber(true, 'The duration')), 'The duration must be a number.');
    assert.equal(refusal(() => wholeNumber([90], 'The duration')), 'The duration must be a number.');
  });

  it('reports the range it wanted', () => {
    assert.equal(
      refusal(() => wholeNumber(-4, 'The player count', { min: 1, max: 100 })),
      'The player count must be between 1 and 100.'
    );
    assert.equal(
      refusal(() => wholeNumber(500, 'The player count', { min: 1, max: 100 })),
      'The player count must be between 1 and 100.'
    );
    assert.equal(
      refusal(() => wholeNumber(0, 'The count', { min: 1 })),
      'The count must be at least 1.'
    );
    assert.equal(
      refusal(() => wholeNumber(9, 'The count', { max: 5 })),
      'The count can be at most 5.'
    );
  });
});

describe('request validation: choices, lists and shapes', () => {
  it('holds a value to its allowed set', () => {
    assert.equal(choice('waitlist', 'The registration mode', ['fcfs', 'waitlist']), 'waitlist');
    assert.equal(choice(' fcfs ', 'The registration mode', ['fcfs', 'waitlist']), 'fcfs');
    assert.equal(
      refusal(() => choice('anything', 'The registration mode', ['fcfs', 'waitlist'])),
      'The registration mode must be one of: fcfs, waitlist.'
    );
  });

  it('refuses a list that is not one, however plausible its length looks', () => {
    assert.deepEqual(list(['a', 'b'], 'The recipients'), ['a', 'b']);
    assert.deepEqual(list([], 'The recipients'), []);
    // 'abc'.length is 3, which is why the old `!recipients || recipients.length === 0`
    // guard let a string through and then iterated it character by character.
    assert.equal(refusal(() => list('abc', 'The recipients')), 'The recipients must be a list.');
    assert.equal(refusal(() => list({ 0: 'a' }, 'The recipients')), 'The recipients must be a list.');
    assert.equal(
      refusal(() => list([], 'The recipients', { min: 1 })),
      'The recipients needs at least one entry.'
    );
    assert.equal(
      refusal(() => list(['a', 'b', 'c'], 'The recipients', { max: 2 })),
      'The recipients can contain up to 2 entries.'
    );
  });

  it('insists a body is an object', () => {
    assert.deepEqual(objectBody({ a: 1 }), { a: 1 });
    assert.equal(refusal(() => objectBody(null)), 'The request body must be a JSON object.');
    assert.equal(refusal(() => objectBody('a string')), 'The request body must be a JSON object.');
    assert.equal(refusal(() => objectBody([])), 'The request body must be a JSON object.');
  });

  it('reads a checkbox the way both an HTML form and a JSON client send it', () => {
    assert.equal(flag(true), true);
    assert.equal(flag('true'), true);
    assert.equal(flag('on'), true);
    assert.equal(flag(false), false);
    assert.equal(flag('false'), false);
    assert.equal(flag(undefined), false);
  });

  it('tells a field that was sent empty from one that was never sent', () => {
    assert.equal(hasField({ message: '' }, 'message'), true);
    assert.equal(hasField({}, 'message'), false);
    assert.equal(hasField(null, 'message'), false);
  });
});

describe('request validation: phone numbers', () => {
  it('uses the app’s one phone rule and stores the ten digits', () => {
    assert.equal(usPhone('(312) 555-0101', 'The phone number'), '3125550101');
    assert.equal(usPhone('1-312-555-0101', 'The phone number'), '3125550101');
    assert.equal(optionalUsPhone('', 'The phone number'), '');
    assert.equal(optionalUsPhone(null, 'The phone number'), '');
  });

  it('refuses a number Textbelt could not deliver to', () => {
    assert.equal(
      refusal(() => usPhone('312555', 'The phone number')),
      'The phone number must be a valid US phone number — for example 555-123-4567.'
    );
    assert.equal(refusal(() => usPhone('', 'The phone number')).length > 0, true);
    assert.equal(refusal(() => optionalUsPhone('12345678901234', 'The phone number')).length > 0, true);
  });

  it('lets a caller keep the wording a page already shows', () => {
    assert.equal(
      refusal(() => usPhone('nope', 'A phone number', { message: 'A 10-digit phone number is required.' })),
      'A 10-digit phone number is required.'
    );
  });
});
