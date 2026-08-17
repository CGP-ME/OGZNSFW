// Safety gates. These are hard rules, enforced in code, tested in tests/.
// Platform policy: fictional consenting adults only.
//
// Known limitation (documented, not hidden): checkText is keyword/pattern
// based. It reliably blocks explicit violations but is not semantic
// moderation; a model-based moderation pass is a later milestone. Fail-closed
// wording is preferred: ambiguous age references are rejected.

const MINOR_PATTERNS = [
  /\b(child|children|kid|kids|minor|minors|underage|under-age|preteen|pre-teen|loli|shota)\b/i,
  /\b(teen|teenager|teenaged|schoolgirl|schoolboy|high[ -]?school|middle[ -]?school)\b/i,
  /\b(1[0-7]|[0-9])[ -]?(years?[ -]?old|yo|y\/o)\b/i,
  /\bage(?:d)?\s*(?:is|:)?\s*(1[0-7]|[0-9])\b/i,
  /\b(barely|just turned)\s*(legal|18)\b/i,
];

const NONCONSENT_PATTERNS = [
  /\b(rape|raping|raped|non[ -]?con(sensual)?|noncon)\b/i,
  /\b(forced?|forcing)\s+(her|him|them|sex|against)\b/i,
  /\bagainst\s+(her|his|their)\s+will\b/i,
  /\b(drugged|unconscious|sleeping|passed[ -]?out|blackmail(ed)?|coerced?)\b.*\b(sex|sexual|touch|fuck)\b/i,
  /\b(sex|sexual|touch|fuck)\b.*\b(drugged|unconscious|sleeping|passed[ -]?out|blackmail(ed)?|coerced?)\b/i,
];

const REAL_PERSON_PATTERNS = [
  /\b(real|actual)\s+(person|people|woman|man|girl|boy)\b/i,
  /\b(celebrity|celeb|actress|actor|influencer|streamer|singer|idol)\b/i,
  /\b(look|looks|looking)\s+(exactly\s+)?like\s+(the\s+)?(famous|celebrity|actress|actor|real)\b/i,
  /\bdeepfake\b/i,
  /\bmy\s+(ex|neighbor|neighbour|coworker|co-worker|classmate|teacher|boss|friend'?s?\s+(mom|mum|sister|wife|girlfriend))\b/i,
];

function matchAny(text, patterns) {
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[0];
  }
  return null;
}

// Check free text (chat messages, image prompts). Returns { allowed, category, match }.
export function checkText(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { allowed: false, category: 'empty', match: null };
  }
  let match = matchAny(text, MINOR_PATTERNS);
  if (match) return { allowed: false, category: 'minor_or_ambiguous_age', match };
  match = matchAny(text, NONCONSENT_PATTERNS);
  if (match) return { allowed: false, category: 'nonconsensual', match };
  match = matchAny(text, REAL_PERSON_PATTERNS);
  if (match) return { allowed: false, category: 'real_person_likeness', match };
  return { allowed: true, category: null, match: null };
}

// Validate a character record at create/update time. Fail closed: age must be
// an explicit integer >= 18 and the record must declare itself fictional.
export function checkCharacter(record) {
  const errors = [];
  const age = record?.identity?.age;
  if (!Number.isInteger(age)) errors.push('identity.age must be an explicit integer (no ambiguous age)');
  else if (age < 18) errors.push('identity.age must be 18 or older');
  if (record?.identity?.fictional !== true) errors.push('identity.fictional must be true (fictional characters only)');
  if (record?.identity?.basedOnRealPerson) errors.push('characters must not be based on a real person');
  const textFields = JSON.stringify([record?.identity?.name, record?.appearance, record?.personality, record?.speakingStyle]);
  const minorHit = matchAny(textFields, MINOR_PATTERNS);
  if (minorHit) errors.push(`character text contains blocked age-related term: "${minorHit}"`);
  const realHit = matchAny(textFields, REAL_PERSON_PATTERNS);
  if (realHit) errors.push(`character text contains real-person likeness term: "${realHit}"`);
  return { allowed: errors.length === 0, errors };
}
