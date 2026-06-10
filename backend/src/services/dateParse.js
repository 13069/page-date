const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  // Macedonian / Serbian Cyrillic abbreviated
  'јан': 1, 'фев': 2, 'мар': 3, 'апр': 4, 'мај': 5, 'јун': 6, 'јул': 7,
  'авг': 8, 'сеп': 9, 'окт': 10, 'нов': 11, 'дек': 12,
  // Macedonian full Cyrillic
  'јануари': 1, 'февруари': 2, 'март': 3, 'април': 4, 'маи': 5, 'јуни': 6, 'јули': 7,
  'август': 8, 'септември': 9, 'октомври': 10, 'ноември': 11, 'декември': 12,
  // Latin transliterations
  maj: 5, juni: 6, juli: 7, avg: 8, avgust: 8, sep: 9, okt: 10, dek: 12,
  // German
  januar: 1, februar: 2, mär: 3, maer: 3, märz: 3, maerz: 3, mai: 5, juli: 7,
  oktober: 10, dezember: 12,
  // French
  janv: 1, févr: 2, fevr: 2, mars: 3, avr: 4, juin: 6, juil: 7, août: 8, aout: 8,
  septembre: 9, octobre: 10, novembre: 11, décembre: 12, decembre: 12
};

function monthToNum(raw) {
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/\./g, '').trim();
  return MONTHS[key] || MONTHS[key.slice(0, 4)] || MONTHS[key.slice(0, 3)] || null;
}

const RELATIVE_WORDS = [
  { re: /(?:^|[\s,–—-])(денес|today|heute|aujourd'hui|oggi)(?:$|[\s,–—-])/i, fn: () => new Date() },
  { re: /(?:^|[\s,–—-])(вчера|yesterday|gestern|hier)(?:$|[\s,–—-])/i, fn: () => { const d = new Date(); d.setDate(d.getDate() - 1); return d; } },
  { re: /(?:^|[\s,–—-])(завчера|day before yesterday)(?:$|[\s,–—-])/i, fn: () => { const d = new Date(); d.setDate(d.getDate() - 2); return d; } },
  { re: /^(денес|today|вчера|yesterday)$/i, fn: (m) => {
    const d = new Date();
    if (/вчера|yesterday/i.test(m[0])) d.setDate(d.getDate() - 1);
    return d;
  } }
];

export function parseRelativeWord(str) {
  if (!str) return null;
  const s = str.trim();
  for (const { re, fn } of RELATIVE_WORDS) {
    const m = s.match(re);
    if (m) return fn(m);
  }
  return null;
}

export function parseTime(str) {
  if (!str || typeof str !== 'string') return null;
  const m = str.trim().match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const sec = parseInt(m[3] || '0', 10);
  const ampm = m[4]?.toLowerCase();
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  return { h, m: min, s: sec };
}

export function applyTime(date, time) {
  if (!date || !time) return date;
  const d = new Date(date.getTime());
  d.setHours(time.h, time.m, time.s, 0);
  return d;
}

export function parseFlexibleDate(str) {
  if (!str || typeof str !== 'string') return null;
  let s = str.trim().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
  if (!s || s.length < 3) return null;

  const relOnly = parseRelativeWord(s);
  if (relOnly) return relOnly;

  if (/\s[-–—]\s/.test(s)) {
    const parts = s.split(/\s[-–—]\s/);
    const fromPart = parseFlexibleDate(parts[0]);
    if (fromPart) return fromPart;
    const fromRel = parseRelativeWord(parts[1]);
    if (fromRel) return fromRel;
    s = parts[0].trim();
  }

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 12), +(m[5] || 0), +(m[6] || 0));
    if (!isNaN(d.getTime())) return d;
  }

  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const d = new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 12), +(m[5] || 0));
    if (!isNaN(d.getTime()) && d.getFullYear() > 1990) return d;
  }

  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const d = new Date(+m[3], +m[1] - 1, +m[2], +(m[4] || 12), +(m[5] || 0));
    if (!isNaN(d.getTime()) && d.getFullYear() > 1990) return d;
  }

  const monthPart = '[a-zA-Zа-яА-ЯёЁјЈљЉњЊћЋџЏčćžšđČĆŽŠĐ]+';

  m = s.match(new RegExp(`^(${monthPart})\\.?\\s+(\\d{1,2})\\s+(\\d{4})$`, 'u'));
  if (m) {
    const mo = monthToNum(m[1]);
    if (mo) {
      const d = new Date(+m[3], mo - 1, +m[2], 12, 0);
      if (!isNaN(d.getTime())) return d;
    }
  }

  m = s.match(new RegExp(`^(\\d{1,2})\\.?\\s+(${monthPart})\\.?\\s+(\\d{4})$`, 'u'));
  if (m) {
    const mo = monthToNum(m[2]);
    if (mo) {
      const d = new Date(+m[3], mo - 1, +m[1], 12, 0);
      if (!isNaN(d.getTime())) return d;
    }
  }

  m = s.match(new RegExp(`^(${monthPart})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})$`, 'u'));
  if (m) {
    const mo = monthToNum(m[1]);
    if (mo) {
      const d = new Date(+m[3], mo - 1, +m[2], 12, 0);
      if (!isNaN(d.getTime())) return d;
    }
  }

  m = s.match(new RegExp(`^(\\d{1,2})\\s+(${monthPart})\\.?\\s+(\\d{4})$`, 'u'));
  if (m) {
    const mo = monthToNum(m[2]);
    if (mo) {
      const d = new Date(+m[3], mo - 1, +m[1], 12, 0);
      if (!isNaN(d.getTime())) return d;
    }
  }

  let d = new Date(s);
  if (!isNaN(d.getTime()) && d.getFullYear() > 1990 && d.getFullYear() < 2100) return d;

  return null;
}
