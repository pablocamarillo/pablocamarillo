import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = 'ALL-Applied-AI-Network/msoe-ai-club-rockwell-automation-nvidia-hackath-new-team-1-10439770d3';
const url = `https://github.com/${repository}`;
const api = `https://api.github.com/repos/${repository}`;
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));

function text(x, y, content, size = 22, color = '#bcb5a7', font = 'Segoe UI,Arial,sans-serif') {
  return `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" fill="${color}">${escape(content)}</text>`;
}

function card(metadata, mobile = false) {
  const w = mobile ? 480 : 1200;
  const h = mobile ? 536 : 380;
  const x = mobile ? 30 : 48;
  const mono = 'Consolas,monospace';
  const gold = '#d9b974';
  const ivory = '#f4eddf';
  const updated = metadata.fetched_at.slice(0, 10);
  const accessible = `Adaptive Workcell Reconfiguration. Collaborative Rockwell Automation and NVIDIA hackathon project by The A-Team, including Pablo Camarillo. ${metadata.primary_language} primary language; ${metadata.stars} stars. Metadata refreshed ${updated}.`;
  const lines = mobile ? [
    text(x, 48, '~/featured $ team_project', 17, gold, mono),
    text(x, 95, 'Adaptive Workcell', 34, ivory, 'Georgia,serif'),
    text(x, 137, 'Reconfiguration', 34, ivory, 'Georgia,serif'),
    text(x, 176, 'Rockwell Automation + NVIDIA', 20, gold),
    text(x, 204, 'Hackathon · The A-Team', 20, gold),
    text(x, 251, 'A collaborative Physical AI prototype:', 19),
    text(x, 280, 'human demonstrations, digital-twin', 19),
    text(x, 309, 'validation, supervised robot actions.', 19),
    text(x, 358, 'Python · NVIDIA Isaac Sim · OpenCV', 18, ivory),
    text(x, 387, 'MediaPipe · Three.js', 18, ivory),
    text(x, 434, `${metadata.primary_language}  ·  ★ ${metadata.stars} stars`, 18, gold, mono),
    text(x, 463, `Metadata · ${updated}`, 15, '#bcb5a7', mono),
    text(x, 505, 'Explore the team repository →', 19, gold),
  ] : [
    text(x, 58, '~/featured $ team_project', 18, gold, mono),
    text(x, 127, 'Adaptive Workcell Reconfiguration', 48, ivory, 'Georgia,serif'),
    text(x, 169, 'Rockwell Automation + NVIDIA Hackathon · The A-Team', 24, gold),
    text(x, 219, 'A collaborative Physical AI prototype connecting human demonstrations,', 24),
    text(x, 251, 'digital-twin validation, and supervised FANUC robot actions.', 24),
    text(x, 295, 'Python · NVIDIA Isaac Sim · OpenCV · MediaPipe · Three.js', 22, ivory),
    text(x, 344, `${metadata.primary_language}  ·  ★ ${metadata.stars} stars  ·  Metadata ${updated}`, 18, gold, mono),
    text(826, 344, 'Explore the team repository →', 20, gold),
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="title description">
  <title id="title">Adaptive Workcell Reconfiguration — collaborative hackathon project</title>
  <desc id="description">${escape(accessible)} Repository: ${escape(repository)}. Python, NVIDIA Isaac Sim, OpenCV, MediaPipe and Three.js.</desc>
  <rect width="${w}" height="${h}" fill="#0b0c0d"/>
  <rect x="12" y="12" width="${w - 24}" height="${h - 24}" rx="10" fill="#121311" stroke="#49402d"/>
  <rect x="12" y="12" width="5" height="${h - 24}" fill="${gold}"/>
  ${lines.join('\n  ')}
</svg>\n`;
}

async function main() {
  const response = await fetch(api, {
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'pablocamarillo-profile' },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`GitHub repository metadata request failed: HTTP ${response.status}`);
  const repo = await response.json();
  if (repo.id !== 1411010025 || repo.full_name !== repository || repo.html_url !== url || repo.private !== false || repo.fork !== false) {
    throw new Error('Repository identity, visibility, or original-repository validation failed. Existing files were retained.');
  }
  if (!Number.isSafeInteger(repo.stargazers_count) || repo.stargazers_count < 0 || typeof repo.language !== 'string' || !repo.language.trim() || repo.language.length > 40) {
    throw new Error('GitHub returned invalid stars or primary-language metadata. Existing files were retained.');
  }
  const metadata = {
    repository,
    repository_id: repo.id,
    url: repo.html_url,
    title: 'Adaptive Workcell Reconfiguration',
    team: 'The A-Team',
    collaboration: 'Collaborative hackathon project; Pablo Camarillo is one of five team members.',
    technologies: ['Python', 'NVIDIA Isaac Sim', 'OpenCV', 'MediaPipe', 'Three.js'],
    primary_language: repo.language,
    stars: repo.stargazers_count,
    source: api,
    credits: `${url}/blob/main/docs/credits.md`,
    fetched_at: new Date().toISOString(),
  };
  // Fetch and validate before writing: a failed refresh never invents metadata.
  const desktop = card(metadata);
  const mobile = card(metadata, true);
  await mkdir(resolve(root, 'data'), { recursive: true });
  await mkdir(resolve(root, 'assets'), { recursive: true });
  await writeFile(resolve(root, 'data/featured-project.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  await writeFile(resolve(root, 'assets/hackathon-card.svg'), desktop);
  await writeFile(resolve(root, 'assets/hackathon-card-mobile.svg'), mobile);
  console.log(`Featured ${repository}: ${metadata.primary_language}, ${metadata.stars} stars (${metadata.fetched_at}).`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
