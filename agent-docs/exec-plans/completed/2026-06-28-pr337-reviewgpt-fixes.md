# PR 337 ReviewGPT fixes

## Goal

Address accepted ReviewGPT findings for PR 337 before handoff.

Success criteria:

- Active-member Linq mailbox wakes preserve direct-chat attestation so eligible
  direct iMessage assistant replies can trigger contact-card sharing.
- Runtime contact-card sharing uses one web-owned post-outbound callback instead
  of runtime claim/result/provider-call plumbing.
- Per-chat contact-card attempts are throttled for 48 hours even when the
  provider call fails or result recording is interrupted.
- Focused tests and required verification pass.

## Scope

- In: hosted Linq wake context, hosted-execution route/contract, web callback
  route/helper/state, Cloudflare web-control allowlist/effects port, focused
  tests, docs.
- Out: standalone contact-card jobs, provider-side contact-card setup, unrelated
  hosted webhook behavior.

## Plan

1. Add a single web-control after-outbound contact-card callback and delete the
   runtime claim/result/provider-call protocol.
2. Propagate direct-chat attestation in the active-member Linq mailbox wake.
3. Persist and enforce a 48-hour attempt timestamp before provider calls.
4. Update focused tests and docs for the simplified ownership model.
5. Run focused verification plus required diff verification, commit, push, and
   rerun ReviewGPT.

## Outcome

- Accepted ReviewGPT findings were addressed by propagating active-member
  direct-chat attestation, throttling contact-card attempts for 48 hours, and
  collapsing runtime sharing into one web-owned callback.
- Removed the runtime/operator-config Linq provider share method and Cloudflare
  provider-egress allowance for `share_contact_card`.
- Focused tests, web/workspace typecheck, and sequential `workspace-verify.sh
  test:diff` passed.
Status: completed
Updated: 2026-06-27
Completed: 2026-06-27
