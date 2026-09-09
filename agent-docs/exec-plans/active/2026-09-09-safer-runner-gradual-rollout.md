# Safer single-pool gradual runner deployments

Status: active
Created: 2026-09-09
Updated: 2026-09-09

## Goal

Prepare PR #3109 for compatible gradual production releases, with isolated candidate behavior proven before serving-image replacement and approximately 700 member slots as the conservative rollout target.

## Success criteria

- Failed isolated candidate smoke causes no serving-image mutation.
- The authenticated early smoke phase never prepares a member slot or reads/fills standby inventory; it proves the exact candidate artifact, shell, R2, and configured live-model behavior.
- Full serving-target smoke remains after native distribution; pending identity and retry recovery remain intact.
- Preflight and execution share one rollout-mode parser, default to gradual, retain explicit immediate and Worker-only modes, and reject invalid modes.
- Current state/schema, audience, selector, image-pair, claim, and checkpoint protections remain enforced; applicable first-writer releases retain explicit immediate/consumer-first instructions.
- Focused tests, typecheck, complexity review, final ReviewGPT, and exact-head CI pass.

## Scope and authority

Use the existing owned PR checkout. Source, tests, current deployment documentation, scoped commits, push, and PR readiness are authorized. No production setting, deployment, or rollback mutation is part of this task. The private workflow already defaults to gradual and retains its independent immediate requirement when predeployment E2E is deliberately skipped.

## Product UX

Effort: deployment recovery change. Before replacement, a bad candidate leaves the old serving image running. During compatible native gradual replacement, exact old/new images may coexist and individual processes still restart. Check cold/new messages, pending retries, standby inventory, and active-work shutdown ownership. No uninterrupted-process promise. Hosted rollout timing remains a separately measured boundary.

## Decisions and risks

- Accept the consultation's source-proven ordering gap: existing behavioral smoke runs after serving rollout. Split the authenticated smoke phase; moving the existing call would touch serving inventory.
- Remove the blanket migration-era immediate-only policy; ordinary compatible releases use native gradual progression. Preserve runtime floors and document release-specific compatibility and first-writer obligations. Do not substitute a permanent compatibility boolean or a new scheduler.
- Retain native automatic progression for this change. Manual health-gated cohorts require additional hosted API/hold proof and are outside this bounded implementation.
- Recommend 702 serving slots plus one smoke slot, about 700 bound members after two standbys; fresh all-application CPU/memory/disk accounting must prove quota headroom before any live increase.
- Preserve the completed capacity-reclaim plan as immutable history; this plan owns the follow-up.

## Tasks

1. Trace current policy, private workflow, smoke boundaries, and original failure. Complete.
2. Add failing focused proof for early isolated smoke and gradual production admission. Complete: both regressions failed before the correction.
3. Implement the smallest correction and update durable deployment guidance. Complete.
4. Verify affected tests/typecheck and parent review; complete final ReviewGPT and exact-head CI.

## Verification

Run focused deploy CLI, preflight/settings, signed smoke route/client, provider, and retained identity tests; Cloudflare typecheck and complexity diff. Use existing shutdown and protocol tests for relevant compatibility evidence. Hosted image distribution, real active-turn recovery, and capacity admission remain deployment gates rather than local claims.

## Candidate evidence

- 453 focused Cloudflare tests passed across deploy CLI, production preflight, settings, signed smoke route/client, native provider, staged release, image admission, and container entrypoint.
- All 24 existing runtime shutdown tests and 31 schema/write-fence tests passed.
- Cloudflare typecheck and the complexity ratchet passed; existing complexity hotspots did not increase.
- The early phase has a distinct authenticated endpoint, so an old Worker returns 404 without touching serving inventory. A bounded retry test preserves the proven artifact attempt for the live-model phase.
- The protected workflow already defaults to gradual; its independent immediate-only rule when predeployment E2E is skipped is preserved. Runtime schema and protocol owners are unchanged.
- Parent read-only inspection of the recent successful protected release resolved a public source with runner schema 19. This is baseline context, not fresh proof of every current process or permission to deploy. No private deployment rows, identities, or credentials were persisted.
- Current-base mergeability found an isolated test conflict with an upstream correction to the previously aging audio fixture. Retain upstream's stronger clock-controlled proof and reconcile before final review.
- Final ReviewGPT and exact-head CI remain pending.
