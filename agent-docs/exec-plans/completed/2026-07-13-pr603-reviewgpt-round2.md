# PR 603 ReviewGPT Round 2 Remediation

Status: completed
Created: 2026-07-13
Updated: 2026-07-13

## Goal

- Resolve the four accepted ReviewGPT round-2 findings without adding a new durable state owner.
- Preserve one semantic Telegram conversation while keeping bot identity as delivery-only authority.
- Make bot-bound target production safe across Vercel, Worker, and warm-runner rollout boundaries.

## Accepted findings

1. Bot-bound authority currently changes the semantic conversation identifier, splitting signup outreach from later inbound chat state.
2. Emitting the new target grammar immediately can let prior web writers erase it and prior runners terminally reject accepted welcome work.
3. The routing owner's unlocked read/choose/write transition can let a stale direct-authorization write defeat inbound precedence.
4. Hosted voice generation can call ElevenLabs before the Worker-owned bot identity mismatch is knowable inside the runner.

## Constraints

- Keep the bot id in delivery authority, not semantic conversation identity.
- Reuse the member-row lock for routing serialization.
- Pass only a nonsecret current bot id into the hosted runner and retain the Worker egress check as final authority.
- Gate only production of the new persisted grammar; compatible readers and senders may deploy first.
- Do not add schema, repair queues, reconciliation loops, or compatibility tables.

## Tasks

1. Normalize bot-bound Telegram targets to their bot-free semantic target for conversation hashing while preserving the full delivery target.
2. Serialize Telegram routing writes with the existing member-row lock and add focused precedence proof.
3. Inject the current public Telegram bot id into hosted runner env and reject mismatched voice targets before ElevenLabs.
4. Add a default-off web producer gate, rollout/rollback-floor documentation, and focused default-off/enabled tests.
5. Run focused owner verification, required delta audits, parent review, finish-task, push, CI, and ReviewGPT until clean.

## Verification log

- ReviewGPT round 2 on `87f936abc0`: four findings received and accepted after production-path validation.
- Pre-remediation exact-head GitHub Actions and Vercel: all green.
- Focused web tests: 100 passed across direct authorization, messaging identity, activation, and routing-store coverage.
- Focused Cloudflare runner-env tests: 47 passed.
- Focused assistant-engine channel-runtime tests: 45 passed.
- Focused assistant-runtime environment tests: 38 passed.
- Typechecks: contracts, web, Cloudflare, assistant-engine, and assistant-runtime passed. The first assistant-engine/runtime attempt exposed missing post-merge workspace links; `pnpm install --offline --frozen-lockfile` refreshed the unchanged lockfile links before the clean rerun.
- Privacy identifier scan of the uncommitted diff: clean.
- Parent rollout review found that a disabled producer was initially indistinguishable from an enabled-but-rejected probe and could therefore clear a stored bot-bound route during sync. The direct-authorization result now uses `undefined` for not attempted and `null` for attempted-but-rejected; caller and store tests prove gate-off preservation while rejection still clears stale direct authority.
- Final tri-state focused web verification: 157 tests passed across seven files; the accepted coverage-audit gap added a service-level encrypted-route table test, which passed 29 tests in its focused file and 137 tests in the auditor's five-file rerun.
- Final web ESLint for all changed route/service/test files: passed. Final web typecheck after the tri-state source changes: passed.
- Required security/privacy audit: clean on the updated tri-state delta.
- Required coverage-write audit: one service-boundary gap accepted and fixed; final re-audit clean. Residual live-provider gap remains the already-known real Privy-to-deployed-Worker-to-Telegram replay, not a missing deterministic repository test.
- Final post-cleanup service test (29), scoped ESLint, diff check, and web typecheck: passed.
- Parent final review: all four accepted ReviewGPT findings are closed; rollout gate-off preserves stored authority; changed-line privacy/secret and prohibited-cast scans are clean.
Completed: 2026-07-13
