# PR 603 ReviewGPT Round 11 Remediation

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Preserve bot-bound Telegram route-change obligations across the documented mixed-version rollout.
- Wake active hosted runtimes after Privy commits a `member.channels.updated` mailbox item.
- Use the canonical Telegram delivery target as the single request-bound bot identity.

## Accepted findings

1. Web currently includes `assistantNotificationRoute` while the bot-bound producer flag is off, so an old runner can consume and discard the route-change obligation during the documented Web-first compatibility window.
2. Privy Telegram sync commits an active-member channel update but discards its mailbox dispatch, leaving route-suspended onboarding automation without an immediate wake.
3. The internal Telegram bot-id header duplicates the bot identity already encoded in the canonical delivery target and adds a second cross-checking surface with no independent caller.

## Constraints

- Keep the Web-first signed authorization callback rollout, but omit the additive route obligation until the existing producer flag is enabled after the Worker/runner converges.
- Signal only after the transaction commits, before later fallible completion work, and keep runtime signaling best effort.
- Preserve bot-token matching by comparing the canonical target's bot id with the real injected provider token; keep the public bot-id environment check for voice routes.
- Add no replay queue, shadow routing state, or second feature flag: bot-bound targets cannot be produced before the existing flag is enabled, and the rollout waits for prior Web functions to drain.

## Tasks

1. Add focused failing regressions for gated route obligations and the missing Privy post-commit wake.
2. Gate `assistantNotificationRoute` with the existing producer flag and document why no replay is needed.
3. Return and signal the Privy channel-update dispatch immediately after commit.
4. Delete the duplicate bot-id header and validate bot/token authority from the canonical delivery target.
5. Run focused owner tests/typechecks, required completion audits, scoped verification, finish-task, push, CI, and exact-head ReviewGPT until clean.

## Verification log

- ReviewGPT round 11 on `b5993ee2884d`: three accepted findings with valid exact-head completion and model evidence.
- Focused Web member-channel and Privy service tests passed 42/42. The producer-off case proves the route-obligation property is absent, and both Privy transaction branches prove post-commit best-effort signaling; the public branch also proves signaling precedes later invite creation.
- Cloudflare runner egress passed 230/230; assistant channel runtime passed 47/47; operator Telegram helpers passed 32/32. Matching canonical bot targets reach the callback/provider, mismatched bot identity fails before either, and no duplicate bot-id header remains.
- Affected Web, Cloudflare, assistant-engine, operator-config, and contracts typechecks passed. The hosted Web production build, Next typecheck, static generation, and trace check passed.
- Scoped `pnpm test:diff` passed dependency, workspace-boundary, hosted-runtime, Temporal, crypto, raw-health-log, and affected typecheck guards. The affected package graph exposed unrelated CLI subprocess timeouts under parallel load; an isolated rerun of the four reported CLI files also stopped producing output and was terminated after several minutes. No changed Telegram owner suite failed.
- Coverage-write audit: no unresolved material gap after strengthening producer-off field absence, post-commit ordering, best-effort failure, and both Privy transaction branches.
- Security/privacy audit: no validated Medium+ finding; confirmed mixed-version gate safety, exact canonical target/token/current-route checks before provider entry, upstream header stripping, member-bound post-commit signaling, and no new persisted state or sensitive logging.
- Focused Web ESLint, `git diff --check`, and identifier/credential diff scans passed.
Completed: 2026-07-14
