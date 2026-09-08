# Deliver vault files through Telegram

Status: completed
Created: 2026-09-04
Updated: 2026-09-04

## Goal and Product UX

Outcome: deliver requested files in a private Telegram conversation through the existing secure-file workflow.
Reaches: direct Telegram replies and existing iMessage file sends; preserve unsupported channel and group behavior.
Proof: synthetic tool availability, approval/replay, verified bytes, destination binding, multipart provider receipt, and a focused real assistant journey.

## Architecture

Reuse generated-delivery staging, the secure-action approval owner, outbox reconciliation, and Telegram transport. Share the existing binary-upload implementation with voice delivery. Add no dependencies, persistence, queues, or parallel approval state.
Preserve file identity and destination authority through dispatch. Ambiguous Telegram outcomes must never automatically resend. Update PDF authoring to check delivery capability first and write final bytes at the canonical generated-delivery location.

## Tasks

1. Extend private Telegram capability and existing file intent validation.
2. Add document transport and hosted approved-file loading; allow the exact Worker operation.
3. Align PDF instructions and add deterministic and real-assistant proof.
4. Run focused tests and typechecks, inspect complexity/privacy, update the durable contract and changelog, and commit the scoped result.

## Deployment

Deploy the Worker operation allowlist before activating the new runner tool. Existing record schemas and approval identities remain unchanged for iMessage. Older runners cannot dispatch new Telegram file intents; keep compatible runners once those intents exist.

## Verification

- Engine file transport and secure-file suites: 39 passed, including generated staging, byte validation, destination migration rejection, definitive-rejection retry, and uncertain-upload suppression.
- Hosted local-service capability suite: 16 passed, including private Telegram with/without approval, groups, and unknown audiences.
- Existing channel regression suites: 107 passed, including shared voice transport.
- Hosted approval and delivery slice: 18 passed, including approval denial, changed files, wrong target, and liveness expiry immediately before upload with zero provider calls.
- Worker Telegram egress slice: 29 passed.
- Engine, assistant-runtime, and Cloudflare typechecks passed on the final source.
- Final complexity guard passed; no increased complexity debt. Existing unrelated hotspots remain with their current owners.
- Parent review verified ownership, privacy, and deployment boundaries. No dependencies, persistence, queues, or approval owners were added.
- Privacy scan found no local identifiers in changed files. No private production evidence was copied into fixtures or docs.
- Changelog archive rendering: 9 passed.
- Composed prompt and secure-file proof: 39 passed. Existing saved files are explicitly supported at their current refs; generated staging remains limited to newly generated send-now files.
- `pnpm test:assistant:live -- --test 'hands a saved Telegram PDF to the secure file tool and explains pending approval'`: passed with `gpt-5.6-terra`, local subscription. Exactly one secure-file call produced one awaiting-approval intent. Raw model text contained no link or sent claim; the runtime appended exactly one trusted approval URL. Product UX verdict: Ready for the tested private-conversation journey.
- Web typecheck initially lacked the existing device-sync service declaration. `pnpm --dir packages/device-syncd build` prepared it; `pnpm --dir apps/web typecheck:prepared` then passed. No dependency source or configuration changed.
- No production sends are part of local verification.

## Product UX review

Ready: private Telegram file requests expose the existing secure-file tool, ask for approval truthfully, and use the approved destination and verified bytes for one document upload. Approval denial, changed bytes, wrong destinations, uncertain uploads, and expired pre-upload authority prevent inappropriate sends. Existing voice and iMessage paths retain their owners. Groups and unknown Telegram audiences remain unsupported for this file capability. Save-only PDF requests retain their ordinary durable owner path.

## Completion scope

This task authorizes the local fix and scoped commit. No PR, push, merge, production deployment, or member-facing test send has been requested. Changelog provenance is empty until a PR exists. Required exact-head CI and ReviewGPT belong to a later PR candidate.
Completed: 2026-09-04
