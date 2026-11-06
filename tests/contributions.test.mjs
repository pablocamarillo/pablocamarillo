import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseContributions, validateSnapshot, renderContributions, calendarGeometry, COLORS } from '../scripts/contributions.mjs';

// Exact public GitHub HTML fetched on 2026-11-06 UTC; compressed only to keep the fixture small.
const html = gunzipSync(readFileSync(new URL('./fixtures/github-calendar-2026-11-06.html.gz', import.meta.url))).toString('utf8');
const options = { fetchedAt: '2026-11-06T03:45:00.000Z' };
const parse = source => parseContributions(source, options);

test('official snapshot retains every count and GitHub intensity, with verified total', () => {
  const result = parse(html);
  assert.equal(result.total, 33);
  assert.equal(result.days.length, 370);
  assert.equal(result.from, '2025-11-02');
  assert.equal(result.to, '2026-11-06');
  assert.equal(result.days.reduce((sum, day) => sum + day.count, 0), 33);
  assert.deepEqual(result.days.find(day => day.date === '2026-10-31'), { date: '2026-10-31', count: 5, level: 4 });
  assert.deepEqual(result.days[0], { date: '2025-11-02', count: 0, level: 0 });
  assert.match(result.source_sha256, /^[a-f0-9]{64}$/);
});

test('missing tooltips are not silently converted to zero', () => {
  assert.throws(() => parse(html.replace(/<tool-tip\b[^>]*>[\s\S]*?<\/tool-tip>/, '')), /Missing contribution tooltip/);
});

test('missing or invalid levels and missing dates fail closed', () => {
  assert.throws(() => parse(html.replace('data-level="0"', 'data-level="5"')), /invalid contribution level/);
  assert.throws(() => parse(html.replace('data-level="0"', '')), /invalid contribution level/);
  assert.throws(() => parse(html.replace('data-date="2025-11-02"', '')), /Invalid date/);
});

test('unrecognized and mismatched tooltip counts or dates fail closed', () => {
  assert.throws(() => parse(html.replace('No contributions on November 2nd.', 'Unknown contributions on November 2nd.')), /Unrecognized contribution tooltip/);
  assert.throws(() => parse(html.replace('No contributions on November 2nd.', 'No contributions on November 3rd.')), /Tooltip date disagrees/);
  assert.throws(() => parse(html.replace('5 contributions on October 31st.', '6 contributions on October 31st.')), /sum does not match/);
});

test('zero activity is accepted only at level zero', () => {
  assert.throws(() => parse(html.replace('data-level="0"', 'data-level="1"')), /Count and intensity disagree/);
});

test('duplicate, missing and unordered calendar dates are rejected', () => {
  const original = parse(html);
  for (const transform of [
    days => days.splice(10, 1),
    days => days.splice(10, 1, { ...days[9] }),
    days => days.reverse(),
  ]) {
    const changed = structuredClone(original);
    transform(changed.days);
    assert.throws(() => validateSnapshot(changed), /unique, sorted, and contiguous/);
  }
});

test('wrong account, partial-year, range mismatches and stale source are rejected', () => {
  assert.throws(() => parseContributions(html, { ...options, username: 'another-user' }), /matching GitHub user calendar/);
  const partial = parse(html);
  partial.days = partial.days.slice(30);
  assert.throws(() => validateSnapshot(partial), /full year/);
  const wrongRange = parse(html);
  wrongRange.from = '2025-11-03';
  assert.throws(() => validateSnapshot(wrongRange), /range does not match/);
  assert.throws(() => parseContributions(html, { fetchedAt: '2026-11-10T12:00:00Z' }), /stale/);
});

test('Sunday-first geometry handles year and leap-day boundaries in UTC', () => {
  const positions = calendarGeometry([
    { date: '2024-02-28', count: 0, level: 0 },
    { date: '2024-02-29', count: 0, level: 0 },
    { date: '2024-03-01', count: 0, level: 0 },
    { date: '2024-03-03', count: 0, level: 0 },
  ]);
  assert.deepEqual(positions.map(({ column, row }) => [column, row]), [[0, 3], [0, 4], [0, 5], [1, 0]]);
  assert.deepEqual(calendarGeometry([{ date: '2023-12-31' }, { date: '2024-01-01' }]).map(({ column, row }) => [column, row]), [[0, 0], [0, 1]]);
});

test('both SVG variants contain all actual dates, five levels, accessible labels and no scripts', () => {
  const snapshot = parse(html);
  for (const mobile of [false, true]) {
    const svg = renderContributions(snapshot, { mobile });
    assert.equal([...svg.matchAll(/data-date="/g)].length, 370);
    assert.equal([...svg.matchAll(/<title>\d{4}-\d{2}-\d{2}:/g)].length, 370);
    for (const color of COLORS) assert.ok(svg.includes(color));
    for (const label of ['Mon', 'Wed', 'Fri', 'Less', 'More', 'Jan', 'Dec']) assert.ok(svg.includes(`>${label}</text>`));
    assert.match(svg, /aria-labelledby="title desc"/);
    assert.doesNotMatch(svg, /<script|onload=|foreignObject/i);
  }
});
