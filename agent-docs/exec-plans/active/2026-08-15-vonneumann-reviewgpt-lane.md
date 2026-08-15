# Vonneumann ReviewGPT Lane

Status: active
Created: 2026-08-15
Updated: 2026-08-15

## Goal

- Make the existing Vonneumann Brave profile a first-class managed ReviewGPT
  browser lane on this Mac and in Murph's ReviewGPT wrapper, using the latest
  published ReviewGPT release.

## Success criteria

- The machine-local `Vonneumann.app` launches the existing isolated Vonneumann
  profile through the same installed Brave build as every other managed lane.
- The machine-local dispatcher recognizes the Vonneumann profile and rejects a
  stale named-app Brave version.
- `REVIEW_GPT_BROWSER_LANE=vonneumann` resolves profile `Default`, CDP port
  `9446`, and the Vonneumann user-data root.
- Automatic lane selection includes Vonneumann while preserving explicit
  same-thread lane continuity.
- The root dependency and lockfile resolve `@cobuild/review-gpt` `0.5.131`.
- Focused config tests, shell syntax checks, a ReviewGPT dry run, and direct
  local app/version/CDP proof pass.
- The exact pushed PR head passes the required preliminary ReviewGPT coverage
  lens and GitHub Actions.

## Scope

- In scope: the local named app and dispatcher, ReviewGPT lane mapping and
  random-pool admission, the published ReviewGPT dependency update, focused
  config coverage, and current ReviewGPT lane documentation.
- Out of scope: browser-profile migration, ChatGPT account changes, lane-wide
  tab cleanup, browser restarts for existing lanes, and changes to ReviewGPT's
  target lifecycle or model selection.

## Constraints

- Technical constraints: reuse the existing Vonneumann user-data root; reserve
  currently unused CDP port `9446`; launch the installed Brave build only when
  the named app reports the exact same version; preserve profile `Default` and
  balanced headful behavior.
- Product/process constraints: keep the solution additive and developer-
  tooling-only, preserve all existing lane identities, avoid touching user browser
  data, and use the isolated worktree/PR completion path.

## Risks and mitigations

1. Risk: A copied app bundle pins an older Brave build.
   Mitigation: build the named app from the installed app, compare both bundle
   and executable versions, and keep the dispatcher fail-closed on mismatch.
2. Risk: Reusing a CDP port or profile crosses browser-session ownership.
   Mitigation: prove `9446` is unused, map only the existing Vonneumann root,
   and exercise explicit dry-run selection before any live ReviewGPT send.
3. Risk: Expanding the random pool changes default selection incorrectly.
   Mitigation: extend the existing ordered pool and bounded count rather than
   adding another selector or state owner; cover explicit and automatic paths.

## Tasks

1. Inspect the existing managed-app, dispatcher, lane-selector, and test
   contracts; confirm Vonneumann's retained profile and free port.
2. Create and validate the machine-local Vonneumann named app, then extend the
   local dispatcher without changing the browser profile contents.
3. Add Vonneumann to the repo-owned lane name, port, explicit selector,
   automatic pool, bounds, tests, and current operations documentation.
4. Update Murph to the latest published ReviewGPT package with a narrow
   release-age exception and lockfile change.
5. Run focused tests, dependency guards, syntax/type checks, explicit dry-run
   proof, and direct local version/CDP proof; inspect the complete diff and
   privacy boundary.
6. Commit, push, open the PR, run the preliminary ReviewGPT coverage lens with
   CI, resolve findings, and complete the parent final review.

## Decisions

- Use CDP port `9446`: it is the unused slot between the existing managed lane
  ports and matches the previously established Vonneumann local convention.
- Reuse the retained Vonneumann profile instead of creating or copying browser
  state.
- Do not add a new abstraction; extend the existing closed lane maps and pool.

## Verification

- Commands to run: `bash -n scripts/review-gpt.config.sh`; the focused CLI
  release-script coverage test; `pnpm review:gpt pr-review --dry-run` with an
  explicit Vonneumann lane; local `plutil`, executable `--version`, codesign,
  and CDP checks; the affected typecheck selected by the verification map.
- Expected outcomes: Vonneumann resolves to port `9446`, the named app and
  installed Brave report the same version, the app signature is valid, the
  retained profile starts on its own CDP endpoint, existing lanes remain
  unchanged, and all focused checks pass.
