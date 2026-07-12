# PR 557 ReviewGPT DOM Model Attestation

## Goal

Make concrete-model ReviewGPT completion proof fail closed: the confirmation text, platform model slug, and captured response must come from one fresh assistant snapshot immediately following the exact user turn committed by this run, and successful file evidence must be minimal, private, atomic, and stale-proof.

## Constraints

- Do not launch a browser or ReviewGPT from this lane.
- Do not commit or push; hand off a reviewed dirty diff and verification evidence.
- Keep the evidence schema minimal and exclude prompt, response, URL, conversation, DOM, and account data.
- Preserve current-selection behavior and partial-response diagnostics while emitting no evidence for incomplete or failed runs.
- Patch only the pinned `@cobuild/review-gpt` dependency and its repo coverage harness.

## Plan

1. Extract visible rendered confirmation lines and platform model metadata from the same assistant DOM snapshot.
2. Bind eligible assistant snapshots to the exact committed user-turn signature and reject concurrent or pre-prompt turns.
3. Derive a minimal response digest record and write response/evidence atomically with owner-only permissions.
4. Remove only the derived stale sidecar before synchronous runtime validation and browser work.
5. Add focused DOM, ownership, evidence, filesystem, serialization, and source-order regressions.
6. Regenerate the canonical dependency patch and lock hash, then run scoped and repo verification plus independent re-audits.

## Verification

- Installed driver/shared-module syntax passed; the published dependency's own typecheck script cannot run because its package artifact omits `tsconfig.json`.
- Focused CLI release-script coverage audit passed: 33 tests.
- CLI typecheck passed; full CLI suite passed: 114 files and 1,057 tests.
- Frozen install passed; the canonical patch applies to a pristine cached package base.
- Patch SHA-256 is `fb49eb83e85f201eaeb8d3ab883e756b917a4e7e442d3fce544091f9ed2f4c67`, present in exactly three lockfile references.
- `pnpm test:diff` passed, including affected package typechecks/tests and web/Cloudflare verification.
- Diff check and identifier privacy scan passed.
- Independent DOM and evidence re-audits are clean after the hidden-layout, stale-sidecar, concurrent-turn, and nonce-collision fixes.

## State

Complete and ready for parent review. The final dirty diff is verified; this lane intentionally did not launch a browser or ReviewGPT and did not commit or push.
Status: completed
Updated: 2026-07-11
Completed: 2026-07-11
