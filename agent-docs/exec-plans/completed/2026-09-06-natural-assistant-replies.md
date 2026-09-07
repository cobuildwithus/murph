# Natural assistant replies

Outcome: correct three audited message owners so onboarding recovery, weekly
digests, and reminder confirmations use plain conversational language.
Reaches: members resuming onboarding with invalid saved memory, receiving a
weekly digest about a repeated activity, or saving a reminder while its next
occurrence is pending. Existing authority, writes, scheduling, and delivery stay
with their current owners.
Proof: deterministic composed-instruction and effect tests, then focused synthetic
real-Codex journeys through the production builders. Inspect the actual replies
and exact effects. Relevant typechecks and required exact-head CI gate merge.

## Implementation boundaries

- Onboarding: preserve operator diagnostics and terminal stop behavior, while
  explaining the saved-information problem without asking the member to edit a
  file or claiming a repair or support escalation occurred.
- Weekly digest: recognize the concrete change directly. Keep uncertainty brief
  and within the relevant sentence; preserve selection and evidence rules.
- Reminder: report the saved result and any useful timing limit without exposing
  scheduler mechanics. Preserve unavailable and stale-result distinctions.

Three collaborating agents own these disjoint areas. The parent owns combined
review, release note, verification, scoped commit, PR, and merge. No production
test messages or database mutations. The already-owned Patterns PR 2967 is a
separate merge candidate and must pass its required checks as well.

## Completion

Ready only when each selected journey gives a useful, truthful, natural reply
with the expected effects, and the exact PR head passes required CI. Prompt-only
presentation corrections use the completion workflow exemption from final
ReviewGPT unless implementation expands into independently sensitive behavior.

## Progress

The three production instruction edits and regression tests are implemented.
Focused onboarding and digest instruction tests pass; hosted-domain tests pass
25/25 and scripted runtime tests pass 117/117. Assistant Engine and Web typechecks,
9 changelog rendering tests, complexity guard, and diff review pass.

Onboarding live proof is Ready: one resume read, no memory/completion commands,
unchanged saved fixture, and a plain explanation of the pause. Final digest and
reminder live proof is still pending after pre-provider authentication/usage
failures; continue the documented unused-login sequence without reading secrets.
An intermediate digest sample still sounded stiff, so the final prompt removes
its compass metaphor and explanatory contrast. Eligibility remains unchanged.

Patterns PR 2967 passed required CI and merged separately. This follow-up remains
an active task until its own final live proof and required exact-head CI pass.

## Final local proof

All three selected journeys are Ready on the final instructions. Onboarding
used one resume read, no memory or completion commands, and a plain pause
explanation. Reminder confirmation used exactly one inspect and one versioned
patch, with no shell command or extra verification; its short reply confirmed
the saved change and active cadence without a next-delivery promise. The weekly
digest made no tool calls, sent one bounded observation tied to the stated
intention, and used a light qualifier within the interpretation without a
standalone disclaimer or claim of demonstrated personal improvement.

Live commands used `pnpm test:assistant:live -- --test` with these exact selectors:

- `reports terminal canonical memory repair without a mutation or retry loop during onboarding resume`
- `confirms a pending recurring reminder naturally without scheduler terminology`
- `recognizes a new cycling routine without pattern jargon or disclaimer padding`

All used gpt-5.6-terra and local subscription authentication. Reminder and digest
used the first usable alternate login after earlier attempts failed before any
provider action. No auth material was copied. The final digest wording followed
observed misses on intermediate prompts; its regression now rejects both singular
and plural versions of the unnecessary proof disclaimer. These are inspected
samples, not a universal model success-rate claim.

Final local checks: 57 managed-automation tests, focused onboarding skill-assets
proof, 25 hosted-domain tests, 117 scripted-runtime tests, Assistant Engine and
Web typechecks, 9 changelog tests, complexity guard, and diff/privacy review pass.
The earlier combined deterministic run saw one stale imported instruction after
a concurrent edit; the fresh hosted-domain rerun passed on the final text.

Implementation and local verification are complete. The parent continues the
PR's required exact-head CI and authorized merge; no production test messages
were sent.
Status: completed
Updated: 2026-09-06
Completed: 2026-09-06
