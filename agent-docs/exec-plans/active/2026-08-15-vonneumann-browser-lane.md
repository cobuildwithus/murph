# Add the Vonneumann ReviewGPT browser lane

Status: active
Created: 2026-08-15
Updated: 2026-08-15

## Goal

- Add `Vonneumann` as a fifth isolated ReviewGPT managed-browser lane, backed
  by its own local Brave app bundle, profile directory, CDP port, and custom
  icon, without changing the existing four lanes.

## Success criteria

- `REVIEW_GPT_BROWSER_LANE=vonneumann` resolves to the Vonneumann app/profile
  and an unused dedicated CDP port.
- Automatic lane selection supports all five isolated lanes after a
  provisioned host opts into lane count five, while the portable repository
  default remains the existing four lanes.
- Focused tooling tests, shell syntax validation, and a ReviewGPT dry run pass.
- The local Vonneumann app bundle has a unique bundle identifier, display name,
  custom icon, executable Brave binary, and valid ad-hoc code signature.

## Scope

- In scope: ReviewGPT lane config, focused regression assertions, the canonical
  ReviewGPT operating doc, machine-local lane preferences, and the local app
  bundle/profile mapping.
- Out of scope: browser automation behavior, ChatGPT account migration, changes
  to existing lane profiles, and committed browser binaries or generated icon
  artwork.

## Constraints

- Technical constraints: preserve `main`, the `aragon` alias, existing ports,
  availability-aware random selection, and same-thread lane pinning. Use CDP
  port `9446`, which is currently unclaimed and fits the existing port series.
- Product/process constraints: keep browser/profile data machine-local, do not
  expose personal identifiers, and run the required PR-lane specialist review
  concurrently with CI once the exact candidate head is pushed.

## Risks and mitigations

1. Risk: enabling a fifth random choice can break older worktrees that do not
   recognize `vonneumann`.
   Mitigation: make the machine-local selector include Vonneumann only when the
   calling checkout's config declares that lane; older worktrees retain their
   four-lane pool.
2. Risk: cloning or re-signing the app bundle can corrupt its executable
   layout.
   Mitigation: clone a current matching Brave lane bundle, change only bundle
   identity/icon metadata, ad-hoc sign it, and verify the signature, executable,
   icon, and version before launch.
3. Risk: a live port/profile collision could mix browser state.
   Mitigation: verify port `9446` has no listener and use the dedicated
   `MurphReviewGPT/Vonneumann` profile directory.

## Tasks

1. Extend lane display, port, count, automatic selection, and explicit pinning.
2. Update focused release-script assertions and dynamic selection proof.
3. Update the canonical ReviewGPT lane documentation.
4. Build the local custom-icon Vonneumann app bundle and update the guarded
   machine-local five-lane selector.
5. Run focused tests, shell/bundle checks, and a Vonneumann dry run.
6. Review, commit, push, open the PR, and complete required ReviewGPT/CI gates.

## Decisions

- Use the exact user-supplied display spelling `Vonneumann` and lowercase slug
  `vonneumann`.
- Use port `9446`; it is distinct from Phlebas `9442`, Hercules `9444`, Eragon
  `9448`, Mountain `9450`, and Main `9452`.
- Keep the portable repository default at four lanes. Hosts opt into all five
  through the existing machine-local lane-count preference only after the
  Vonneumann profile is provisioned.
- Keep the generated icon and full app bundle local rather than committing
  machine-specific binary assets.
- Use a small bundle-local launcher to supply the lane's CDP port and profile
  defaults while preserving caller overrides. The launcher also uses Brave's
  mock keychain mode so a newly isolated local profile can reach CDP without a
  blocking macOS Keychain prompt.

## Progress

- Repository config, focused assertions, and operating documentation now
  recognize Vonneumann as the fifth lane.
- The machine-local selector admits Vonneumann only for checkouts whose config
  supports it, so older worktrees keep their existing four-lane pool.
- The local app bundle is installed with a unique identifier, launcher,
  isolated profile, ad-hoc signature, and generated icon. Its CDP endpoint is
  live on port `9446`.
- The preliminary specialist review identified the unprovisioned-host default
  risk and missing dynamic pin/isolation proof. Both findings were accepted and
  remediated without adding a provisioning detector or new abstraction.

## Verification

- `bash -n scripts/review-gpt.config.sh`
- Focused `release-script-coverage-audit` test invocation.
- An exact-head `completion-specialists` run pinned to
  `REVIEW_GPT_BROWSER_LANE=vonneumann` with safe PR-preflight inputs.
- `codesign --verify --deep --strict`, `plutil -lint`, bundle metadata readback,
  executable/icon checks, port mapping readback, and privacy-safe diff review.

Current evidence:

- Shell syntax checks pass for the repository config, machine-local selector,
  and bundle launcher.
- Focused static and dynamic `release-script-coverage-audit` tests pass,
  including portable four-lane default behavior, host opt-in selection of
  Vonneumann, explicit pinning, unique ports/profile isolation, and later-round
  prompt reuse.
- `pnpm --filter @murphai/murph typecheck` passes.
- Bundle signature, plist, executable, icon, version, wrapper-equivalent lane
  readback, older-worktree compatibility, and live CDP checks pass.
- The exact-head specialist run packaged and submitted through the existing
  Vonneumann profile on port `9446`. Its two findings were accepted and fixed;
  the exported response reported unknown model confirmation, so model
  provenance remains an explicit ReviewGPT evidence gap rather than a pass.
