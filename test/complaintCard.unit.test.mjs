import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OVERDUE_AFTER_HOURS, overdueState, isComplaintDone, complaintPlace,
  wardenCardFields, openComplaintClusters,
} from '../src/utils/complaintCard.js';

const H = 3600 * 1000;
const T0 = Date.parse('2026-11-10T06:00:00.000Z');
const assigned = (hoursAgo, extra = {}) => ({
  id: 'abc12345-0000', status: 'ASSIGNED', assignedAt: new Date(T0 - hoursAgo * H).toISOString(), ...extra,
});

test('overdue rule: 12 hours after assignment, not before', () => {
  assert.equal(OVERDUE_AFTER_HOURS, 12);
  assert.equal(overdueState(assigned(11.9), T0).overdue, false);
  assert.equal(overdueState(assigned(12), T0).overdue, true);
  assert.equal(overdueState(assigned(30), T0).overdue, true);
  assert.ok(Math.abs(overdueState(assigned(3), T0).hours - 3) < 1e-9);
});

test('overdue rule: resolved by the student, closed, or resolved status never flags', () => {
  assert.equal(overdueState(assigned(20, { studentResolvedAt: '2026-11-10T01:00:00.000Z' }), T0).overdue, false);
  assert.equal(overdueState(assigned(20, { closedAt: '2026-11-10T01:00:00.000Z' }), T0).overdue, false);
  assert.equal(overdueState(assigned(20, { status: 'RESOLVED' }), T0).overdue, false);
  assert.equal(overdueState(assigned(20, { status: 'CLOSED' }), T0).overdue, false);
  assert.equal(isComplaintDone({ student_resolved_at: 'x' }), true);
});

test('overdue rule: not assigned yet (no assignment time) never flags', () => {
  assert.equal(overdueState({ id: 'x', status: 'PENDING' }, T0).overdue, false);
  assert.equal(overdueState({ id: 'x', status: 'PENDING', assignedAt: 'not-a-date' }, T0).overdue, false);
});

test('block and room are read from the student location, never invented', () => {
  assert.deepEqual(complaintPlace('Hostel Block B, Room 101'), { block: 'Block B', room: '101' });
  assert.deepEqual(complaintPlace('Hostel Block B, Room 207'), { block: 'Block B', room: '207' });
  assert.deepEqual(complaintPlace('Hostel C, Room 12'), { block: 'Block C', room: '12' });
  assert.deepEqual(complaintPlace('Library'), { block: '', room: '' });
  assert.deepEqual(complaintPlace(undefined), { block: '', room: '' });
});

test('warden card data: category, technician name and role, block and room, problem text, overdue flag', () => {
  const t = assigned(13, {
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
  assert.equal(typeof card.assignedAt, 'number');
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
