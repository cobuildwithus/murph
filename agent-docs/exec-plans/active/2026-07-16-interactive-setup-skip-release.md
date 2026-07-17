# Fix interactive setup skip and release

Status: active
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Make the published Murph onboarding wizard complete successfully when the
  user selects the supported `Skip for now` assistant option, then publish and
  prove the corrected package through a fresh registry install.

## Success criteria

- Preserve `null` from the wizard as an absent OSS option instead of converting
  it into an explicit conflicting flag.
- Add a regression that fails at the real wizard-to-assistant-resolver boundary
  before the fix and passes afterward.
- Pass truthful owner verification, the required coverage audit, parent final
  review, PR CI, and the exact-head ReviewGPT gate.
- Publish the corrected patch version through the trusted release workflow.
- Install the exact published package in a fresh detached worktree, complete the
  real TTY wizard against disposable local state, observe the post-setup startup
  path, and validate the active vault plus installed CLI shims.

## Scope

- In scope: the setup wizard handoff, its focused regression test, patch-release
  metadata, trusted npm release, and isolated post-publication runtime proof.
- Out of scope: changing setup choices, weakening skip-option conflict checks,
  configuring real assistant credentials, channels, scheduled updates, or
  wearable providers.

## Constraints

- Preserve all unrelated worktree and coordination-ledger changes.
- Keep registry age-policy overrides command-scoped; do not change global npm
  configuration.
- Use disposable HOME, vault, and toolchain paths for the interactive proof so
  normal credentials and operator state remain untouched.

## Tasks

1. Reproduce and prove the wizard-to-resolver failure.
2. Implement the smallest handoff correction and focused regression.
3. Run scoped verification, required audits, and parent final review.
4. Prepare, commit, push, review, and merge the patch release.
5. Tag and publish through the trusted workflow, then repeat the fresh-install
   interactive setup proof against the exact registry version.

## Verification

- Focused setup-surface regression red before the source change and green after.
- Truthful setup-cli diff/owner coverage and typecheck selected by the repo
  verification workflow.
- Packed/published package install with the real `murph onboard` TTY flow,
  disposable setup state, post-setup startup evidence, vault readback, and shim
  version checks.

## Local completion evidence

- The focused setup-surface regression failed before the source correction and
  passed afterward.
- `pnpm test:diff` passed the setup-cli and public CLI reverse-dependent lane:
  124 setup-cli tests and 1,090 CLI tests, plus affected typechecks and guards.
- The required coverage-write audit found the existing boundary proof complete
  and made no edits.
- A built-CLI TTY run selected `Skip for now`, opted out of updates, channels,
  and wearables, initialized the vault, passed the runtime doctor, installed
  shims and the default-vault selection, opened interactive chat, and exited
  cleanly against disposable local state.
