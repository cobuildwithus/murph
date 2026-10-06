# Runtime cleanup failure diagnostics

Status: active
Created: 2026-10-06
Updated: 2026-10-06

## Goal

Distinguish resource parsing, control purge and acknowledgement failures in the existing bounded cleanup owner while preserving cleanup behavior.

## Success criteria

- A synthetic failure through the actual cleanup function emits one finite metadata-only diagnostic that identifies the failed boundary.
- Counts, exact revision fences, deadlines, retry scheduling, provider calls and canonical protection remain unchanged.
- Focused before/after proof, privacy checks, final ReviewGPT and required exact-head CI pass before a telemetry-only merge. Canonical deployment is separately verified.

## Scope

- In scope: existing resource cleanup owner, focused tests and its Web documentation.
- Out of scope: deletion/replay/repair, new retry policy, state/schema/dependencies, multipart recovery, device sync, provider behavior and other telemetry owners.

## Constraints

- Use ReviewGPT for telemetry authoring. Keep production investigation read-only.
- Reuse the existing console/Vercel pipeline and request correlation. Emit no identifiers, keys, payloads, messages, stacks or arbitrary error strings.
- The successful path stays quiet. Failed logging cannot change cleanup behavior.

## Risks and mitigations

1. Diagnostics could leak private error fields. Use only a closed category and validated numeric status; test hostile getters and synthetic private values.
2. Stage tracking could change cleanup semantics. Assert calls, revision fences, return values and requeue timing through the actual function.
3. Warning volume could grow with backlog. Emit at most once per caught failure within existing bounded batches; no new success logs or polling.

## Tasks

1. Confirm existing evidence and ownership; test parser, namespace and downstream object state read-only.
2. Ask ReviewGPT to author the minimal telemetry and focused synthetic proof.
3. Inspect the full patch and run before/after tests, typecheck, lint, complexity and docs checks.
4. Commit and push an isolated candidate; complete final ReviewGPT and exact-head CI.
5. Use only the canonical telemetry deployment path and verify revision and natural observations, preserving unresolved outcomes.

## Decisions

- Parser/key/namespace validity does not explain a caught request or acknowledgement failure. Existing Web request logs and provider traces do not retain the caught error.
- The existing generic error formatter permits arbitrary names/messages, so this diagnostic must use a finite classification.
- No functional cause is claimed or repaired. Internal-only telemetry does not require a public changelog.

## Verification

- Run focused actual-cleanup tests against original and patched source; require baseline diagnostic failures and patched success.
- Run adjacent retention tests, Web typecheck, scoped lint, complexity diff, docs drift/gardening and whitespace.
- Review every emitted field and verify mixed Web/Worker versions preserve the existing purge API and durable ownership contract.

## Candidate evidence

- ReviewGPT authored the telemetry and focused tests, then simplified finite classification into bounded maps and a local classifier.
- Original production source: 32 diagnostic assertions fail, 12 checks pass. Candidate: all 44 focused checks pass through the actual cleanup owner and injected control-client transport.
- Web typecheck, scoped ESLint, docs drift/gardening and whitespace pass. Complexity debt remains zero; maximum function complexity is 19.
- Parent review verified unchanged claims, acknowledgement predicates, deadlines, external-call order, retry scheduling and response shape. Native timeout/abort, real HTTP errors, hostile accessors and throwing logger cases pass.
- Final external review and required exact-head CI remain pending. No functional repair, replay or production-data mutation is included.
