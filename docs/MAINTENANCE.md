# Terminal Gold profile maintenance

The profile README uses repository-hosted SVG images. The companion calendar is a
buildless GitHub Pages site; JavaScript runs only on Pages. The original hero,
workflow animations, static alternatives, education, skills and project copy are
retained. No package installation or personal access token is required.

## Publish after reviewing the diff

1. Review and merge/push the changes to `main` in `pablocamarillo/pablocamarillo`.
2. In **Settings → Pages → Build and deployment → Source**, choose **GitHub Actions**.
   This is a project site: its expected URL is
   `https://pablocamarillo.github.io/pablocamarillo/` (including the repository path).
3. Run **Actions → Refresh profile and deploy calendar → Run workflow** on `main`.
   The workflow also runs daily at 11:23 UTC, and after relevant changes to `main`.
4. Confirm all refresh, build and deploy jobs succeed. Open the environment URL,
   check a day's tooltip against the linked snapshot, then open the GitHub profile.

The workflow needs repository policy to permit the built-in `GITHUB_TOKEN` to
write generated files. It requests `contents: write` only in the refresh job;
the build job has `contents: read` and `pages: read`; only the deploy job has
`pages: write` and `id-token: write`. PR validation is read-only. There is no PAT,
no browser-side token, and no secret committed to the repository. If a branch
rule prohibits bot commits, refresh will fail explicitly; use your normal review
process to update snapshots or adapt the workflow to a reviewed update branch.
Do not weaken existing branch protections to make a push succeed.

The build job checks out the exact refreshed commit. Deployment is in the same
workflow, so it does not rely on a bot commit triggering a second workflow.
Only the four site files and the contribution JSON are published.

## Data provenance and failure behavior

`scripts/contributions.mjs` reads GitHub's anonymous contribution calendar at
`https://github.com/users/pablocamarillo/contributions`. It extracts dates and
GitHub's own `data-level` values (0 through 4) from day cells, and actual counts
from the corresponding tooltip text. It does not estimate counts from colors,
calculate its own quartiles, or insert synthetic days. The range is the full
rolling year returned by GitHub, aligned to Sunday week columns. The visible
range can include 365–371 days due to GitHub's week alignment.

The parser validates complete contiguous dates, unique days, tooltip coverage,
counts, levels, and equality between the daily sum and GitHub's displayed total
before writing generated assets. A failed request or changed HTML fails the
workflow and leaves the last committed snapshot intact. GitHub's HTML is not a
versioned API: if its markup changes, update the parser and regression fixture.
No third-party contribution service is involved.

`data/contributions.json` records the source, fetched timestamp, date range,
total, and every day's count/level. Its dates follow GitHub's response and are
not shifted to the viewer's timezone. The updated timestamp is UTC; late evening
in America/Chicago can therefore correspond to the following UTC date. The
calendar covers contributions visible to an anonymous profile visitor; it does
not reveal private repository details or promise parity with a signed-in view.
The site warns when a snapshot is more than 48 hours old. Schedules may be delayed
by GitHub, and scheduled workflows in inactive public repositories can be
disabled. Check Actions if the timestamp stops advancing.

`scripts/featured-project.mjs` refreshes the original team's public repository
metadata through GitHub REST and generates desktop/mobile cards. Project wording
is grounded in the team's README and credits. Stars are snapshot values, dated
on the card, rather than a live counter.

The frozen `assets/contributions-fallback.svg` is deliberately unchanged and
clearly linked as a historical fallback. It is not the active dashboard.

## Local verification

Use Node.js 24 or newer:

```sh
node --test
node scripts/contributions.mjs
node scripts/featured-project.mjs
node scripts/build-pages.mjs
```

Serve `_site/` using a local HTTP server to test the page. Opening `index.html`
directly as a `file:` URL can block JSON loading. The site uses relative paths,
so the same build works under the repository's GitHub Pages subpath.

On a narrow screen, scroll the calendar horizontally. Hover, tap, or focus a day
for its full date and count; use arrow keys to move between days. The README
uses a compact full-year SVG and links to the larger interactive version.

## GitHub rendering limits

GitHub displays README SVGs as images. Individual SVG day tooltips, focus states,
JavaScript, and embedded applications are not reliable or supported there.
The README wraps the image in a normal link to Pages. GitHub's image caching can
briefly show an older image after a refresh; the timestamp and linked JSON make
its provenance inspectable. The interactive calendar is functional only after
the Pages workflow has been deployed.

References: [custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages),
[publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site),
and [GITHUB_TOKEN permissions](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token).
