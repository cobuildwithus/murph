# PR 1032 direct/group parity remediation

Status: active
Created: 2026-07-27
Updated: 2026-07-27

## Goal

Make group-chat Murph an audience-aware form of the ordinary Murph conversation,
not a second assistant with different turn semantics or identity. Preserve exact
server-owned participant authorization while giving the model a friendly,
presentation-only speaker name beside each opaque message reference.

## Success criteria

- Direct and group conversations share one response lifecycle: input may join
  the live turn until the first assistant response completes, then later input
  stays pending for the next ordinary turn.
- No completed assistant text or media is silently discarded, and no group-only
  last-response-wins suppressor or replacement instruction remains.
- Initial, projected, captureless, and late-steered messages use one canonical
  renderer with an opaque message reference and an optional bounded, sanitized,
  safely quoted speaker name.
- Telegram propagates its trusted ingress display name. Linq resolves a
  server-owned preferred display name only for an exact unique current
  membership and fails soft without blocking durable ingress.
- A speaker name is presentation only. It never supplies canonical identity,
  membership, routing, or effect authority; server code continues deriving the
  participant from the selected message reference.
- Direct and group prompts share one Murph identity/personality base. The group
  layer contains only audience, privacy, floor-etiquette, and brevity
  differences, while room-owned tone/personality settings remain the sole style
  owner.
- A compound turn admits at most 50 messages cumulatively across initial and
  live input. Overflow and everything after it remain pending for the next turn.
- Phone-call execution binds selected-message evidence to the callback route
  and current participant authority immediately before provider start without
  changing the existing request key.
- An exact unsuspended group participant can revoke their own newsletter email
  share even when their personal paid access is inactive.
- Focused regression coverage, canonical verification, required audits, final
  ReviewGPT certification, and PR CI pass on the pushed head.

## Scope

- In scope: assistant input contracts and canonical transcript rendering;
  direct/group response and live-admission lifecycle; group prompt composition;
  Telegram/Linq speaker-name propagation and fail-soft resolution; phone-call
  callback authorization; newsletter self-opt-out authorization; focused tests;
  matching current architecture, security, reliability, and product docs.
- Out of scope: backlog managers, speaker locks, reply-suppression state, extra
  queues, migrations, participant-ID model fields, phone-call request re-keying,
  roster state, compatibility machinery without a demonstrated deployed need,
  and unrelated group features.

## Constraints

- Keep durable ingress ahead of optional speaker-name lookup.
- Reuse current membership and shared-profile truth; add no identity state owner.
- Preserve exact message-reference selection and server-derived participant
  evidence for all participant-scoped effects.
- Keep the synthetic room, group private-data restrictions, and prohibited-tool
  boundaries intact.
- Prefer deletion, reordering, and a single renderer/lifecycle owner.
- Preserve deploy compatibility between Web and the Cloudflare/runner during
  the documented rollout window.

## Known defects to remediate

1. Group turns retain only the last completed provider response while direct
   turns retain preceding responses; the regression test currently codifies
   discarded group text and media.
2. Linq messages expose only a provider handle and Telegram drops its available
   display name; the late/captureless renderer also duplicates and narrows the
   transcript format.
3. Static direct and group identity prompts diverge, and the group prompt
   hardcodes casual humor even when room tone/personality says otherwise.
4. Live steering does not subtract the initial input count from the 50-message
   bound, so a busy room can admit more than the promised maximum.
5. Web phone-call execution validates provider source but does not prove the
   selected message belongs to the callback room, and current membership is not
   rechecked immediately before irreversible provider start.
6. Newsletter self-opt-out incorrectly depends on the sender's active personal
   entitlement, even though revocation must remain available.

## ReviewGPT implementation request

Implement the smallest coherent patch for every defect above against the
current PR head. Include source, focused regression tests, and current durable
documentation where the contract changes. Preserve the existing phone-call
request key and exact server-owned authorization; do not introduce a new
durable state owner, queue, manager, migration, compatibility layer, or
model-supplied participant ID. Return the complete result as an attached
`.patch` or `.diff` file. Do not commit or push.

## Tasks

1. Have ReviewGPT implement the scoped patch in the existing PR conversation.
2. Inspect the entire returned patch as untrusted input, apply only validated
   hunks, and resolve any issue at the owning boundary.
3. Run focused owner tests and direct scenario proof, then canonical
   diff/full-acceptance verification.
4. Complete product-experience review and the preliminary prompt/coverage
   ReviewGPT specialist pass.
5. Complete parent final review, close the plan, push, run the final ReviewGPT
   PR gate with CI, and leave PR 1032 review-ready.

## Verification plan

- Focused assistant-engine tests for prompt rendering, response retention, and
  cumulative initial/live admission.
- Focused messaging-ingress, assistant-runtime, hosted-execution, and Web tests
  for display-name transport, exact room/member phone-call authority, and
  newsletter revocation.
- `pnpm test:scenario-integrity`.
- Truthful `pnpm test:diff` over all touched owners during iteration.
- `pnpm verify:acceptance` for the final cross-cutting head.
- A production-faithful direct scenario for the longest changed group path, or
  an explicit evidence gap if the local harness cannot exercise it.
- Required local `product-experience-review`.
- Preliminary ReviewGPT lenses: prompt applicable, coverage applicable,
  frontend not applicable unless the patch introduces user-facing Web UI.
- Final ReviewGPT PR gate and green current-head CI.

## Progress

- ReviewGPT returned a complete implementation patch. The parent inspected and
  applied it, then replaced its broad Linq name lookup with a dedicated
  presentation-only Web boundary that reads current membership, exact verified
  contact lookup keys, and only the `profile-name.v0` snapshot.
- Focused typechecks pass for Assistant Engine, Assistant Runtime, Hosted
  Execution, and Web. Focused behavior tests pass for transcript rendering,
  first-response admission closure, the cumulative 50-input cap, response/media
  retention, Telegram/Linq names, self-opt-out, and phone-call authority.
- The diff-aware canonical lane passed all guards and affected typechecks plus
  the changed owners and downstream Assistant/CLI packages. One unrelated
  hosted-local process test missed its five-second `minio-ready` timing bound
  under the full fanout and then passed immediately in isolation.
- Product-experience review found one real lifecycle gap: a completed
  media-only assistant response did not close live-input admission. The parent
  corrected the shared provider boundary and added a scripted app-server
  regression proving the media segment is retained before a later steer.
  Focused typecheck and regression proof pass, and product-experience re-review
  returned no findings. Live-provider event timing remains an explicit evidence
  gap.
- Scenario-manifest integrity passes. Full acceptance, required reviews, the
  pushed-head ReviewGPT gates, and current-head CI remain pending.

## Deployment

Web must remain able to accept both the currently deployed runner evidence and
the new runner evidence during rollout. Deploy Web first, then
Cloudflare/runner, preserve the existing phone-call request key, and verify one
direct reply, one multi-sender group reply, exact participant self-opt-out, and
phone-call authorization after rollout.
