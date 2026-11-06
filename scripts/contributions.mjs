import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DAY_MS = 86_400_000;
const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const COLORS = ['#191c19', '#574829', '#917340', '#c5a15a', '#efd28d'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const escapeXml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
const textOnly = value => value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)) {
    if (Object.hasOwn(result, match[1])) throw new Error(`Duplicate attribute: ${match[1]}`);
    result[match[1]] = match[3];
  }
  return result;
}

function dateMs(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid date: ${value}`);
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new Error(`Invalid date: ${value}`);
  return time;
}

/** Reject incomplete or inconsistent data instead of inventing empty days. */
export function validateSnapshot(snapshot) {
  if (!snapshot || !/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(snapshot.username)) throw new Error('Invalid GitHub username');
  if (!Array.isArray(snapshot.days) || snapshot.days.length < 365 || snapshot.days.length > 371) throw new Error('Expected a full year of 365–371 actual calendar days');
  let sum = 0;
  let previous;
  for (const day of snapshot.days) {
    const current = dateMs(day.date);
    if (previous !== undefined && current - previous !== DAY_MS) throw new Error('Calendar dates must be unique, sorted, and contiguous');
    if (!Number.isSafeInteger(day.count) || day.count < 0) throw new Error(`Invalid contribution count: ${day.date}`);
    if (!Number.isInteger(day.level) || day.level < 0 || day.level > 4) throw new Error(`Invalid contribution level: ${day.date}`);
    if ((day.count === 0) !== (day.level === 0)) throw new Error(`Count and intensity disagree: ${day.date}`);
    previous = current;
    sum += day.count;
  }
  if (!Number.isSafeInteger(snapshot.total) || snapshot.total < 0 || snapshot.total !== sum) throw new Error('Daily contribution sum does not match GitHub total');
  if (snapshot.from !== snapshot.days[0].date || snapshot.to !== snapshot.days.at(-1).date || snapshot.as_of !== snapshot.to) throw new Error('Declared date range does not match calendar');
  if (!Number.isFinite(Date.parse(snapshot.fetched_at))) throw new Error('Invalid fetch timestamp');
  // GitHub chooses its calendar dates; accept UTC midnight boundaries without converting day labels.
  const fetchedDay = dateMs(new Date(snapshot.fetched_at).toISOString().slice(0, 10));
  if (dateMs(snapshot.to) > fetchedDay + DAY_MS || dateMs(snapshot.to) < fetchedDay - 2 * DAY_MS) throw new Error('Source calendar is stale or unexpectedly in the future');
  return snapshot;
}

/** Parse the public calendar and keep GitHub's original counts and intensity levels. */
export function parseContributions(html, { username = 'pablocamarillo', fetchedAt = new Date().toISOString() } = {}) {
  const headings = [...html.matchAll(/<h2\b([^>]*)>([\s\S]*?)<\/h2>/gi)]
    .filter(match => attributes(match[1]).id === 'js-contribution-activity-description');
  if (headings.length !== 1) throw new Error('GitHub contribution heading is missing or ambiguous');
  const heading = textOnly(headings[0][2]).match(/^([\d,]+) contributions? in the last year$/);
  if (!heading) throw new Error('Unexpected GitHub contribution total format');
  const total = Number(heading[1].replaceAll(',', ''));
  const graphs = [...html.matchAll(/<div\b([^>]*)>/gi)].map(match => attributes(match[1]))
    .filter(attrs => attrs['data-graph-url'] === `/users/${username}/contributions`);
  if (graphs.length !== 1) throw new Error('Expected exactly one matching GitHub user calendar');
  const from = graphs[0]['data-from']?.match(/^(\d{4}-\d{2}-\d{2}) 00:00:00 UTC$/)?.[1];
  const to = graphs[0]['data-to']?.match(/^(\d{4}-\d{2}-\d{2}) 23:59:59 UTC$/)?.[1];
  if (!from || !to) throw new Error('GitHub calendar range is missing');

  const tooltips = new Map();
  for (const match of html.matchAll(/<tool-tip\b([^>]*)>([\s\S]*?)<\/tool-tip>/gi)) {
    const target = attributes(match[1]).for;
    if (!target?.startsWith('contribution-day-component-')) continue;
    if (tooltips.has(target)) throw new Error(`Duplicate tooltip: ${target}`);
    tooltips.set(target, textOnly(match[2]));
  }
  const seenIds = new Set();
  const days = [];
  for (const match of html.matchAll(/<td\b([^>]*)>/gi)) {
    const attrs = attributes(match[1]);
    if (!attrs.class?.split(/\s+/).includes('ContributionCalendar-day')) continue;
    const id = attrs.id;
    if (!id || seenIds.has(id)) throw new Error('Missing or duplicate calendar cell ID');
    seenIds.add(id);
    const date = attrs['data-date'];
    const time = dateMs(date);
    if (!/^[0-4]$/.test(attrs['data-level'])) throw new Error(`Missing or invalid contribution level: ${date}`);
    const tooltip = tooltips.get(id);
    if (!tooltip) throw new Error(`Missing contribution tooltip: ${date}`);
    const parsed = tooltip.match(/^(No|[\d,]+) contributions? on ([A-Za-z]+) (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?\.$/);
    if (!parsed) throw new Error(`Unrecognized contribution tooltip: ${date}`);
    const value = new Date(time);
    if (parsed[2] !== FULL_MONTHS[value.getUTCMonth()] || Number(parsed[3]) !== value.getUTCDate() || (parsed[4] && Number(parsed[4]) !== value.getUTCFullYear())) throw new Error(`Tooltip date disagrees with cell: ${date}`);
    const count = parsed[1] === 'No' ? 0 : Number(parsed[1].replaceAll(',', ''));
    days.push({ date, count, level: Number(attrs['data-level']) });
  }
  if (tooltips.size !== seenIds.size) throw new Error('Tooltip and calendar cell coverage differ');
  days.sort((left, right) => left.date.localeCompare(right.date));
  return validateSnapshot({
    username,
    source: `https://github.com/users/${username}/contributions`,
    source_type: 'GitHub anonymous contribution calendar HTML',
    scope: 'Contributions visible on the public GitHub profile. Counts and intensity levels are supplied by GitHub.',
    as_of: to,
    fetched_at: fetchedAt,
    source_sha256: createHash('sha256').update(html).digest('hex'),
    from, to, total, days,
  });
}

/** Sunday-first columns, as on GitHub; no synthetic cells are emitted. */
export function calendarGeometry(days) {
  const first = dateMs(days[0].date);
  const offset = new Date(first).getUTCDay();
  return days.map(day => {
    const time = dateMs(day.date);
    return { ...day, column: Math.floor(((time - first) / DAY_MS + offset) / 7), row: new Date(time).getUTCDay() };
  });
}

export function renderContributions(snapshot, { mobile = false } = {}) {
  validateSnapshot(snapshot);
  const days = calendarGeometry(snapshot.days);
  const width = 900;
  const height = mobile ? 306 : 245;
  const x0 = 65;
  const y0 = mobile ? 120 : 91;
  const step = 15;
  const size = 11;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">`,
    `<title id="title">${escapeXml(snapshot.username)} — GitHub contribution calendar</title>`,
    `<desc id="desc">${snapshot.total} actual contributions from ${snapshot.from} through ${snapshot.to}. Five gold intensity levels use GitHub's original levels. Open the linked interactive calendar for daily details.</desc>`,
    `<rect x="0.5" y="0.5" width="899" height="${height - 1}" rx="10" fill="#0b0c0d" stroke="#49402d"/>`,
    `<g font-family="Segoe UI,Arial,sans-serif" fill="#bcb5a7">`,
    `<text x="24" y="${mobile ? 39 : 35}" font-size="${mobile ? 27 : 20}" fill="#f4eddf">${snapshot.total.toLocaleString('en-US')} contributions in the last year</text>`,
    `<text x="24" y="${mobile ? 75 : 58}" font-size="${mobile ? 21 : 12}" font-family="Consolas,monospace">${snapshot.from} — ${snapshot.to}</text>`];
  for (const [row, label] of [[1, 'Mon'], [3, 'Wed'], [5, 'Fri']]) out.push(`<text x="24" y="${y0 + row * step + 9}" font-size="11">${label}</text>`);
  let lastLabelColumn = -4;
  for (const day of days) {
    const value = new Date(`${day.date}T00:00:00Z`);
    if ((day === days[0] || value.getUTCDate() === 1) && day.column - lastLabelColumn >= 3 && day.column < days.at(-1).column - 1) {
      out.push(`<text x="${x0 + day.column * step}" y="${y0 - 10}" font-size="11">${MONTHS[value.getUTCMonth()]}</text>`);
      lastLabelColumn = day.column;
    }
    out.push(`<rect x="${x0 + day.column * step}" y="${y0 + day.row * step}" width="${size}" height="${size}" rx="2" fill="${COLORS[day.level]}" stroke="#49402d" stroke-width="0.5" data-date="${day.date}" data-count="${day.count}" data-level="${day.level}"><title>${day.date}: ${day.count} ${day.count === 1 ? 'contribution' : 'contributions'}</title></rect>`);
  }
  const footerY = mobile ? 267 : 221;
  out.push(`<text x="24" y="${footerY}" font-size="${mobile ? 19 : 11}">Updated ${escapeXml(snapshot.fetched_at.slice(0, 10))} UTC</text>`);
  const legendX = mobile ? 620 : 702;
  const legendSize = mobile ? 18 : 11;
  const legendStep = mobile ? 23 : 16;
  out.push(`<text x="${legendX - (mobile ? 53 : 35)}" y="${footerY}" font-size="${mobile ? 18 : 11}">Less</text>`);
  COLORS.forEach((color, index) => out.push(`<rect x="${legendX + index * legendStep}" y="${footerY - legendSize + 2}" width="${legendSize}" height="${legendSize}" rx="2" fill="${color}" stroke="#49402d" stroke-width="0.5"/>`));
  out.push(`<text x="${legendX + 5 * legendStep + 5}" y="${footerY}" font-size="${mobile ? 18 : 11}">More</text>`, '</g>', '</svg>');
  return `${out.join('\n')}\n`;
}

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  try {
    await writeFile(temporary, content, 'utf8');
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function refreshContributions({ input } = {}) {
  let html;
  if (input) html = await readFile(resolve(input), 'utf8');
  else {
    const response = await fetch('https://github.com/users/pablocamarillo/contributions', {
      headers: { 'User-Agent': 'pablocamarillo-profile-calendar', 'Accept': 'text/html', 'Accept-Language': 'en-US' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}; keeping the previous snapshot`);
    if (!response.headers.get('content-type')?.includes('text/html')) throw new Error('Expected GitHub HTML response');
    html = await response.text();
  }
  const snapshot = parseContributions(html);
  // Prepare every output before writing: parser/render failures leave existing artifacts untouched.
  const outputs = [
    ['data/contributions.json', `${JSON.stringify(snapshot, null, 2)}\n`],
    ['assets/contributions.svg', renderContributions(snapshot)],
    ['assets/contributions-mobile.svg', renderContributions(snapshot, { mobile: true })],
  ];
  for (const [path, content] of outputs) await atomicWrite(resolve(ROOT, path), content);
  console.log(`Verified ${snapshot.total} contributions across ${snapshot.days.length} actual GitHub days (${snapshot.from}–${snapshot.to}).`);
  return snapshot;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 2 && args[0] === '--input')) {
    console.error('Usage: node scripts/contributions.mjs [--input path/to/github-calendar.html]');
    process.exitCode = 1;
  } else {
    refreshContributions({ input: args[1] }).catch(error => {
      console.error(`Contribution refresh failed: ${error.message}`);
      process.exitCode = 1;
    });
  }
}
