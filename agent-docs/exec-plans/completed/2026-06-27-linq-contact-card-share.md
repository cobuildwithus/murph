# Linq contact-card share after first outbound

## Goal

Share the configured Linq contact card shortly after the first eligible outbound
iMessage in a chat, with a per-chat retry cap of once every 48 hours.

Success criteria:

- A successful eligible Linq outbound can trigger `share_contact_card` after the
  message send completes.
- Shares are per chat and throttled for 48 hours by persisted hosted state with
  an in-flight claim to avoid concurrent duplicate provider calls.
- Contact-card sharing is best-effort and cannot turn a successful message send
  into a failed delivery.
- Cloudflare hosted egress allows only the specific Linq contact-card share
  endpoint.
- Focused tests, typecheck, and required verification pass or have a documented
  unrelated blocker.

## Scope

- In: Linq client method, hosted contact-card share state/helper, assistant
  runtime post-send hook/effects-port plumbing, Cloudflare egress allowlist,
  Prisma schema/migration, focused tests/docs.
- Out: provider-side contact-card create/update cron, standalone daily share
  jobs, silent-chat retries, non-iMessage channels, marketing/outbound copy.

## Constraints

- Preserve Linq deliverability guidance: no standalone silent retries, no
  third-outbound gating, prefer trust scaffolding immediately after the first
  successful outbound.
- Keep state minimal and keyed by chat lookup rather than raw chat IDs.
- Require positive iMessage/direct-chat evidence; unknown service or unknown
  directness skips sharing for this PR.
- Treat provider share failures as non-fatal and do not expose secrets or local
  identifiers.
- Coordinate with active hosted webhook lanes and keep changes narrowly scoped.

## Plan

1. Send this implementation plan to ReviewGPT and fold in concrete feedback.
2. Add the minimal no-body Linq contact-card share provider operation and
   Cloudflare egress allowlist entry.
3. Add persisted per-chat 48-hour hosted share state with claim and success
   timestamps plus a best-effort helper.
4. Invoke the helper after successful eligible Linq outbound sends using the
   final returned chat ID.
5. Add focused regression tests and update durable docs for the new egress path.
6. Run verification, parent final review, finish-task commit, push, open PR, and
   run the PR ReviewGPT loop to zero accepted findings.

## Outcome

- ReviewGPT plan feedback was accepted for provider-contract coverage,
  exact-route egress tests, two-day boundary coverage, and best-effort
  side-effect isolation.
- Implementation shares only after successful eligible direct iMessage outbound
  activity, uses blind chat lookup keys for persisted state, throttles successful
  shares for 48 hours, and releases stale in-flight claims after 10 minutes.
- Verification passed with `workspace-verify.sh test:diff` run sequentially
  after the final boundary fix.
Status: completed
Updated: 2026-06-27
Completed: 2026-06-27
