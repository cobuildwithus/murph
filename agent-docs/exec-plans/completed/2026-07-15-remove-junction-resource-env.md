# Remove Junction timeseries resource override

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Remove the retired `JUNCTION_TIMESERIES_RESOURCES` environment and hosted
  serialization override so Junction compact timeseries resources have one
  code-owned source of truth.

## Success criteria

- No current source, deploy configuration, workflow, runtime documentation, or
  test fixture forwards or advertises `JUNCTION_TIMESERIES_RESOURCES`.
- Junction runtime configuration always derives its timeseries resource set
  from the existing compact defaults and closed allowlist.
- Hosted runtime serialization strips programmatic `timeseriesResources`, and
  parsing rejects that field as a retired external override.
- Dense known streams such as steps, distance, active calories, heart-rate
  samples, and weight remain excluded from default ingestion.
- Focused owner tests, stale-key searches, truthful diff verification, hosted
  device-sync E2E when locally available, CI, and exact-head ReviewGPT pass.

## Scope

- In scope: device-sync provider env/config/manifest/serialization ownership,
  Worker and hosted-local env forwarding, Cloudflare deployment workflow and
  current runtime docs, wearable fixture capture/replay setup, and focused
  tests.
- Out of scope: internal normalized Junction `timeseriesResources`, importer
  provenance, historical completed plans, schema or persisted-state changes,
  and unrelated Junction resource behavior.

## Constraints

- Base this cleanup directly on current `main` at `b9d515cff9`; do not commit,
  push, open a PR, or run ReviewGPT before the requested fresh coverage audit.
- Preserve the compact defaults, closed allowlist, unknown-resource rejection,
  and fallback behavior for programmatic known-dense-only configurations.
- Prefer deletion and existing serialization enforcement; add no feature flag,
  compatibility parser, migration, or alternate state owner.
- Preserve unrelated active work and do not edit immutable completed plans.

## Risks and mitigations

1. Risk: removing the env path could accidentally remove the provider's
   internal normalized resource list.
   Mitigation: retain the internal config field and normalization tests while
   deleting only external env and serialization ownership.
2. Risk: Worker and container versions can temporarily differ during rollout.
   Mitigation: both old and new consumers default safely when the field is
   absent, and current production proof showed the binding already absent.
3. Risk: Cloudflare deployment helpers can retain redundant hand-maintained
   Junction lists after the provider env entry is removed.
   Mitigation: keep the manifest-derived list as the sole variable owner and
   delete the redundant explicit Junction blocks.
4. Risk: the latest managed-container post-deploy smoke was red for an
   unrelated issue.
   Mitigation: require one green managed-container smoke before this cleanup is
   shipped, then check binding names and device-sync default behavior.

## Tasks

1. Remove the external env key and parsing path from Junction config owners.
2. Retire the hosted serialization field through both current-main serializer
   tables and the provider manifest/type boundary.
3. Remove Worker, hosted-local, workflow, docs, and fixture forwarding.
4. Update focused tests to prove stripping, rejection, compact defaults, and
   dense-resource exclusion.
5. Run focused tests, stale-key searches, `git diff --check`, truthful
   `test:diff`, and hosted device-sync E2E when the environment permits.
6. Return the uncommitted worktree for fresh coverage audit before any commit,
   push, PR, or ReviewGPT run.

## Decisions

- Keep `timeseriesResources` on the internal Junction provider config because
  it remains the normalized runtime value and a useful direct test seam.
- Remove it only from the external environment and hosted serialized envelope.
- Use the existing disallowed-field mechanisms to reject stale hosted payloads
  explicitly while clone paths silently omit the internal value.
- Land the eventual reviewed change atomically; splitting the env and hosted
  serializer changes would temporarily preserve a partially reachable override.

## Verification outcomes before coverage audit

- Focused device-sync config, runtime-config, provider-manifest, and Junction
  provider coverage passed: 260 tests.
- Focused Cloudflare runner-env and deploy-automation coverage passed: 72 tests.
- Wearable fixture capture coverage passed: 6 tests.
- Package typechecks passed for device-syncd, assistant-runtime,
  hosted-local-harness, and Cloudflare. The incremental workspace build also
  passed.
- The tracked stale-key scan and `git diff --check` passed.
- `pnpm test:diff` passed all repo guards, 336 repo-tool tests, and all 14
  affected package typechecks. It stopped in untouched assistant-engine outbox
  coverage after 2,231 tests passed: one terminal-intent pruning test timed out
  at 60 seconds and left cleanup residue, then a later assertion in the same
  file failed. The file-only and exact-test reruns reproduced only the same
  timeout, with the later assertion passing when the cleanup cascade was absent.
- The hosted Junction replay E2E passed the static-boot importer closure that
  blocked PR #690, but both bounded attempts stopped during runner-bundle
  preparation before stack or scenario startup because assistant-engine's
  `vault-cli --llms-full --format json` manifest load timed out. The exact
  assistant-engine build passed once in isolation between those attempts.
- No commit, push, PR, ReviewGPT, or completion audit was run; this worktree is
  intentionally ready for the requested fresh coverage audit.

## Required coverage-write audit outcome

- The independent coverage-write audit passed with no unresolved finding and
  changed tests only.
- Negative-input proofs now inject a stale
  `JUNCTION_TIMESERIES_RESOURCES` binding and verify that device-sync config,
  runner projection, deploy workflow/optional variables, and hosted-local
  Wrangler/env serialization all omit it.
- The direct timeseries resource-job proof now constructs Junction without an
  explicit timeseries list, so it exercises the code-owned compact defaults;
  the existing dense-resource fallback coverage remains intact.
- Focused verification passed device-sync 260/260 plus a final Junction
  provider rerun at 198/198, Cloudflare runner/deploy 72/72, hosted-local
  environment 94/94, wearable fixture capture 6/6, and the device-sync
  typecheck. `git diff --check` passed, and the retired key remains only as
  negative test input/assertion text.

## Verification

- Focused device-sync config, runtime-config, provider-manifest, and Junction
  provider tests.
- Cloudflare runner-env and deploy-automation tests plus wearable fixture
  capture tests.
- Package typechecks for device-syncd, assistant-runtime,
  hosted-local-harness, and Cloudflare.
- Tracked stale-key scan excluding immutable completed execution plans.
- `git diff --check` and the repository's truthful `pnpm test:diff` lane.
- Hosted device-sync E2E, including Junction direct-resource replay, when local
  prerequisites are available.
- After the requested local audits and later PR creation: full required CI and
  exact-head ReviewGPT with zero accepted findings.
Completed: 2026-07-15
