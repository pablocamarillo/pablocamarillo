import { readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const login = 'pablocamarillo';
const profile = 'https://github.com/' + login;
const start = '<!-- pinned-repositories:start -->';
const end = '<!-- pinned-repositories:end -->';
const snapshotPath = 'data/pinned-repositories.json';
const pinDir = 'assets/pins';
const cardWidth = 352;
const cardFile = /^\d+\.svg$/;
const count = n => Number.isSafeInteger(n) && n >= 0;
const repositoryName = /^[A-Za-z0-9-]+\/(?!\.{1,2}$)[A-Za-z0-9_.-]+$/;
const escape = value => String(value).replace(/[&<>"']/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[ch]);

const query = 'query PublicPins($login: String!) { user(login: $login) { '
  + 'pinnedItems(first: 6, types: [REPOSITORY]) { totalCount nodes { '
  + '... on Repository { databaseId nameWithOwner url visibility description '
  + 'primaryLanguage { name } stargazerCount forkCount } } } } }';

// Read only the native pin list. GitHub uses the same container for its
// automatic "Popular repositories" list, which must never count as pins.
export function parsePublicPins(html) {
  const section = /<div\b[^>]*\bclass="[^"]*\bjs-pinned-items-reorder-container\b[^"]*"[^>]*>\s*<h2\b[^>]*>\s*(Pinned|Popular repositories)(?=\s|<)/.exec(html);
  if (!section) throw new Error('GitHub profile pin heading not recognized');
  if (section[1] === 'Popular repositories') return [];
  const remainder = html.slice(section.index + section[0].length);
  const list = /<\/h2>\s*<ol\b[^>]*\bclass="[^"]*\bjs-pinned-items-reorder-list\b[^"]*"[^>]*>([\s\S]*?)<\/ol>/.exec(remainder);
  if (!list) throw new Error('GitHub profile pin list not recognized');
  const items = [...list[1].matchAll(/<li\b[^>]*\bclass="[^"]*\bpinned-item-list-item\b[^"]*"[^>]*>([\s\S]*?)<\/li>/g)];
  if (!items.length || items.length > 6) throw new Error('Unexpected number of native pin cards');

  const names = items.flatMap(([, card]) => {
    const link = [...card.matchAll(/<a\b[^>]*>/g)].find(([tag]) => /\bPINNED_(REPO|GIST)\b/.test(tag));
    const tag = link?.[0] ?? '';
    const href = /\bhref="([^"]+)"/.exec(tag)?.[1] ?? '';
    if (/\bPINNED_GIST\b/.test(tag) && /^https:\/\/gist\.github\.com\//.test(href)) return [];
    if (!/\bPINNED_REPO\b/.test(tag) || !href.startsWith('/') || !repositoryName.test(href.slice(1))) {
      throw new Error('Unrecognized native pin card; keeping the existing snapshot');
    }
    return [href.slice(1)];
  });
  if (new Set(names.map(name => name.toLowerCase())).size !== names.length) {
    throw new Error('Duplicate repositories in native pin list');
  }
  return names;
}

function normalizeRepo({ id, name, url, visibility, description, language, stars, forks }) {
  if (visibility !== 'PUBLIC' || !Number.isSafeInteger(id) || id <= 0
    || typeof name !== 'string' || !repositoryName.test(name)
    || url !== 'https://github.com/' + name || !count(stars) || !count(forks)
    || (description !== null && typeof description !== 'string')
    || (language !== null && typeof language !== 'string')) {
    throw new Error('Invalid or non-public pinned repository metadata');
  }
  const plain = value => value?.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() || null;
  return { id, name, url, description: plain(description), language: plain(language), stars, forks };
}

function validateSnapshot({ source, repositories }) {
  if (!['profile + REST', 'GraphQL'].includes(source) || !Array.isArray(repositories) || repositories.length > 6) {
    throw new Error('Invalid pin snapshot');
  }
  if (new Set(repositories.map(repo => repo.id)).size !== repositories.length
    || new Set(repositories.map(repo => repo.name.toLowerCase())).size !== repositories.length) {
    throw new Error('Duplicate repositories in pin snapshot');
  }
  return { source, repositories: repositories.map(repo => normalizeRepo({ ...repo, visibility: 'PUBLIC' })) };
}

async function request(url, options) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20_000), redirect: 'error', ...options,
    headers: { 'User-Agent': 'pablocamarillo-profile', ...options?.headers },
  });
  if (!response.ok) throw new Error('GitHub pins request failed: HTTP ' + response.status);
  return response;
}

async function fetchGraphQL(token) {
  const response = await request('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { login } }),
  });
  const result = await response.json();
  const pins = result.data?.user?.pinnedItems;
  if (result.errors?.length || !Array.isArray(pins?.nodes) || pins.totalCount !== pins.nodes.length) {
    throw new Error('GitHub returned an incomplete GraphQL pin list');
  }
  return pins.nodes.map(repo => normalizeRepo({
    id: repo.databaseId, name: repo.nameWithOwner, url: repo.url, visibility: repo.visibility,
    description: repo.description, language: repo.primaryLanguage?.name ?? null,
    stars: repo.stargazerCount, forks: repo.forkCount,
  }));
}

async function fetchPublic() {
  const names = parsePublicPins(await (await request(profile, { headers: { 'Accept-Language': 'en' } })).text());
  return Promise.all(names.map(async name => {
    const response = await request('https://api.github.com/repos/' + name, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    });
    const repo = await response.json();
    if (repo.full_name?.toLowerCase() !== name.toLowerCase() || repo.private !== false) {
      throw new Error('GitHub returned different or non-public repository metadata');
    }
    return normalizeRepo({
      id: repo.id, name: repo.full_name, url: repo.html_url, visibility: repo.visibility?.toUpperCase(),
      description: repo.description, language: repo.language, stars: repo.stargazers_count, forks: repo.forks_count,
    });
  }));
}

async function fetchSnapshot(token) {
  if (token) {
    try {
      return validateSnapshot({ source: 'GraphQL', repositories: await fetchGraphQL(token) });
    } catch {
      console.warn('GraphQL pins unavailable or incomplete; using the public profile and REST.');
    }
  }
  return validateSnapshot({ source: 'profile + REST', repositories: await fetchPublic() });
}

// Conservative Arial width estimates keep description and repository names
// inside the card, without relying on SVG foreignObject or external fonts.
function width(value, size) {
  return Array.from(value, ch => /[ .ilI!'|,:;\-/]/.test(ch) ? .34
    : /[MW@%&\p{Extended_Pictographic}]/u.test(ch) ? 1.05 : /[mw]/.test(ch) ? .82
      : /[A-Z0-9]/.test(ch) ? .68 : /\p{Script=Latin}|[_()]/u.test(ch) ? .57 : 1)
    .reduce((a, b) => a + b, 0) * size;
}

function wrap(value, size, limit, maxLines) {
  const lines = [];
  let remaining = Array.from(value ?? '');
  while (remaining.length && lines.length < maxLines) {
    const available = Array.isArray(limit) ? limit[Math.min(lines.length, limit.length - 1)] : limit;
    let length = 0;
    let breakAt = 0;
    while (length < remaining.length && width(remaining.slice(0, length + 1).join(''), size) <= available) {
      length += 1;
      if (/[\s/-]/.test(remaining[length - 1])) breakAt = length;
    }
    if (length < remaining.length && lines.length === maxLines - 1) {
      while (length > 0 && width(remaining.slice(0, length).join('').trimEnd() + '…', size) > available) length -= 1;
      lines.push(remaining.slice(0, length).join('').trimEnd() + '…');
      break;
    }
    if (length < remaining.length && breakAt > length / 2) length = breakAt;
    lines.push(remaining.slice(0, length).join('').trim());
    remaining = Array.from(remaining.slice(length).join('').trimStart());
  }
  return lines;
}

const icons = {
  repo: 'M3 1.5h10v11H8m-5 0V1.5m0 11a1.5 1.5 0 0 1 1.5-1.5H13m-8 4v-4m0 4 1.5-1L8 15v-4',
  star: 'm8 1.4 2 4 4.4.6-3.2 3.1.8 4.4L8 11.4l-4 2.1.8-4.4L1.6 6l4.4-.6L8 1.4Z',
  fork: 'M4.5 6v1.5A2.5 2.5 0 0 0 7 10h1m3.5-4v1.5A2.5 2.5 0 0 1 9 10H8m0 0v1.5m-3.5-9a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5Zm7 0a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5ZM8 11.5a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5Z',
};
const icon = (name, x, y) => '<path transform="translate(' + x + ' ' + y
  + ')" d="' + icons[name] + '" fill="none" stroke="#bcb5a7" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>';
const text = (value, x, y, size, color = '#bcb5a7', bold = false) =>
  '<text x="' + x + '" y="' + y + '" font-size="' + size + '" fill="' + color + '"'
  + (bold ? ' font-weight="700"' : '') + '>' + escape(value) + '</text>';

function card(repo, description, title, lines, height) {
  const footer = height - 16;
  const language = wrap(repo.language, 12, 100, 1)[0];
  const starX = language ? 40 + Math.ceil(width(language, 12)) : 15;
  const forkX = starX + 31 + Math.ceil(width(String(repo.stars), 12));
  const descY = 27 + title.length * 17 + 4;
  const alt = [repo.name, description, repo.language, repo.stars + ' stars', repo.forks + ' forks'].filter(Boolean).join(' · ');
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + cardWidth + '" height="' + height + '" viewBox="0 0 ' + cardWidth + ' ' + height + '">',
    '  <title>' + escape(alt) + '</title>',
    '  <rect x="1" y="4" width="' + (cardWidth - 2) + '" height="' + (height - 8) + '" rx="6" fill="#0b0c0d" stroke="#49402d"/>',
    '  <g font-family="Arial, sans-serif">',
    icon('repo', 14, 14),
    ...title.map((line, i) => text(line, 36, 27 + i * 17, 14, '#d9b974', true)),
    '<rect x="296" y="14" width="42" height="18" rx="9" fill="none" stroke="#49402d"/>',
    text('Public', 302, 27, 11),
    ...lines.map((line, i) => text(line, 15, descY + 16 * i, 13)),
    ...(language ? ['<circle cx="20" cy="' + (footer - 4) + '" r="5" fill="#c5a15a"/>', text(language, 30, footer, 12)] : []),
    icon('star', starX, footer - 12), text(repo.stars, starX + 20, footer, 12),
    icon('fork', forkX, footer - 12), text(repo.forks, forkX + 20, footer, 12),
    '  </g>', '</svg>', '',
  ].join('\n');
  return { path: pinDir + '/' + repo.id + '.svg', svg, alt };
}

export function renderPins(repositories, descriptions) {
  const rows = [];
  const cards = [];
  for (let i = 0; i < repositories.length; i += 2) {
    const pair = repositories.slice(i, i + 2);
    const row = pair.map(repo => {
      const description = descriptions[repo.name] ?? repo.description;
      return { repo, description, title: wrap(repo.name.split('/')[1], 14, [253, 300], 3), lines: wrap(description, 13, 318, 3) };
    });
    const height = 51 + Math.max(...row.map(({ title, lines }) => 17 * title.length + 16 * Math.max(1, lines.length)));
    const links = row.map(({ repo, description, title, lines }) => {
      const asset = card(repo, description, title, lines, height);
      cards.push(asset);
      return '  <a href="' + repo.url + '"><img src="' + asset.path + '" alt="' + escape(asset.alt)
        + '" width="' + cardWidth + '"></a>';
    });
    rows.push('<div>\n' + links.join('\n') + '\n</div>');
  }
  return { cards, body: rows.length ? '\n\n## Pinned repositories\n\n' + rows.join('\n\n') + '\n\n' : '\n' };
}

export function replacePins(readme, body) {
  const left = readme.indexOf(start);
  const right = readme.indexOf(end);
  if (left === -1 || right < left || readme.lastIndexOf(start) !== left || readme.lastIndexOf(end) !== right) {
    throw new Error('README needs exactly one ordered pair of pin markers');
  }
  return readme.slice(0, left + start.length) + body + readme.slice(right);
}

async function main(check) {
  const read = file => readFile(resolve(root, file), 'utf8');
  const write = (file, value) => writeFile(resolve(root, file), value);
  const descriptions = JSON.parse(await read('data/pin-descriptions.json'));
  for (const [name, value] of Object.entries(descriptions)) {
    if (!repositoryName.test(name) || typeof value !== 'string' || !value.trim()) {
      throw new Error('Invalid pinned repository description override');
    }
  }
  const snapshot = check ? validateSnapshot(JSON.parse(await read(snapshotPath)))
    : await fetchSnapshot(process.env.PINNED_READ_TOKEN);
  const { cards, body } = renderPins(snapshot.repositories, descriptions);
  const outputs = new Map([[snapshotPath, JSON.stringify(snapshot, null, 2) + '\n']]);
  for (const file of ['README.md', 'README_STATIC.md']) {
    const readme = await read(file);
    outputs.set(file, replacePins(readme, body));
  }
  for (const asset of cards) outputs.set(asset.path, asset.svg);
  const oldCards = (await readdir(resolve(root, pinDir))).filter(name => cardFile.test(name))
    .map(name => pinDir + '/' + name).filter(path => !outputs.has(path));
  if (check && oldCards.length) throw new Error('Stale generated pin cards: ' + oldCards.join(', '));
  for (const [path, value] of outputs) {
    const old = await read(path).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (old?.replace(/\r\n/g, '\n') === value.replace(/\r\n/g, '\n')) continue;
    if (check) throw new Error('Out-of-date pin output: ' + path);
    await write(path, value);
  }
  for (const path of oldCards) await unlink(resolve(root, path));
  console.log((check ? 'Verified ' : 'Synced ') + cards.length + ' repository pins via ' + snapshot.source);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.includes('--check'));
}
