// Pure helpers that turn the loose way people write dates, names and statuses
// into values that can be compared with Jira fields. No Forge imports here, so
// everything in src/engine can be unit-tested with plain Node.

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

const DATE_PATTERNS = [
  // 2026-12-03, 2026/12/03, 2026.12.03
  {
    style: 'iso',
    re: /(?<![\d-])(\d{4})([-/.])(\d{1,2})\2(\d{1,2})(?![\d-])/g,
    read: (m) => ({ year: +m[1], month: +m[3], day: +m[4], sep: m[2] }),
  },
  // 2026년 12월 3일, 12월 3일
  {
    style: 'kr',
    re: /(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일/g,
    read: (m) => ({ year: m[1] ? +m[1] : null, month: +m[2], day: +m[3] }),
  },
  // Dec 3, December 3rd, Dec. 3, 2026
  {
    style: 'mdy',
    re: new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?(?![\\d:])`, 'gi'),
    read: (m) => ({ year: m[3] ? +m[3] : null, month: MONTHS[m[1].toLowerCase()], day: +m[2], long: m[1].length > 4 }),
  },
  // 3 Dec, 3rd December 2026
  {
    style: 'dmy',
    re: new RegExp(`(?<![\\d.:/-])(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}\\.?(?:,?\\s+(\\d{4}))?(?!\\d)`, 'gi'),
    read: (m) => ({ year: m[3] ? +m[3] : null, month: MONTHS[m[2].toLowerCase()], day: +m[1], long: m[2].length > 4 }),
  },
  // 12/3, 12/03/2026, 23/12/2026. Two-part numbers are only dates when
  // unambiguous or flagged ambiguous for the caller to treat as unverifiable.
  {
    style: 'num',
    re: /(?<![\d./-])(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?(?![\d/])/g,
    read: (m) => {
      const a = +m[1];
      const b = +m[2];
      let year = m[3] ? +m[3] : null;
      if (year !== null && year < 100) year += 2000;
      if (a > 12 && b <= 12) return { year, month: b, day: a, order: 'dm' };
      if (b > 12 && a <= 12) return { year, month: a, day: b, order: 'md' };
      return { year, month: a, day: b, order: 'md', ambiguous: true };
    },
  },
];

function validDate(d) {
  return d.month >= 1 && d.month <= 12 && d.day >= 1 && d.day <= 31
    && (d.year === null || (d.year >= 1990 && d.year <= 2100));
}

/** Find every date written in `text`. Returns spans sorted by position, never overlapping. */
export function findDates(text) {
  const found = [];
  for (const p of DATE_PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(text)) !== null) {
      const d = p.read(m);
      if (!validDate(d)) continue;
      found.push({ ...d, style: p.style, raw: m[0], index: m.index, end: m.index + m[0].length });
    }
  }
  found.sort((x, y) => x.index - y.index || y.raw.length - x.raw.length);
  const out = [];
  for (const f of found) {
    if (out.length && f.index < out[out.length - 1].end) continue;
    out.push(f);
  }
  return out;
}

/** 'YYYY-MM-DD' → {year, month, day}; null for empty input. */
export function parseIso(iso) {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? { year: +m[1], month: +m[2], day: +m[3] } : null;
}

export function toIso(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.year}-${p(d.month)}-${p(d.day)}`;
}

/** Date from an ADF `date` node (timestamp is UTC midnight in ms, as a string). */
export function dateFromTimestamp(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n)) return null;
  const d = new Date(n);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), style: 'node' };
}

export function timestampFromIso(iso) {
  const d = parseIso(iso);
  return d ? String(Date.UTC(d.year, d.month - 1, d.day)) : null;
}

/** A written date matches Jira when month and day agree, and the year too if one was written. */
export function sameDate(claimed, actualIso) {
  const a = parseIso(actualIso);
  if (!a || !claimed) return false;
  if (claimed.month !== a.month || claimed.day !== a.day) return false;
  return claimed.year == null || claimed.year === a.year;
}

/** Write `iso` in the same style the author used, so a fix does not change the page's voice. */
export function formatLike(claimed, iso) {
  const a = parseIso(iso);
  if (!a) return 'TBD';
  const withYear = claimed.year != null;
  const p = (n) => String(n).padStart(2, '0');
  switch (claimed.style) {
    case 'iso': {
      const s = claimed.sep || '-';
      return `${a.year}${s}${p(a.month)}${s}${p(a.day)}`;
    }
    case 'kr':
      return `${withYear ? `${a.year}년 ` : ''}${a.month}월 ${a.day}일`;
    case 'dmy': {
      const mon = (claimed.long ? MONTH_LONG : MONTH_SHORT)[a.month - 1];
      return `${a.day} ${mon}${withYear ? ` ${a.year}` : ''}`;
    }
    case 'num': {
      const head = claimed.order === 'dm' ? `${a.day}/${a.month}` : `${a.month}/${a.day}`;
      return withYear ? `${head}/${a.year}` : head;
    }
    case 'mdy':
    default: {
      const mon = (claimed.long ? MONTH_LONG : MONTH_SHORT)[a.month - 1];
      return `${mon} ${a.day}${withYear ? `, ${a.year}` : ''}`;
    }
  }
}

export function humanDate(iso) {
  const a = parseIso(iso);
  return a ? `${MONTH_SHORT[a.month - 1]} ${a.day}, ${a.year}` : 'no due date';
}

// ---- status ---------------------------------------------------------------

const STATUS_WORDS = {
  done: ['done', 'closed', 'resolved', 'complete', 'completed', 'shipped', 'released', 'finished', 'delivered', 'live', '완료', '종료', '배포 완료'],
  indeterminate: ['in progress', 'in review', 'in development', 'in dev', 'in qa', 'in testing', 'in test', 'ongoing', 'started', 'underway', 'wip', 'doing', '진행 중', '진행중', '검토 중'],
  new: ['to do', 'todo', 'not started', 'open', 'backlog', 'planned', 'queued', 'new', '할 일', '예정', '대기'],
};
// Words that describe a situation rather than a workflow category.
const STATUS_UNCATEGORISED = ['blocked', 'on hold', 'paused', 'at risk', '보류', '차단'];

const clean = (s) => String(s || '').toLowerCase().replace(/[\s_-]+/g, ' ').trim();

export const STATUS_TERMS = [
  ...STATUS_WORDS.done, ...STATUS_WORDS.indeterminate, ...STATUS_WORDS.new, ...STATUS_UNCATEGORISED,
].sort((a, b) => b.length - a.length);

/** Map a written status to Jira's three categories, or null when it is not one we know. */
export function statusCategoryOf(text) {
  const t = clean(text);
  for (const [cat, words] of Object.entries(STATUS_WORDS)) {
    if (words.includes(t)) return cat;
  }
  return null;
}

/**
 * Compare a written status with the Jira status.
 * 'match' when the name is the same or the category agrees, 'drift' when the
 * category disagrees, 'unknown' when the word says nothing about category.
 */
export function compareStatus(claimedText, actual) {
  if (!actual) return 'unknown';
  const t = clean(claimedText);
  if (!t) return 'unknown';
  if (t === clean(actual.name)) return 'match';
  const cat = statusCategoryOf(t);
  if (cat) return cat === actual.category ? 'match' : 'drift';
  if (STATUS_UNCATEGORISED.includes(t)) return actual.category === 'done' ? 'drift' : 'unknown';
  return 'unknown';
}

// ---- people ---------------------------------------------------------------

const NOBODY = ['unassigned', 'nobody', 'none', 'no one', 'no owner', '미정', '없음', '미배정'];
const PLACEHOLDER = ['', '-', '–', '—', 'tbd', 'tba', 'n/a', 'na', '?', 'tbc', '미정'];

/** Empty-looking cells and unfilled template slots such as "<Flink Version>" or "[date]" state nothing. */
export const isPlaceholder = (s) => {
  const t = clean(s);
  return PLACEHOLDER.includes(t) || /^[<\[{(].*[>\]})]$/.test(t) || !/[\p{L}\p{N}]/u.test(t);
};
export const meansNobody = (s) => NOBODY.includes(clean(s));

const nameTokens = (s) => clean(String(s || '').replace(/^@/, '')).split(' ').filter(Boolean);

/** "Alice" matches "Alice Kim"; "Kim Alice" matches "Alice Kim"; "Alicia" does not. */
export function sameName(claimed, displayName) {
  const c = nameTokens(claimed);
  const d = nameTokens(displayName);
  if (!c.length || !d.length) return false;
  if (c.join('') === d.join('')) return true;
  return c.every((t) => d.includes(t));
}

// ---- versions -------------------------------------------------------------

const cleanVersion = (s) => clean(s).replace(/^(?:version|release|ver\.?|v)\s*/, '');

/** "2.4" is the 2.4 line, so it agrees with 2.4.0 and 2.4.1 but not with 2.40.0 or 2.5.0. */
const versionPrefix = (short, long) => {
  const a = short.split('.');
  const b = long.split('.');
  return /^\d+(?:\.\d+)*$/.test(short) && a.length <= b.length && a.every((seg, i) => seg === b[i]);
};

export function versionMatches(claimed, fixVersions) {
  const c = cleanVersion(claimed);
  if (!c) return false;
  return (fixVersions || []).some((v) => {
    const n = cleanVersion(v);
    if (n === c) return true;
    // Only tokens with a digit identify a version: "ml-2.0.0" and "ml-2.1.0" share "ml"
    // and are still different releases.
    const tokens = (x) => x.split(/[\s,;/]+/).filter((t) => /\d/.test(t));
    const cTokens = tokens(c);
    const nTokens = tokens(n);
    return cTokens.some((ct) => nTokens.some((nt) => ct === nt || versionPrefix(ct, nt)));
  });
}

export { clean };
