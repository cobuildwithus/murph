# Batch attribution and connected-app failure status

Status: completed
Scope: patch authorship; full local verification and deployment handed off
Created: 2026-09-28
Updated: 2026-09-28

## Goal and boundary

Correct two proven private diagnostic losses against the supplied snapshot named
`a88454fbca8`: parsed knowledge/event batch attribution and caught connected-app
HTTP status. Deliver one apply-ready telemetry-only patch. The receiving local
agent owns full repository testing, Git, review, CI and deployment; this record
is not deployment evidence. No production systems or private data were accessed.

Preserve behavior, retries, RPC text, tool schemas/prompts, provider calls, output,
authority and durable work. Do not change PR3748's measurement-field allowlist
or tests, event-list projection, reply bookkeeping or browser compatibility.
Expected missing-record rejections and unresolved connection loss do not justify
a behavior correction. No dependency, configuration, provider or event is added.

## Completed work and decisions

1. Read the repository guidance, existing finite family/knowledge counter owners,
   strict batch envelope, profile reader, connected-app catch and private issue
   classification/reporting/sanitizer/record parser before editing.
2. Add only the three reviewed batch paths to existing labels. Derive knowledge
   counters at the parsed child owner with `readAssistantKnowledgeCounts`.
   Every producer of a knowledge aggregate now supplies counters, so the existing
   merger sums direct and batch contributions in either order without new state,
   partial-count repair logic, parser expansion or a merge rewrite.
3. Add one optional bounded `connectedAppsHttpStatus` scalar through an observer
   beside device telemetry. Reject proxies before descriptor reads; use only own
   data status/statusCode, nullish fallback and integer 100..599 validation.
   Leave device behavior and existing RPC error projection unchanged. Wrap only
   the three outer connected-app catch returns; successes, result guards and
   local admission/preflight refusals retain their previous shapes and effects.
4. Update the existing loss regression and family/cap tests; author one focused
   connected-app test file using fake ports and the mocked existing issue writer.
   Update the live diagnostics owner narrowly and index this closed handoff.

## Synthetic coverage authored

Batch tests exercise compact/noncompact success and failure, exact knowledge and
event labels, missing/invalid/conflict/duplicate/unknown/absent errors, mixed direct
success/failure contributions in both orders, timing and UTF-8 byte totals,
unknown paths, malformed envelope fallback, the 50/51 child boundary, unchanged
v2 reader roundtrip and old records without optional counters. Private argv,
slugs, error prose/codes and result sentinels must not reach persisted profiles.

Connected tests exercise valid dispatch through the fake port, ordinary errors,
invalid-response TypeError, structural status/statusCode 413, both calendar and
email write routes, official alerts, manage/search, exact RPC/retry guidance,
classification and sanitized issue record roundtrip. They retain one port call
and one classification row, check completion accounting separately, and prove
valid control/result-limit/admission paths. Observer tests reject invalid types,
ranges, accessors, ordinary/revoked proxies and private nested/coercible values,
without mutating original results/errors or changing device behavior. Real issue
writes, providers, deliveries and fetches are not used.

## Verification evidence and limits

Offline source smoke reproduced the base batch loss and exercised the patched
profile builder, both orderings, compact/noncompact metrics, six error cases,
50 children and the unchanged usage reader. It compared 36 base/head caught-error
cases across read, calendar/email write and official-alert routes: identical RPC
bytes/categories and exactly one fake-port call. Status survived the actual
classification, issue reporter, sanitizer and record parser with writes mocked.
Success, result-size and admission parity, immutable-result and accessor/proxy
checks passed. This isolated smoke admits synthetic batch envelopes at the schema
seam; it is not proof of full Zod parsing, dynamic request intake, the completion
reducer or repository Vitest/typecheck. The committed tests exercise those paths.

Global TypeScript 5.8.3 transpilation reported no syntactic diagnostics in the
seven changed/new TypeScript files; this is not semantic typechecking. Full
focused tests/typecheck are pending: the snapshot has no installed workspace
dependencies, Node is 22.16.0 rather than the required >=24.14.1, and Corepack's
pinned pnpm 10.33.0 download failed with registry DNS EAI_AGAIN. No dependency or
lockfile was changed to bypass this. Frog and its skill were absent;
`bash scripts/frog list` reported it unavailable. The plan-close helper was attempted;
missing repo-tools required moving this authored record to completed manually.
No tests supplied as prior evidence are counted as this patch's test results.

The handoff additionally checks the generated unified patch against pristine
snapshot files, verifies applied postimages, reverse application and whitespace.
A Git commit/head was not independently established from this ZIP.

## Acceptance handoff

Run on the repository-supported Node/pnpm toolchain with installed dependencies:

```sh
pnpm --dir packages/assistant-engine test \
  test/assistant-codex-command-family.test.ts \
  test/codex-runtime-helpers.test.ts \
  test/connected-apps-tool-failure-diagnostics.test.ts \
  test/assistant-codex-connected-apps.test.ts \
  test/connected-apps-email-send.test.ts \
  test/device-tool-failure-diagnostics.test.ts \
  test/assistant-tool-failure-diagnostics.test.ts \
  test/assistant-dynamic-tool-failure-boundary.test.ts
pnpm --dir packages/hosted-execution test test/assistant-usage.test.ts
pnpm --dir packages/runtime-state test test/assistant-runtime-issues.test.ts
pnpm --dir packages/assistant-engine typecheck
pnpm docs:drift
pnpm complexity:diff
git diff --check
```

The existing package test glob discovers the new test; no CI inventory change is
needed. Exact-head required CI and applicable review remain the local completion
owner's gates. No real-model journey is required for this telemetry-only change;
there is no provider-input or member-facing contract change to measure.

## Compatibility and rollout boundary

Live contract: `docs/hosted-runtime-log-database.md`, section "Batch read
attribution and connected-app failure status". Existing readers support both
record shapes and finite labels. Deploy compatible readers first wherever needed,
then producers; verify exact reader, Worker and runner bundle releases, including
warm containers. Observe only natural emissions in bounded windows. Separate 413
from status-absent evidence; otherwise-valid oversize is an efficiency question,
not proof of prompt error. Use batch counts for missing pages; do not double count
overlapping native/profile data or completion rows. No automatic rollback,
production mutation, induced failure, Git push or deployment was performed here.
