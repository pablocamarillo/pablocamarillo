import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePublicPins, renderPins, replacePins } from '../scripts/pinned-repositories.mjs';

const card = (target, href) => '<li class="pinned-item-list-item"><a data-hydro-click="'
  + target + '" href="' + href + '">example</a></li>';
const section = (heading, cards) => '<div class="js-pinned-items-reorder-container">'
  + '<h2>' + heading + '</h2><ol class="js-pinned-items-reorder-list">' + cards + '</ol></div>';

test('mirrors repository pin order and skips gists and unrelated links', () => {
  const html = '<a href="/noise/repo">unrelated</a>' + section('Pinned',
    card('PINNED_REPO', '/team/robot-workcell')
    + card('PINNED_GIST', 'https://gist.github.com/example/123')
    + card('PINNED_REPO', '/example/analytics'));
  assert.deepEqual(parsePublicPins(html), ['team/robot-workcell', 'example/analytics']);
});

test('does not confuse popular repositories with pins or erase cards for malformed data', () => {
  assert.deepEqual(parsePublicPins(section('Popular repositories', card('PINNED_REPO', '/example/analytics'))), []);
  assert.deepEqual(parsePublicPins(section('Pinned', card('PINNED_GIST', 'https://gist.github.com/example/123'))), []);
  assert.throws(() => parsePublicPins('<html>Try again later</html>'), /heading not recognized/);
  assert.throws(() => parsePublicPins(section('Pinned', card('UNKNOWN', '/example/analytics'))), /Unrecognized native pin card/);
  assert.throws(() => parsePublicPins(section('Pinned', card('PINNED_REPO', '/example/..'))), /Unrecognized native pin card/);
});

test('renders one linked card per pin and preserves everything outside the generated block', () => {
  const example = {
    id: 1, name: 'example/analytics', url: 'https://github.com/example/analytics',
    description: 'Report: A&B <C>', language: null, stars: 0, forks: 2,
  };
  const { body, cards } = renderPins([example], {});
  assert.equal(cards.length, 1);
  assert.match(body, /<a href="https:\/\/github\.com\/example\/analytics"><img src="assets\/pins\/1\.svg"/);
  assert.match(body, /A&amp;B &lt;C&gt; · 0 stars · 2 forks/);
  assert.match(cards[0].svg, /A&amp;B &lt;C&gt;/);
  const readme = 'Intro\n<!-- pinned-repositories:start -->\n<!-- pinned-repositories:end -->\n\n## Contributions\n';
  const updated = replacePins(readme, body);
  assert.ok(updated.startsWith('Intro\n<!-- pinned-repositories:start -->\n\n## Pinned repositories'));
  assert.ok(updated.endsWith('<!-- pinned-repositories:end -->\n\n## Contributions\n'));
  assert.equal(replacePins(updated, renderPins([], {}).body), readme);
});
