import test from 'node:test';
import assert from 'node:assert/strict';
import { noticeVisibleTo } from '../noticeAudience.js';

const host = { resident_type: 'hosteller', hostel_block: 'Block A', course: 'BTech CSE', section: 'A', roll_number: '2301165000' };
const day = { ...host, resident_type: 'dayscholar' };

test('broadcast notice is visible to everyone', () => {
  assert.equal(noticeVisibleTo({ title: 'x' }, host), true);
  assert.equal(noticeVisibleTo({ title: 'x' }, day), true);
});
test('block notice: same block hosteller only', () => {
  const n = { targetBlock: 'A' };
  assert.equal(noticeVisibleTo(n, host), true);
  assert.equal(noticeVisibleTo(n, { ...host, hostel_block: 'Block B' }), false);
  assert.equal(noticeVisibleTo(n, day), false);
});
test('campus filters: course, section, year', () => {
  assert.equal(noticeVisibleTo({ audience: 'campus', campusFilter: { mode: 'COURSE', course: 'BTech CSE' } }, day), true);
  assert.equal(noticeVisibleTo({ audience: 'campus', campusFilter: { mode: 'COURSE', course: 'BTech ME' } }, host), false);
  assert.equal(noticeVisibleTo({ audience: 'campus', campusFilter: { mode: 'COURSE_SECTION', course: 'BTech CSE', section: 'B' } }, host), false);
  assert.equal(noticeVisibleTo({ audience: 'campus', campusFilter: { mode: 'COURSE_YEAR', course: 'BTech CSE', year: 2023 } }, host), true);
  assert.equal(noticeVisibleTo({ audience: 'campus', campusFilter: { mode: 'COURSE_YEAR', course: 'BTech CSE', year: 2024 } }, host), false);
});
test('missing profile fails open', () => {
  assert.equal(noticeVisibleTo({ targetBlock: 'A' }, null), true);
  assert.equal(noticeVisibleTo({ targetBlock: 'A' }, { resident_type: 'hosteller' }), true);
});
