# Retain legacy auth callback forwarding through runtime drain

Status: active
Created: 2026-10-20
Updated: 2026-10-20

## Goal and invariant

Preserve old runtime auth callbacks while the compatible Worker is activated
before native runner replacement. Forward only the existing authenticated POST
through the existing bound-user, signature and runtime-authority boundary.

## Evidence and ownership

The deploy owner activates its staged Worker before rolling serving containers.
The old runtime emits device-code, failure and post-checkpoint auth callbacks;
currently serving Web still owns their consumer. Removing Worker forwarding
before those producers stop creates a retrying failure window. Cloudflare's
[outbound traffic contract](https://developers.cloudflare.com/containers/configuration/outbound-traffic/)
allows policy changes to affect already-running containers.

The Worker static allowlist is the correction owner. It needs one retained route;
no shared runtime API, OAuth code, Web route, persistence, retry loop, deployment
resolver or new subsystem is required. The native publisher mitigation is a
separate owned PR and is excluded here.

## Scope and failure behavior

- Retain only POST `/api/internal/hosted-runtime/codex-auth` in the existing
  Worker forwarding policy; preserve rejection bodies/statuses and signing.
- Keep current runtime legacy readers cleanup-only and retryable on deletion
  failure. Keep all existing reader floors and authorization checks.
- Document rollout/removal conditions in the runtime protocol owner. Native
  application convergence alone does not prove old warm bindings, active
  invocations or already-forwarded requests have finished.
- No production dispatch, data inspection/replay, credentials or model usage.
  Release coordination and approval of the exact sequence remain external.

## Product UX and rollback

Outcome: preserve the old callback delivery path during native replacement.
Reaches: old callback-producing runtimes while the legacy Web consumer serves.
Proof: real Worker forwarding/signature tests and existing Web admission tests;
external deployment and request drain remain separately gated.

This patch preserves a legacy consumer during retirement; it adds no member
control. Old Web may still offer linking while upgraded runtimes only clean up
credentials, so a newly requested link cannot complete on those runtimes. The combined release's persona retirement resolves old selections to
Classic while retaining explicit tone, voice and dials. Until Web is promoted,
old UI can display/save a choice the new runtime no longer applies. Later
canonical writes can persist normalization, so rollback cannot reconstruct old
choices. This consequence must be accepted before the combined release.

## Tasks

1. Add a failing composed Worker regression with synthetic legacy requests.
2. Retain the single policy entry; prove signing, fence/header preservation,
   unsupported methods, upstream failures and current cleanup-only behavior.
3. Update durable protocol with producer drain, promotion and removal criteria.
4. Review full candidate, run focused typecheck/complexity/docs checks, then
   commit and open Draft PR. Final ReviewGPT and exact-head CI gate completion.

## Verification

- Before production change: the focused legacy callback regression failed in
  12 cases at the absent forwarding entry (2 denial cases passed).
- Worker outbound suite: 353 passed. Actual forwarding signs the bound member,
  body and runtime authority; invalid methods/missing authority do not forward;
  upstream 401/404/409/500 remain unchanged with exactly one fetch.
- Existing runtime auth cleanup: 7 passed, 199 unrelated cases skipped across
  event/checkpoint suites. Local deletion failure remains retryable.
- Existing Web internal callback auth suite: 14 passed. Signature/replay checks
  are real; runtime-owner admission is mocked, so this is not a deployed or
  database-composed legacy Web proof.
- Persona compatibility: 12 transport, 3 focused canonical preference and 21
  browser style route tests passed (21 unrelated preference cases skipped).
  Old snapshots normalize to Classic while retained settings survive; browser
  API rejects retired fields.
- Cloudflare typecheck, complexity guard and docs drift passed. Complexity debt
  remains zero, maximum 8, no changed-source hotspot above 20.
- Candidate review: single static route uses existing authorization/forwarding;
  no new runtime producer, state, retry, flag, dependency or hot-reply work.
  Patch UX is Ready within its forwarding scope. Combined rollout stays on Hold
  until the release owner accepts temporary old-UI behavior and proves drain.

Pending: final independent ReviewGPT and required exact-head CI. Operational
drain/publication/convergence remain separately required and are not claimed by
local tests. No deployment or rollback is authorized here.
