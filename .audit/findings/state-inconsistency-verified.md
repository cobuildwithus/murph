# Family Draft Recovery — Verified State Inconsistency Audit

## Coupled state dependency map

| Pair | Invariant |
| --- | --- |
| Owner ↔ group | Recovery may mutate only the group projected for that owner |
| Group ↔ attempt | Recovery may replay only the projected attempt on that group |
| Attempt ↔ Session | Stored and provider Session identity must match group, owner, and attempt |
| Checkout ↔ Subscription | Accepted Subscription authority clears and supersedes Checkout authority |
| Draft ↔ relations/billing | Deletion requires the exact owner-only, never-paid, authority-free shape |

## Parallel path comparison

| Path | Group proof | Attempt proof | Provider effect | Final locked proof |
| --- | --- | --- | --- | --- |
| Normal Checkout start | owner-selected group | creates or reuses current claim | create/replay exact Session | exact attempt bind |
| Explicit invite recovery | projected group | projected attempt | replay/retire exact Session | complete candidate revalidation |
| Session expiry | Session metadata group | Session metadata attempt | already terminal | exact group/attempt/Session update predicate |
| Session completion | Session lookup group | exact bound Session | accepted Subscription | owner-locked billing write |
| Manual generic abandonment | current owner draft | prepared complete claim | retire only harmless Session | complete candidate revalidation |

## Verification summary

| ID | Coupled pair | Breaking operation | Original severity | Verdict | Final severity |
| --- | --- | --- | --- | --- | --- |
| SI-001 | projected group/attempt ↔ cleanup target | explicit invite-recovery route | Medium | True positive; reproduced and fixed | Medium |
| SI-002 | stale projection ↔ replay | concurrent group/attempt replacement | Medium | False positive after exact-proof correction | — |
| SI-003 | prepared claim ↔ expiry clear | expiry reconciliation | Medium | Designed lazy reconciliation with exact predicates | — |
| SI-004 | cleared attempt ↔ delayed binder | completion before duplicate bind | High | Existing reconciliation and regression eliminate it | — |

## Verified finding

### SI-001 — Stale recovery selected a newer Family checkout

**Severity:** Medium

**Verification:** Hybrid code trace and executable regressions.

**Coupled pair:** The group and Checkout attempt projected by invite recovery
must remain the group and attempt used for Session replay and draft deletion.

**Breaking operation:**

- `apps/web/app/api/settings/billing/family/checkout/route.ts` previously read a
  state-only projection, then selected whichever group currently belonged to
  the owner.
- `createHostedFamilyBillingCheckout` previously required only that some attempt
  existed.
- `abandonHostedFamilyDraftForOwner` then prepared whichever owner draft was
  current, allowing stale G1/K1 work to retire replacement G2/K2.

**Trigger sequence:**

1. Request A projects G1/K1.
2. Request B completes invite recovery and deletes G1.
3. A later normal Checkout creates G2/K2.
4. Request A resumes and, before the correction, re-resolves and retires G2/K2.

**Correction:**

- `readHostedFamilyDraftRecoveryStateForOwner` now returns G1/K1 only for the
  safe `checkout_starting` projection.
- The route rejects a different current group before replay.
- `createHostedFamilyBillingCheckout` requires K1 under the owner lock before
  any Stripe initialization.
- `abandonHostedFamilyDraftForOwner` accepts one paired expected-claim proof and
  rejects a changed group or attempt before Session retrieval or expiry.
- Existing final candidate revalidation still protects changes after provider
  preparation.

**Executable proof:**

- The route rejects a replacement group without calling Checkout or
  abandonment.
- Checkout replay rejects a replacement attempt before Stripe initialization.
- Abandonment rejects replacement group and replacement attempt shapes before
  provider cleanup or a database transaction.
- The unchanged exact claim continues to replay, retire, and delete normally.

## False positives eliminated

- Projection staleness is intentional because every effect boundary consumes
  the immutable proof and revalidates it.
- Exact expiry reconciliation may clear a prepared claim, but only a fully
  cleared shape is accepted after provider retirement; any replacement wins.
- Completion may clear an attempt before a delayed binder, but completed
  Subscription authority is reconciled and preserved rather than canceled.

## Summary

- Coupled state groups mapped: 5.
- Mutation paths analyzed: 7.
- Raw candidates: 4.
- Verified: 1 true positive fixed; 3 false positives eliminated.
- Final unresolved findings: 0 Critical, 0 High, 0 Medium, 0 Low.
