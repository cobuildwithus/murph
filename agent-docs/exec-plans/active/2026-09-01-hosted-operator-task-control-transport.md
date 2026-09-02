# Restore hosted operator-task control transport

Status: active
Created: 2026-09-01
Updated: 2026-09-01

## Goal

- Let an already-admitted hosted operator notification reach its existing Web
  authorization and completion owner instead of failing at Cloudflare's
  outbound proxy boundary and retrying indefinitely.

## Success criteria

- The exact operator-task runtime control path is admitted only for `POST` by
  the existing central Cloudflare Web-control policy.
- A focused proxy regression proves the request is signed, member-bound, and
  forwarded without caller credentials.
- Cloudflare typecheck and the focused test pass.
- Exact-head review, required CI, protected deployment, and live runtime proof
  complete without changing mailbox, Temporal, or Web ownership.

## Scope

- In scope: one Cloudflare outbound policy entry, focused regression coverage,
  and the existing public recovery changelog item's source provenance.
- Out of scope: mailbox projection, retry policy, Temporal workflow behavior,
  Web route semantics, schema, queues, schedulers, and new state.

## Constraints

- Technical constraints: reuse the exported route constant and the single
  outbound policy owner; keep the existing runtime write-fence and callback
  signing path unchanged.
- Product/process constraints: do not expose production identifiers or private
  runtime evidence; preserve foreground work and all current authority checks.

## Risks and mitigations

1. Risk: admitting a broader route or method weakens the proxy boundary.
   Mitigation: map only the exact exported path in the existing POST policy and
   prove GET and suffixed paths remain denied through the shared policy tests.
2. Risk: a policy-only assertion misses transport behavior.
   Mitigation: reuse the full outbound proxy table test, which checks signing,
   member binding, credential stripping, body forwarding, and timeout policy.

## Tasks

1. Completed: added a failing full-proxy regression for the existing
   operator-task route.
2. Completed: added the exact route to the central Cloudflare POST policy.
3. Completed locally: ran focused Cloudflare verification and typecheck.
4. In progress: draft PR 2708 is open; update changelog provenance and run
   exact-head ReviewGPT and required CI.
5. Pending: merge, deploy through the protected Cloudflare workflow, and prove the
   affected runtime converges without the prior allowlist failure.

## Decisions

- The current production blocker is the missing Cloudflare outbound policy
  entry. Current `main` already contains the mailbox-owner correction from PR
  2700, so this change does not alter mailbox ownership.
- No new abstraction is warranted: the path, Web route, effects-port caller,
  signing transport, and policy owner already exist.

## Verification

- Failed before the fix: focused `runner-outbound` proxy-table test, with the
  exact operator-task POST policy resolving to `allowed: false`.
- Passed after the fix: all 221 tests in
  `apps/cloudflare/test/runner-outbound.test.ts`.
- Passed: `pnpm --dir apps/cloudflare typecheck`.
- Remaining: changelog fragment test if provenance changes, exact-head required
  GitHub checks, ReviewGPT, merge-tree proof, protected deployment, and bounded
  production runtime-log/control-row checks.
