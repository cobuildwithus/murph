# Assistant audience route authority

## Goal

Allow validated direct Linq assistant notifications to pass the existing audience guard by carrying their already-verified route authority through the runtime, while preserving exact-match, fail-closed delivery and recovering the blocked mailbox head without changing queue order.

## Proven production symptom

- A direct Linq referral notification preserved its explicit destination but lost the matching binding-authority proof at the hosted-runtime translation boundary.
- The assistant audience policy therefore classified the notification as unverified external and correctly rejected it with `ASSISTANT_AUDIENCE_UNVERIFIED`.
- Device items remain queued behind that unconsumed mailbox head.
- Inactive-member access gates and unrelated storage-restore failures are intentional or separate and remain out of scope.

## Success criteria

- The audience guard is unchanged and valid direct Linq notifications pass only when existing trusted authority exactly matches member, channel, directness, and delivery target.
- Missing, stale, mismatched, non-direct, wrong-member, and wrong-channel authority still fail closed.
- Referral producers reuse one owning helper to attach direct-route authority for supported direct channels without introducing another state owner.
- An already-imported legacy referral head is recovered by the runtime's existing route-authority owner without rewriting encrypted mailbox data, rewinding the import watermark, or adding another queue.
- A definitively stale legacy route becomes a terminal no-send for that same item so later mailbox work can advance; temporary authority-owner failures retain the ordinary same-item retry.
- Group routes, fallback prevention, and inactive-member gates retain their current behavior.

## Implementation

1. Have ReviewGPT inspect the real contracts, producer, runtime translator, mailbox transaction owner, recovery path, tests, and recent history, then return a complete patch artifact.
2. Inspect every returned hunk and accept only the smallest invariant-preserving data flow.
3. Apply the accepted patch in this isolated task worktree and refine only when focused proof exposes a defect.
4. Run focused tests, typechecks, and direct audience-policy and mailbox-ordering proof.
5. Push an exact candidate; run the preliminary specialist review and final ReviewGPT audit concurrently with required CI; resolve accepted findings.
6. Document compatible deployment order and canary the bounded existing-item recovery before broader recovery.

## Verification

- Assistant-engine coverage exercises the real audience guard for exact-match and mismatch cases.
- Assistant-runtime coverage proves an exact legacy referral shape gains in-memory authority only after the live owner validates hosted member, channel, directness, and target, including warm and restored workspaces whose import watermark already advanced.
- Runtime coverage proves a definitive stale route terminally advances without sending, a temporary authority outage retries, and lookalike notifications remain blocked by the unchanged guard.
- Web producer and recovery coverage proves new direct Linq items carry authority and recovery only re-signals the existing mailbox pointer without decrypting or replacing its payload.
- Focused tests and typechecks pass for every changed package and app surface.
- Exact pushed-head CI and required independent ReviewGPT gates are green before merge or production recovery.

## Candidate proof

- ReviewGPT's preliminary and final first-round reviews independently found that replacing the remote encrypted payload could not repair a runtime-local head already persisted beyond the import watermark. The parent verified that mechanism in the pointer import, watermark, and retry paths.
- ReviewGPT returned a runtime-owned replacement patch. The parent inspected every hunk, proved the permanent route error preserves `retryable: false` across the Web-to-runtime transport, confirmed privacy and whitespace cleanliness, and verified exact reverse-apply equivalence after application.
- The corrected runtime suite passed 326 tests across the system mailbox, warm/restored legacy recovery, events, and callbacks. It proves exact provider target delivery once, no home-route fallback, stale-route terminal progress, authority-outage retry, and lookalike rejection.
- The focused Web suite passed 126 tests across both referral producers, pointer-only recovery, mailbox storage, and changelog behavior.
- The assistant-engine audience-authority integration suite passed 8 tests through the real guard.
- Web, assistant-runtime, and assistant-engine typechecks passed.
- The public changelog describes the member-visible referral recovery without exposing incident details.
- `git diff --check` passed; documentation drift will be rerun with this corrected active-plan declaration.
- Corrected-head CI and final ReviewGPT round 2 remain pending; the preliminary specialist pass is not rerun after substantive remediation.
