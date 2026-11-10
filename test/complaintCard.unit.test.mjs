import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OVERDUE_AFTER_HOURS, overdueState, isComplaintDone, complaintPlace, filedAtMs,
  shouldSendOverduePush, overduePushPayload, wardenCardFields, openComplaintClusters,
  ADMIN_ESCALATE_AFTER_HOURS, adminEscalationState,
} from '../src/utils/complaintCard.js';

const H = 3600 * 1000;
const T0 = Date.parse('2026-11-10T06:00:00.000Z');
// A complaint the student filed `filedHoursAgo` hours before T0. The 12-hour
// clock is the filing time (created_at), not the assignment.
const filed = (filedHoursAgo, extra = {}) => ({
  id: 'abc12345-0000', status: 'ASSIGNED', created_at: new Date(T0 - filedHoursAgo * H).toISOString(), ...extra,
});

test('overdue rule: 12 hours after the student filed the complaint, not before', () => {
  assert.equal(OVERDUE_AFTER_HOURS, 12);
  assert.equal(overdueState(filed(11.9), T0).overdue, false);
  assert.equal(overdueState(filed(12), T0).overdue, true);
  assert.equal(overdueState(filed(30), T0).overdue, true);
  assert.ok(Math.abs(overdueState(filed(3), T0).hours - 3) < 1e-9);
});

test('overdue rule: the clock starts at filing, not at assignment', () => {
  // Filed 13 h ago, assigned 1 h ago: overdue (assignment does not reset it).
  const late = filed(13, { assignedAt: new Date(T0 - 1 * H).toISOString() });
  assert.equal(overdueState(late, T0).overdue, true);
  // Filed 2 h ago, assigned 13 h ago (impossible in practice, but the clock is still filing): not overdue.
  const early = filed(2, { assignedAt: new Date(T0 - 13 * H).toISOString() });
  assert.equal(overdueState(early, T0).overdue, false);
});

test('admin escalation rule: 48 hours after the student filed it, filing clock only', () => {
  assert.equal(ADMIN_ESCALATE_AFTER_HOURS, 48);
  assert.equal(adminEscalationState(filed(47.9), T0).escalated, false);
  assert.equal(adminEscalationState(filed(48), T0).escalated, true);
  assert.ok(Math.abs(adminEscalationState(filed(50), T0).hours - 50) < 1e-9);
  // Assigned just now but filed 49 h ago: escalated (assignment does not reset the clock).
  assert.equal(adminEscalationState(filed(49, { assignedAt: new Date(T0 - 0.5 * H).toISOString() }), T0).escalated, true);
  // Resolved or closed never escalates; no filing time never escalates.
  assert.equal(adminEscalationState(filed(60, { student_resolved_at: 'x' }), T0).escalated, false);
  assert.equal(adminEscalationState(filed(60, { status: 'CLOSED' }), T0).escalated, false);
  assert.equal(adminEscalationState({ id: 'x', status: 'ASSIGNED' }, T0).escalated, false);
});

test('filing time reads the row field, and the camel-case fields the UI uses', () => {
  assert.equal(filedAtMs({ created_at: '2026-11-10T00:00:00.000Z' }), Date.parse('2026-11-10T00:00:00.000Z'));
  assert.equal(filedAtMs({ reportedAt: '2026-11-10T00:00:00.000Z' }), Date.parse('2026-11-10T00:00:00.000Z'));
  assert.equal(filedAtMs({ createdAtMs: 123 }), 123);
  assert.equal(filedAtMs({ status: 'ASSIGNED' }), null);
  assert.equal(overdueState({ status: 'ASSIGNED', assignedAt: '2026-11-09T00:00:00.000Z' }, T0).overdue, false);
});

test('once-only warden push: fires the first time a filed complaint crosses 12 hours, never again', () => {
  assert.equal(shouldSendOverduePush(filed(11.5), null, T0), false, 'not yet at 11.5 h');
  assert.equal(shouldSendOverduePush(filed(12), null, T0), true, 'first crossing at 12 h');
  assert.equal(shouldSendOverduePush(filed(30), '2026-11-10T05:00:00.000Z', T0), false, 'already pushed');
  assert.equal(shouldSendOverduePush(filed(30, { student_resolved_at: 'x' }), null, T0), false, 'resolved never pushes');
  assert.equal(shouldSendOverduePush(filed(30, { status: 'CLOSED' }), null, T0), false, 'closed never pushes');
});

test('warden push text names the block and room, carries no phone number', () => {
  const p = overduePushPayload(filed(13, { category: 'Electrical', location: 'Hostel Block B, Room 207', technician: { phone: '+919999900001' } }));
  assert.match(p.title, /12h passed: Electrical not resolved/);
  assert.match(p.body, /Block B, Room 207/);
  assert.doesNotMatch(JSON.stringify(p), /9999900001/);
});

test('overdue rule: resolved by the student, closed, or resolved status never flags', () => {
  assert.equal(overdueState(filed(20, { studentResolvedAt: '2026-11-10T01:00:00.000Z' }), T0).overdue, false);
  assert.equal(overdueState(filed(20, { closedAt: '2026-11-10T01:00:00.000Z' }), T0).overdue, false);
  assert.equal(overdueState(filed(20, { status: 'RESOLVED' }), T0).overdue, false);
  assert.equal(overdueState(filed(20, { status: 'CLOSED' }), T0).overdue, false);
  assert.equal(isComplaintDone({ student_resolved_at: 'x' }), true);
});

test('overdue rule: no readable filing time never flags', () => {
  assert.equal(overdueState({ id: 'x', status: 'PENDING' }, T0).overdue, false);
  assert.equal(overdueState({ id: 'x', status: 'PENDING', created_at: 'not-a-date' }, T0).overdue, false);
});

test('block and room are read from the student location, never invented', () => {
  assert.deepEqual(complaintPlace('Hostel Block B, Room 101'), { block: 'Block B', room: '101' });
  assert.deepEqual(complaintPlace('Hostel Block B, Room 207'), { block: 'Block B', room: '207' });
  assert.deepEqual(complaintPlace('Hostel C, Room 12'), { block: 'Block C', room: '12' });
  assert.deepEqual(complaintPlace('Library'), { block: '', room: '' });
  assert.deepEqual(complaintPlace(undefined), { block: '', room: '' });
});

test('warden card data: category, technician name and role, block and room, problem text, overdue flag', () => {
  const t = filed(13, {
    category: 'Electrical',
    location: 'Hostel Block B, Room 207',
    description: 'Fan not working since morning',
    assignedTo: 'Ramesh',
    technician: { id: 'tech-1', name: 'Ramesh Sahu', role: 'Electrician', phone: '+919999900001' },
  });
  const card = wardenCardFields(t, T0);
  assert.equal(card.category, 'Electrical');
  assert.equal(card.technicianName, 'Ramesh Sahu');
  assert.equal(card.technicianRole, 'Electrician');
  assert.equal(card.technicianPhone, '+919999900001');
  assert.equal(card.block, 'Block B');
  assert.equal(card.room, '207');
  assert.equal(card.problem, 'Fan not working since morning');
  assert.equal(card.overdue, true);
  assert.equal(typeof card.filedAt, 'number');
});

test('warden card data: falls back to the assigned name when no technician object', () => {
  const card = wardenCardFields({ id: 'z', category: 'Plumbing', location: 'Hostel Block A, Room 3', raw_text: 'Tap leaking', assignedTo: 'Biju' }, T0);
  assert.equal(card.technicianName, 'Biju');
  assert.equal(card.technicianPhone, null);
  assert.equal(card.problem, 'Tap leaking');
  assert.equal(card.overdue, false);
});

test('cluster view: open complaints grouped by category + block, count, biggest first', () => {
  const tickets = [
    { id: 1, category: 'Electrical', location: 'Hostel Block B, Room 101' },
    { id: 2, category: 'electrical', location: 'Hostel Block B, Room 207' },
    { id: 3, category: 'Electrical', location: 'Hostel Block B, Room 301', status: 'RESOLVED' },
    { id: 4, category: 'Plumbing', location: 'Hostel Block B, Room 110' },
    { id: 5, category: 'Plumbing', location: 'Hostel Block A, Room 9' },
    { id: 6, category: 'Plumbing', location: 'Hostel Block A, Room 10' },
    { id: 7, category: 'Plumbing', location: 'Hostel Block A, Room 11' },
    { id: 8, category: 'Electrical', location: 'Library' },
    { id: 9, category: 'Electrical', location: 'Library' },
  ];
  const groups = openComplaintClusters(tickets);
  assert.deepEqual(groups.map(g => [g.category.toLowerCase(), g.block, g.count]), [
    ['plumbing', 'Block A', 3],
    ['electrical', 'Block B', 2],
  ]);
  assert.deepEqual(groups[1].ids, ['1', '2']);
});

test('cluster view: a single open complaint is not a cluster', () => {
  assert.deepEqual(openComplaintClusters([{ id: 1, category: 'Electrical', location: 'Hostel Block B, Room 1' }]), []);
});
