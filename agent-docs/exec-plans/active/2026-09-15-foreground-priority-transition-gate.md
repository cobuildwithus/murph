# Gate foreground priority across runtime transitions

Status: active
Created: 2026-09-15
Updated: 2026-09-15

## Outcome and scope

Publish the existing foreground-mode fix as PR #3481, obtain final ReviewGPT
and exact-head CI, and prevent first-admission-only coverage from hiding
later-message priority inversions. Production deployment and merge are excluded.
The earlier completed implementation plan remains immutable.

## Escape analysis

- PR #2448, commit `7b3b8b8e78`, introduced the explicit owner-wake comparison
  against the invocation's original processing mode. Qualified foreground
  promotion already existed; the comparison did not account for that history.
- PR #3399, commit `d0cb50f5ab`, fixed consumption of the qualified batch and
  added two promotion tests. Both use a zero idle delay, return no assistant
  progress, and abort after first admission. Neither exercises duplicate wakes,
  a later message, or post-reply checkpoint interruption.
- Both PRs recorded successful release/package checks. The missing evidence was
  a composed transition scenario, not proof that a failing check was ignored.
- Hosted-local priority E2E covers first foreground delivery after background
  work. Its snapshot-ordering journey starts with a default-owned warmup.
  Neither combines promotion history with repeated foreground wakes and later
  message arrival through the checkpoint lifecycle.

## Prevention

Use one production-entrypoint contract across three starting histories: default
ownership, device-completion promotion, and system-checkpoint promotion. Apply
four journeys to each: repeated messages during quiet time, snapshot-time input,
provider changes, and shutdown. All normal histories must reach three assistant
admissions, preserve the full quiet window after the latest input, interrupt a
snapshot, and eventually finish deferred durable effects.

Run this 12-case matrix explicitly before the broad build in the existing
required release build/typecheck job. Keep the normal package-coverage discovery
as well. The existing Release checks aggregate requires that job to succeed.
No new check name, branch-protection mutation, credentials, or hosted service
is needed. CI policy proof rejects deleting, conditionally skipping, or
softening the gate.

## Verification and review

- Initial fix: 136 focused runtime tests, runtime typecheck, complexity and docs
  checks passed. Changelog: 10 archive-rendering tests and Web typecheck passed.
- Extended contract: 12 production-entrypoint cases passed.
- Restoring the original startup-mode comparison fails all four normal
  conversation journeys across both promotion histories; the two default-owner
  controls pass. Failures catch premature snapshots or return before the idle
  wait. Production source was restored byte-for-byte afterward.
- All 27 CI policy tests pass, including the three disabled-gate mutations.
  Runtime typecheck, complexity diff, docs drift, and whitespace checks pass.
- ReviewGPT round 1 started on `ad1c279e59cceb162ebb3170cb03d1a3033f54c8`
  alongside CI, before prevention work as requested. Final proof will include
  the additional gate and tests.
- Round 1: PASS, no qualifying findings. Eragon lane, verified `gpt-6-pro`,
  full snapshot and exact response identity confirmed. Review traced both
  changed handoffs, repeated wakes, interruption, provider/shutdown authority,
  and deferred effects. Round 2 will include the added CI gate.
- Product UX: Ready at the deterministic scheduling boundary. Assistant model
  generation, outbound transport, and production latency remain outside this
  test-port proof; no prompt, provider-input, tool, or reply policy changed.
- Changelog: `2026-09-15/foreground-reply-priority` in this PR. Additional
  prevention changes affect tests and CI only.
