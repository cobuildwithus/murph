# Product UX

Last verified: 2026-09-04

## Purpose

Plan the experience before code and replay it afterward. Judge what the person
understands, can do, and ultimately receives, including delays and recovery.
Technical correctness alone does not prove the promised value.

## When This Applies

Use this for changes to user-facing meaning, actions, audience, permissions,
billing, data, messages, timing, or delivery. Internal refactors, developer
tooling, tests, and meaning-preserving typos use their normal verification route.
Product scope and technical risk are separate decisions.

## Choose The Smallest Useful Effort

| Effort | Meaning | Record before code |
| --- | --- | --- |
| Patch | Restore or tune an existing promise without adding scope or product meaning. | Three short lines: `Outcome`, `Reaches`, `Proof`. |
| Product change | Change an existing journey, result, message, or visible state. | The short plan below, in the existing work plan. |
| Feature | Create a promise, audience, authority relationship, surface, or data meaning. | Read the relevant product contract, resolve material assumptions, and establish authorization for the proposed scope. |

Use existing conversation and repository evidence before asking questions.
An already-authorized feature does not need a second approval solely because
it is classified as a Feature. Ask when the plan adds scope, authority, a
material exclusion, or a product choice the current request does not settle.
Keep private feedback and exact user scenarios out of committed artifacts.

## Product UX Plan

Keep this inside the existing work plan or PR; no separate form is required.

- **Outcome:** the smallest useful result, not just the implementation.
- **Entry and promise:** where the person starts, what they expect, any wait,
  and the final destination.
- **Affected people:** select materially different journeys using the dimensions
  below. State deliberate exclusions and preserve their existing safe experience.
- **Proof:** ordinary entry through the last observable boundary that defines
  success, plus relevant failure/recovery behavior.
- **Done when:** observable results that make the selected journeys useful,
  understandable, accessible, and authorized.

### Requirement Boundary

Product principles constrain the requested behavior; they are not a backlog.
Every new field, state, control, or owner needs a current consumer and supported
journey or invariant. Plan exceptional states when the change touches them or
current evidence proves a material risk. Reduce an unsupported promise before
implementation rather than constructing a hypothetical complete product.

### Affected People

Add a distinct journey only when it changes value, meaning, authority, privacy,
presentation, timing, or recovery. Useful dimensions include:

- goal, role, plan, sponsorship, family/group relationship, and spending authority;
- channel, private/group context, device, and responsive viewport;
- time zone, locale, and day boundary;
- permissions, connected sources, provider coverage, and data freshness;
- new versus established accounts and legacy state; and
- relevant known context, rich/sparse data, uncertainty, and conflicting evidence.

This is a selection aid, not a Cartesian matrix. More relevant history should
improve the result; sparse evidence should lead to an honest limit or useful
question. Do not label generic advice a personal insight or stale data current.

For each selected journey, check what the person is trying to do, what they see
first, what they expect next, what action they can cause, who sees the result,
and what happens on delay, denial, or failure.

### Proof Path

Prove the boundary that carries the promise. A canonical write needs readback;
a delivered message needs delivery evidence; scheduled work needs an occurrence
and terminal outcome. `Queued` or internal completion does not prove receipt.
Mocks prove their layer only. A narrow Patch can use narrow proof when the rest
of the route cannot change; composed Features need the relevant composed proof.
If evidence is unavailable, record `Hold` or agree a narrower promise.

### UX Finish

Use clear channel-native language, show the useful result first, and preserve
accessibility and responsive behavior. Design meaningful loading, empty, partial,
stale, error, and recovery states. Remove repeated copy and unnecessary steps
without removing consent, control, decline, pause, undo, revoke, or recovery.
Use `DESIGN.md` when presentation changes.

## Product UX Walkthrough

Replay the selected journeys against the actual changed path before expensive
review. Record the people/paths, evidence for each material claim, differences
from the plan, and `Ready` or `Hold` in the existing plan or PR.

Evidence can be rendered states, synthetic channel output, provider-shaped
scenarios, or timing/delivery/recovery traces. Use the real product path for
journey proof; a screenshot study proves presentation. Check phone and desktop
when responsive behavior differs. There is no screenshot or viewport quota.

Use `Hold` when the supported journey misses its value, contradicts known facts,
has unclear consent/audience, or misleads about timing/recovery. Resolve it before
candidate review. A missing artifact alone is not failure when other evidence
proves the claim.

## Review Ownership

The parent reviews this plan and walkthrough during candidate/final review;
there is no preliminary Product UX specialist gate. Start with the irreducible
purpose and inspect the normal path through the promised result. Review only
problems caused or materially worsened by the change, except a pre-existing gap
that prevents the requested result from working.

Accept findings grounded in actual behavior or faithful evidence. Reject taste,
minor polish preferences, and hypothetical future needs. A valid review can have
zero findings. Useful severity distinctions are an unreachable/unsafe main goal,
material ordinary friction, or an experience that can preserve every required
property with fewer steps or concepts. Name the evidence and smallest correction.

When remediation changes the product promise, update the selected journeys and
proof and record a refreshed `Ready`/`Hold` verdict. Technical review checks the
implementation; it does not replace the product decision.
