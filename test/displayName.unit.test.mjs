import test from 'node:test';
import assert from 'node:assert/strict';
import { greetingName } from '../src/utils/displayName.js';

const cases = [
  ['Dr. S. K. Mohanty', 'Dr. Mohanty'],
  ['Mitali Das', 'Mitali'],
  ['Dr. Mitali Das', 'Mitali'],
  ['Dr. Mitali Bose', 'Mitali'],
  ['S. K. Mohanty', 'Mohanty'],
  ['SK Mohanty', 'SK'],
  ['Prof. S.K. Mohanty', 'Prof. Mohanty'],
  ['Mr. Subrat Kumar Panda', 'Subrat'],
  ['Er. A. Das', 'Er. Das'],
  ['Mrs. Priya', 'Priya'],
  ['System Administrator', 'System'],
  ['Rakesh Kumar Behera', 'Rakesh'],
  ['  Ananya   Mishra ', 'Ananya'],
  ['Om Prakash', 'Om'],
];
for (const [input, want] of cases) {
  test(`greetingName(${JSON.stringify(input)}) -> ${want}`, () => assert.equal(greetingName(input), want));
}
test('empty / only honorific or initials -> fallback', () => {
  assert.equal(greetingName('', 'Warden'), 'Warden');
  assert.equal(greetingName(undefined, 'Teacher'), 'Teacher');
  assert.equal(greetingName(null), 'there');
  assert.equal(greetingName('Dr.', 'Warden'), 'Warden');
  assert.equal(greetingName('S. K.', 'Student'), 'Student');
});
