# Restore hosted cron delivery correlation

Status: completed
Created: 2026-10-24
Updated: 2026-10-24

## Outcome and invariant
Make queued cron completion and durable delivery reconciliation joinable in the hosted runner without forwarding platform secrets, changing delivery behavior, or adding state or I/O. Sent evidence remains an outbox terminal fact, never a handset receipt.

## Evidence and ownership
The shared fingerprint helper reads platform-only environment keys. The hosted environment policy deliberately excludes those keys. Current synthetic tests inject the excluded key, so they do not cover the production environment contract. The cron producer therefore returns null in a valid hosted environment. Existing terminal observers and log readers already carry the optional field. PR 4347 introduced the observation; it is merged. No open PR changes this correlation owner. Other local worktrees remain untouched.

## Approach
Ask ReviewGPT to inspect and implement the smallest privacy-safe correlation from existing opaque delivery identity. Do not forward secrets, broaden trust, change persisted state, add a pipeline, or change retries. Prove identity generation and retained intent behavior before selecting a hash domain. Maintain safe omission for unsupported legacy shapes if needed. The existing producer and projection remain owners.

## Proof and release
Apply regression tests against unchanged source first. Cover valid hosted env, stable same-job/intent correlation across process restart, different jobs/intents, missing or malformed identity, privacy, and unchanged observer/delivery semantics. Run affected tests/typechecks, complexity and docs guards; inspect the full patch. Push a draft PR, then Ready and final ReviewGPT concurrently with required CI. Merge and use the canonical deployment workflow after gates pass. Verify actual serving release and natural correlation. Native heartbeat capability is unavailable; report that concrete observation blocker and preserve deadlines. Do not treat retrospective checks as the required cadence.

## Status
- [x] Source contract and ownership inspected.
- [x] ReviewGPT implementation and pre-change proof. Two composed tests fail on the unchanged helper; the corrected engine suites pass 322 tests and engine typecheck on Node 24.22.1. The helper validates the owner-generated UUIDv4 format and hashes the domain-separated pair; unsupported legacy identities stay null.
- [x] Focused validation and parent candidate review: 322 engine and 158 hosted maintenance tests pass, along with both package typechecks, complexity, docs drift, gardening and whitespace checks on Node 24.22.1. Hosted projection proof covers both old h1 and new cd1 schemes. No source hotspot exceeds 20. Internal telemetry only, so no public changelog or real-Codex provider-input journey is applicable.
- [x] Final ReviewGPT round 1 PASS at `6c82a1d756c5185f77ca829c836d4e399993ccfc`; Mountain submitted to `gpt-6-pro`, the waiter enforced at least 180 seconds, and exact response hash/turn checks pass. No findings. Parent final review accepts the narrow implementation and its focused proof.
- Release follow-through remains with the production-sweep automation: final documentation closeout receives exact-head CI before merge, then canonical deployment and serving-release proof. Native same-chat scheduling is confirmed disabled, so the four-hour cadence is a reported capability blocker, not completed observation. No production outcome is claimed by this implementation record.
Completed: 2026-10-24
