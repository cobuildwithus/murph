# Natural Pattern message wording

Refine the existing Pattern notification patch so uncertainty fits naturally
inside a short message. Remove the instruction requiring an extra explanation
of other factors. Preserve evidence strength, supporting counts, noncausal
wording, eligibility, ledger effects, and the absolute link.

The existing managed automation prompt remains the only production owner.
No new state, dependencies, or delivery behavior. Rollout uses ordinary managed
instruction reconciliation; older runtimes retain the previous copy until updated.

Proof: focused managed automation tests and typecheck, then the existing first
and later digest live scenarios through production delivery parsing. Review
actual synthetic replies for conversational wording, compactness, a light
qualifier, no repeated disclaimer, and unchanged effects. Record the result
before committing and updating PR 2967. Parallel agents are auditing other
surfaces separately; their findings do not broaden this Pattern patch.

## Result

Both focused digest scenarios produced a short paragraph with light in-sentence
qualification, supporting counts, and the absolute link, with no standalone
causation disclaimer. The first later-digest attempt returned skip unexpectedly;
a diagnostic retry passed. This is sample-based language evidence, not a claim
that every model run succeeds. The harness now prints a non-send decision before
asserting so future failures retain their reason.

Verification: 58 managed-automation tests, 9 changelog rendering tests, Assistant
Engine typecheck, Web typecheck, complexity guard, and diff/privacy review passed.
Live commands were the existing `clear bounded digest with a full link.*false`
and `.*true` scenarios through `pnpm test:assistant:live`, using the managed
`gpt-5.6-luna` target, medium reasoning, and local subscription authentication.
No production messages were sent.

Parallel discovery used six other live audit scenarios. Confirmed targets are
onboarding's developer repair instructions and mild weekly-digest verbosity.
Reminder scheduler terminology remains a static risk because its selected live
scenario did not reach that result. Those owners are not changed in this patch.
Status: completed
Updated: 2026-09-06
Completed: 2026-09-06
