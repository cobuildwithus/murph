# Add the Apollo ReviewGPT browser lane

Status: active
Created: 2026-08-17
Updated: 2026-08-17

## Goal

- Add Apollo as a sixth isolated managed-browser lane for ReviewGPT, including
  a current-Brave local app, unique profile, CDP port, and custom icon.

## Success criteria

- `REVIEW_GPT_BROWSER_LANE=apollo` resolves to profile `Default`, the Apollo
  data root, and dedicated CDP port `9454`.
- A host can opt into six automatic lanes while the portable default remains
  four and all existing lane names, ports, and ordering remain unchanged.
- Spotlight exposes one current Apollo app with a distinct icon and native
  launcher; the app opens a visible window without ReviewGPT arguments.
- Focused config tests, typecheck, shell syntax, bundle validation, explicit
  dry-run selection, and live CDP proof pass.
- The updated pushed PR head passes its required preliminary ReviewGPT coverage
  lens and GitHub checks.

## Scope

- In scope: repository lane maps, bounds, tests, and operating guidance; the
  private dispatcher and machine-local lane preference; and Apollo's local app,
  icon, profile, launcher, registration, and live proof.
- Out of scope: changes to existing browser profiles, ChatGPT account state,
  ReviewGPT automation behavior, or committed browser binaries and artwork.

## Constraints

- Preserve Main, Eragon, Phlebas, Hercules, Mountain, Vonneumann, the `aragon`
  alias, explicit same-thread pinning, availability-aware selection, and the
  four-lane portable default.
- Use port `9454`, the next unclaimed even port after Main `9452`.
- Keep browser profile data, generated artwork, local paths, and account state
  outside committed or published artifacts.
- Extend the existing draft PR and isolated task worktree.

## Risks and mitigations

1. Risk: a sixth automatic lane can be selected before its host app is ready.
   Mitigation: retain the portable count of four and opt this host into six
   only after Apollo passes local bundle and CDP proof.
2. Risk: copied app bundles pin an older Brave build or fail through Spotlight.
   Mitigation: clone the installed build, use a native launcher, compare exact
   versions, ad-hoc sign, register, open, and verify the live bundle.
3. Risk: a duplicate port or profile mixes browser ownership.
   Mitigation: prove `9454` is free before launch and cover every lane's unique
   port and data root in the focused harness.

## Tasks

1. Extend the closed lane maps, ordered pool, count validation, focused tests,
   and current operating documentation.
2. Generate Apollo artwork and build a current-Brave app with unique metadata,
   native launcher, ICNS asset, and signature.
3. Extend the private dispatcher and machine-local preference after local
   provisioning succeeds.
4. Run focused repository checks, explicit dry-run selection, Spotlight,
   bundle, version, icon, and live CDP proof.
5. Review, commit, push, update the draft PR, and complete ReviewGPT and CI.

## Decisions

- Use display name `Apollo`, slug `apollo`, profile `Default`, and port `9454`.
- Keep generated artwork and the complete app bundle machine-local.
- Reuse the existing lane selector, dispatcher, copied-Brave bundle pattern,
  and native launcher behavior without adding a browser manager.

## Verification

- `bash -n scripts/review-gpt.config.sh`
- Focused `release-script-coverage-audit` lane tests.
- `pnpm --filter @murphai/murph typecheck`
- Explicit Apollo ReviewGPT dry run.
- `plutil`, `codesign`, executable/version/icon checks, Spotlight uniqueness,
  visible-window launch, and live CDP `9454` proof.
- Privacy-safe diff review, preliminary coverage ReviewGPT, required CI, and
  current-base merge-tree proof.
