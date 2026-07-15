# Low-Risk Approval Simplification

## Outcome

Allow an authenticated personal Murph conversation to change the member's eligible model and reasoning preferences directly, without generating a passkey-backed approval link, while preserving approval or stronger authenticated handoffs for sensitive disclosure, delegated access, identity, payment, and irreversible actions.

## Evidence and constraints

- Reproduce the observed model/reasoning path from assistant tool selection through the web-owned configuration mutation and approval-link response.
- Inventory all uses of the hosted approval subsystem before changing shared code.
- Prove vault file sharing and other sensitive approval-backed operations do not inherit the low-risk bypass.
- Keep `apps/web` as the sole durable owner of hosted model and reasoning preferences, with existing eligibility and billing validation.
- Do not add a second preference store, compatibility manager, queue, or broad action-risk framework.
- Preserve current-turn semantics: a saved model or reasoning preference applies on the next hosted invocation.

## Planned scope

1. Trace approval creation, retrieval, completion, expiry/account binding, and conversation outcome delivery.
2. Classify every approval action by effect and isolate assistant configuration from sensitive operations.
3. Route model/reasoning updates through the existing signed, member-bound, active-runtime-write-fenced web control boundary without an approval row or public link.
4. Update focused contracts, tests, product/architecture docs, and assistant guidance.
5. Run scoped verification, required coverage and cross-cutting review, final privacy/diff inspection, scoped commit, PR, ReviewGPT, and CI.

## Verification target

- Focused tests prove direct eligible configuration updates, rejected ineligible targets, unchanged no-op behavior, next-invocation semantics, and no approval URL creation.
- Approval tests prove vault sharing and every remaining sensitive action still require the existing approval flow and remain member-bound/expiry-safe.
- Relevant owner coverage, typecheck, required completion audits, and PR gates pass.

## Deployment posture

Determine from the traced boundary. Prefer an additive web-first/runner-compatible change if both planes are touched; document any safe deploy order and rollback floor before handoff.

## Completion evidence

- Root cause: the unavailable approval URL carried a 31-character action id,
  while the approval contract generates and accepts 32-character ids. The
  approval owner returned the exact URL, but the assistant model shortened it
  while composing the reply.
- Configuration updates now use the sole accepted assistant input id for the
  active turn. Web binds that id to the callback member and exactly one live
  conversation mailbox row inside the existing preference-write transaction;
  existing access, model availability, and Sol entitlement checks remain the
  mutation authority.
- Vault sharing remains approval-gated. The runtime preserves every exact
  approval-owner URL, removes corrupted same-route candidates, strips trailing
  sentence punctuation from exact candidates, and overrides or rejects
  no-reply while a capability must be delivered.
- Focused post-audit verification passed: 197 assistant configuration and Codex
  runtime tests.
- Final affected-owner verification passed:
  `pnpm test:diff packages/hosted-execution packages/assistant-engine packages/assistant-runtime apps/web apps/cloudflare`.
  This included affected reverse-dependent typechecks/tests, 5,123 web tests
  plus lint, development smoke, and production build, and 1,819 Cloudflare
  tests.
- The required coverage-write audit added unchanged-target, Edge-upgrade
  preflight, and multiple-vault-capability regressions. Its punctuation finding
  was fixed and covered; no actionable findings remain.

## Final deployment and rollback decision

Deploy web first because it accepts both the direct input-bound request and the
legacy exact-target approval request. Deploy Cloudflare/runner second with the
repository's currently required `container_rollout=immediate`; managed-container
smoke must report the new runner-bundle fingerprint. Old warm runners remain
compatible with new web by using the legacy approval shape. Do not deploy the
new runtime against old web because direct configuration writes would fail
closed. Roll back Cloudflare first if needed; the new web build remains the
compatibility floor. Remove legacy configuration-approval parsing only after
old runners and the bounded 180-second assistant idle window have drained.
Status: completed
Updated: 2026-07-15
Completed: 2026-07-15
