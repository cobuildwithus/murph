# Preserve Pattern notification newness

The later-digest live scenario skipped twice despite an empty notification
ledger and four eligible results. Inspection found an ambiguous decision order:
the prompt adds identities before sending without explicitly preserving the
newness decision. Report stages describe evidence, not notification history;
the fixture also incorrectly used `seen_again` for every grade.

Clarify that newness is determined from the starting ledger after alias migration
and retained through the write. Correct fixture stages to match the query owner.
Preserve import gating, mutes, eligibility, delivery, and natural message wording.

Verify composed instructions and typecheck, then run both focused first and later
digest live scenarios on the managed Luna target. Inspect replies and effects.
Keep PR 2967 in draft if delivery remains unresolved. No production delivery.

## Result

Ready: both focused first and later digest scenarios passed after the clarification
and stage correction, with one report read, no vocabulary write, one ledger write,
all four identities recorded, at most three highlights, natural light qualifiers,
and the full link. Commands used `pnpm test:assistant:live -- --test` with
`clear bounded digest with a full link.*false` and `.*true`, respectively, and
`--model gpt-5.6-luna`; medium reasoning, local subscription, synthetic data.
The broad two-scenario selector was rejected before a live journey, so the cases
were launched separately. Earlier skips remain evidence of the ambiguity; these
successful samples do not establish a deterministic model success rate.

58 managed automation tests, Assistant Engine typecheck, complexity guard, and
diff/privacy review passed. Current-main Web typecheck and 23 focused changelog
and training-view tests passed before this isolated prompt clarification.
Status: completed
Updated: 2026-09-06
Completed: 2026-09-06
