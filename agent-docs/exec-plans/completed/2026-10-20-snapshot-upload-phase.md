# Diagnose snapshot upload failures at the existing telemetry boundary

Status: completed
Created: 2026-10-20
Updated: 2026-10-20

## Goal

- Distinguish the failing direct snapshot upload boundary in the existing terminal checkpoint event so operators can investigate transport failures without guessing.

## Success criteria

- Synthetic failures identify a fixed upload phase while preserving the original failure, cancellation, bounded retries, and success behavior.
- Focused regression proof, relevant typechecks, complexity/privacy review, final ReviewGPT, and exact-head required CI pass.
- Report merge, actual production revision, and observation separately; deployment prerequisites do not imply recovery.

## Scope

- In scope: app-local direct-upload diagnostics and the existing runtime failure event, focused tests, and its durable telemetry contract.
- Out of scope: upload behavior, timeout/retry policy, provider authority, new logging events, product state, and device-sync recovery.

## Constraints

- Technical constraints: finite phase vocabulary, no paths, object keys, signed URLs, response content, or new external calls.
- Product/process constraints: ReviewGPT authors substantive changes; preserve the current terminal-event owner and the original failure semantics.

## Risks and mitigations

1. Diagnostic annotation could obscure cancellation or a nested failure.
   Mitigation: prove identity/cause preservation and unchanged cancellation and retry behavior with synthetic errors.
2. Native-image preparation may block production release.
   Mitigation: use the canonical release path, preserve its gates, and retain an explicit unresolved deployment state.

## Tasks

1. Confirm existing traces cannot identify the failed upload boundary and check overlapping PR diffs.
2. Obtain and critically inspect a scoped ReviewGPT implementation.
3. Prove new assertions fail against the original source and pass with the correction; run relevant typechecks and complexity.
4. Commit, push, review, and satisfy exact-head CI before authorized merge and deployment.
5. Verify the actual serving revision and use the native follow-up capability if available; otherwise report the concrete access blocker.

## Decisions

- The upload owner returns detailed timing only on success. Generic timeout errors currently leave the terminal failure with only `snapshotStage: upload`.
- Reuse the existing error-diagnostics path and terminal event; do not add a second telemetry pipeline.
- Internal-only telemetry has no member-visible changelog entry or assistant behavior change.

## Verification

- ReviewGPT authored the five-file implementation using a guarded repository snapshot. Parent review confirmed that the large upload diff is mostly indentation around the existing body, with four local phase assignments and one error annotation boundary.
- Tests-only proof against the original source: Cloudflare 32 failed / 276 passed; invocation bridge 1 failed / 114 passed. Every failure concerns the missing phase observation.
- With the implementation: Cloudflare runner-platform 308 passed; assistant-runtime invocation bridge 115 passed. The suites preserve success, caller interruption, replay bounds, existing session diagnostics, and omission of unknown, inherited, or accessor-backed phase values.
- Assistant-runtime and Cloudflare typechecks passed after the repository's normal local Prisma client generation.
- `pnpm complexity:diff --base HEAD -- apps/cloudflare/src/runtime-platform/workspace-snapshot-port.ts packages/assistant-runtime/src/hosted-runtime/snapshot-bridge.ts` passed: upload maximum 27 and debt 7 unchanged; bridge debt falls from 45 to 41.
- Existing snapshot orchestration hotspots remain at 56 and 24; the diagnostic append function falls to 21. A larger control-flow refactor would expand this observation-only correction without improving its claim.
- Docs drift and diff/privacy checks passed. The index routes to the telemetry owner and this evidence.
- Implementation and parent candidate review are complete. Final ReviewGPT, exact-head required CI, merge, actual deployment, and production observation remain separate delivery gates owned by the PR and the current sweep; this completed implementation record does not claim those outcomes.
Completed: 2026-10-20
