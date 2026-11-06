// One place that decides what a greeting calls someone ("Good morning, ___!").
// Skips honorifics (Dr., Prof., Mr., Mrs., Ms., Er. ...) and initials ("S.", "K.").
//   "Mitali Das" -> "Mitali"            "Dr. Mitali Das" -> "Mitali"
//   "Dr. S. K. Mohanty" -> "Dr. Mohanty" "S. K. Mohanty" -> "Mohanty"
//   "System Administrator" -> "System"   "" -> fallback
const HONORIFIC = /^(dr|prof|professor|mr|mrs|ms|miss|md|er|shri|smt)\.?$/i;
// "S", "S.", "S.K." -> initials (every dot-separated piece is one letter). "Om", "Ed" stay names.
const isInitial = (t) => t.split('.').filter(Boolean).every((p) => p.length === 1);

export function greetingName(fullName, fallback = 'there') {
  const tokens = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  let honorific = null;
  const rest = [];
  for (const t of tokens) {
    if (HONORIFIC.test(t) && rest.length === 0) { honorific = honorific || (t.replace(/\.$/, '') + '.'); continue; }
    rest.push(t);
  }
  const real = rest.filter((t) => !isInitial(t));
  if (!real.length) return fallback;
  const hadInitialBefore = rest.length && isInitial(rest[0]);
  if (real.length === 1 && hadInitialBefore) {
    // only a surname is left ("S. K. Mohanty"): keep the honorific so it reads "Dr. Mohanty"
    return honorific ? `${honorific} ${real[0]}` : real[0];
  }
  return real[0];
}
