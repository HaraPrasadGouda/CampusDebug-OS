// Who may SEE a notice in the in-app list. The same targeting that decides
// push/SMS recipients (hostel block, or campus course/section/year) now also
// filters the list for students. Missing profile data fails OPEN (shows the
// notice) so nobody silently loses a notice because of an incomplete row.
const norm = (v) => String(v || '').trim().toLowerCase();
const blockKey = (v) => norm(v).replace(/^block\s*/, '');

export function noticeVisibleTo(notice, profile) {
  if (!notice || !profile) return true;
  if (notice.targetBlock) {
    if (norm(profile.resident_type) === 'dayscholar') return false;
    const mine = blockKey(profile.hostel_block);
    if (!mine) return true;
    return mine === blockKey(notice.targetBlock);
  }
  const cf = notice.campusFilter;
  if (notice.audience === 'campus' && cf && cf.mode && cf.mode !== 'ALL') {
    const wantCourse = String(cf.course || '').trim();
    if (wantCourse && profile.course && String(profile.course).trim() !== wantCourse) return false;
    if (cf.mode === 'COURSE_SECTION') {
      const want = String(cf.section || '').trim().toUpperCase();
      if (want && profile.section && String(profile.section).trim().toUpperCase() !== want) return false;
    }
    if (cf.mode === 'COURSE_YEAR') {
      const m = /^(\d{2})/.exec(String(profile.roll_number || ''));
      const want = parseInt(cf.year, 10);
      if (m && want && 2000 + parseInt(m[1], 10) !== want) return false;
    }
  }
  return true;
}
