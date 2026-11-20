import { describe, it, expect } from 'vitest';
import {
  findDates, sameDate, formatLike, compareStatus, sameName, versionMatches,
  isPlaceholder, meansNobody, dateFromTimestamp, timestampFromIso, statusCategoryOf,
} from '../src/engine/normalize.js';

const one = (s) => findDates(s)[0];

describe('findDates', () => {
  it('reads the common written forms', () => {
    expect(one('due 2026-12-03')).toMatchObject({ year: 2026, month: 12, day: 3, style: 'iso' });
    expect(one('due 2026/12/03')).toMatchObject({ year: 2026, month: 12, day: 3 });
    expect(one('ships Dec 3')).toMatchObject({ year: null, month: 12, day: 3, style: 'mdy' });
    expect(one('ships Dec. 3rd, 2026')).toMatchObject({ year: 2026, month: 12, day: 3 });
    expect(one('ships December 3, 2026')).toMatchObject({ year: 2026, month: 12, day: 3, long: true });
    expect(one('ships 3 Dec 2026')).toMatchObject({ year: 2026, month: 12, day: 3, style: 'dmy' });
    expect(one('12월 3일 출시')).toMatchObject({ year: null, month: 12, day: 3, style: 'kr' });
    expect(one('2026년 12월 3일')).toMatchObject({ year: 2026, month: 12, day: 3 });
  });

  it('flags day/month ambiguity instead of guessing', () => {
    expect(one('due 3/4')).toMatchObject({ ambiguous: true });
    expect(one('due 23/12/2026')).toMatchObject({ month: 12, day: 23, year: 2026 });
    expect(one('due 12/23')).toMatchObject({ month: 12, day: 23 });
    expect(one('due 12/23').ambiguous).toBeUndefined();
  });

  it('does not see dates in versions, keys or times', () => {
    expect(findDates('release v2.4.1 for PAY-12')).toEqual([]);
    expect(findDates('build 10.11.12')).toEqual([]);
    expect(findDates('May the team decide')).toEqual([]);
    expect(findDates('meeting at Dec 3:30')).toEqual([]);
  });

  it('returns non-overlapping spans in order', () => {
    const ds = findDates('moved from Dec 3, 2026 to Dec 17, 2026');
    expect(ds.map((d) => d.day)).toEqual([3, 17]);
    expect(ds[0].end).toBeLessThanOrEqual(ds[1].index);
  });

  it('rejects impossible dates', () => {
    expect(findDates('2026-13-40')).toEqual([]);
    expect(findDates('Feb 45')).toEqual([]);
  });
});

describe('sameDate / formatLike', () => {
  it('compares month and day, and year when written', () => {
    expect(sameDate({ year: null, month: 12, day: 17 }, '2026-12-17')).toBe(true);
    expect(sameDate({ year: 2025, month: 12, day: 17 }, '2026-12-17')).toBe(false);
    expect(sameDate({ year: null, month: 12, day: 3 }, '2026-12-17')).toBe(false);
    expect(sameDate({ year: null, month: 12, day: 3 }, null)).toBe(false);
  });

  it('keeps the author’s style when rewriting', () => {
    expect(formatLike(one('Dec 3'), '2026-12-17')).toBe('Dec 17');
    expect(formatLike(one('December 3, 2026'), '2027-01-05')).toBe('January 5, 2027');
    expect(formatLike(one('2026-12-03'), '2026-12-17')).toBe('2026-12-17');
    expect(formatLike(one('2026/12/03'), '2026-12-17')).toBe('2026/12/17');
    expect(formatLike(one('3 Dec'), '2026-12-17')).toBe('17 Dec');
    expect(formatLike(one('12월 3일'), '2026-12-17')).toBe('12월 17일');
    expect(formatLike(one('12/23'), '2027-01-05')).toBe('1/5');
    expect(formatLike(one('Dec 3'), null)).toBe('TBD');
  });

  it('round-trips ADF date timestamps', () => {
    const ts = timestampFromIso('2026-12-17');
    expect(dateFromTimestamp(ts)).toMatchObject({ year: 2026, month: 12, day: 17 });
  });
});

describe('status', () => {
  const inProgress = { name: 'In Progress', category: 'indeterminate' };
  const done = { name: 'Done', category: 'done' };
  const custom = { name: 'Ready for QA', category: 'indeterminate' };

  it('matches by name or by category', () => {
    expect(compareStatus('in progress', inProgress)).toBe('match');
    expect(compareStatus('In-Progress', inProgress)).toBe('match');
    expect(compareStatus('WIP', inProgress)).toBe('match');
    expect(compareStatus('ready for qa', custom)).toBe('match');
    expect(compareStatus('in review', custom)).toBe('match');
    expect(compareStatus('shipped', done)).toBe('match');
    expect(compareStatus('완료', done)).toBe('match');
  });

  it('reports drift when the category disagrees', () => {
    expect(compareStatus('in progress', done)).toBe('drift');
    expect(compareStatus('to do', inProgress)).toBe('drift');
    expect(compareStatus('done', inProgress)).toBe('drift');
  });

  it('does not guess for words outside the workflow', () => {
    expect(compareStatus('blocked', inProgress)).toBe('unknown');
    expect(compareStatus('blocked', done)).toBe('drift');
    expect(compareStatus('green', inProgress)).toBe('unknown');
    expect(statusCategoryOf('on track')).toBe(null);
  });
});

describe('people and versions', () => {
  it('matches first names and reordered names, not lookalikes', () => {
    expect(sameName('Jiyoung', 'Jiyoung Park')).toBe(true);
    expect(sameName('@Jiyoung Park', 'Jiyoung Park')).toBe(true);
    expect(sameName('Park Jiyoung', 'Jiyoung Park')).toBe(true);
    expect(sameName('Jiyoon', 'Jiyoung Park')).toBe(false);
    expect(sameName('Minsu Kim', 'Jiyoung Park')).toBe(false);
    expect(sameName('', 'Jiyoung Park')).toBe(false);
  });

  it('knows placeholders and "nobody"', () => {
    expect(isPlaceholder('TBD')).toBe(true);
    expect(isPlaceholder(' - ')).toBe(true);
    expect(isPlaceholder('Dec 3')).toBe(false);
    expect(meansNobody('Unassigned')).toBe(true);
    expect(meansNobody('Jiyoung')).toBe(false);
  });

  it('compares versions ignoring the v prefix', () => {
    expect(versionMatches('v2.4.0', ['2.4.0'])).toBe(true);
    expect(versionMatches('2.4.0', ['Release 2.4.0'])).toBe(true);
    expect(versionMatches('2.4', ['2.4.0'])).toBe(true);
    expect(versionMatches('2.4', ['2.4.1'])).toBe(true);
    expect(versionMatches('2.4', ['2.40.0'])).toBe(false);
    expect(versionMatches('2.4', ['2.5.0'])).toBe(false);
    expect(versionMatches('2.4.0', ['2.4'])).toBe(false);
    expect(versionMatches('1.17, 1.18', ['1.18.0'])).toBe(true);
    expect(versionMatches('2.5.0', ['2.4.0', '2.5.0'])).toBe(true);
    expect(versionMatches('2.5.0', [])).toBe(false);
  });
});
