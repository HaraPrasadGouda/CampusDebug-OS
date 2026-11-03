/**
 * Human-readable gate numbers.
 * Hostel gate passes already carry one (GP-123456). A day-scholar leave only
 * has its database id, so its number is DERIVED from that id — no new column:
 * "LV-" + the last 6 letters/digits of the id, upper-case (e.g. LV-3F9A2C).
 * The same function runs on the server and on every phone, so they always agree.
 */
export function leaveNumber(id) {
  const tail = String(id ?? '').replace(/[^A-Za-z0-9]/g, '').slice(-6).toUpperCase();
  return tail ? `LV-${tail}` : '';
}

// What the guard typed -> canonical form ("984163" / "gp984163" -> "GP-984163",
// "lv3f9a2c" -> "LV-3F9A2C"). Anything else is returned cleaned up as typed.
export function normalizePassNumber(input) {
  const raw = String(input ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (/^\d{6}$/.test(raw)) return `GP-${raw}`;
  if (/^GP-?\d{6}$/.test(raw)) return `GP-${raw.replace(/^GP-?/, '')}`;
  if (/^LV-?[A-Z0-9]{6}$/.test(raw)) return `LV-${raw.replace(/^LV-?/, '')}`;
  return raw;
}
