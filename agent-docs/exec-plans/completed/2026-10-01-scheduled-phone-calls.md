# Scheduled phone-call reminders

## Outcome and invariant

An explicitly requested private call reminder saves once and places one call at
the requested time, with approved destination and minimal disclosure. Existing
exact-occurrence authority, route eligibility, and request-key deduplication stay
canonical. No new scheduler, persisted state, transport, or permission is needed.

## Evidence and owners

The phone-call handler and turn planner already accept exact private Linq and
Telegram occurrences. The system prompt and phone-calls skill omit that route;
the skill also restricts private calls to health tasks. Correct these existing
instruction owners and prove the composed capability instead of adding machinery.

The hosted mailbox importer also drops direct Linq sender handles. Preserve the
authenticated sender in the existing source metadata; the existing prompt
renderer supplies it to the private turn. Phone-formatted handles are usable for
"call me"; email and Telegram identifiers never become telephone numbers.

## Product UX

- Outcome: save the requested call rather than offering text as the only option.
- Reaches: private known-number request and due call; missing number clarification;
  preserve scheduled group/email rejection and truthful uncertain call results.
- Proof: deterministic prompt and existing authority/handler tests, focused live
  Codex setup-to-due journey using a synthetic errand, package typecheck, parent
  review, ReviewGPT and exact-head CI. No real telephone provider is contacted.

## Steps

1. Correct guidance and add deterministic and real-Codex regression proof.
2. Run focused verification and inspect replies and call effects.
3. Update changelog, review and commit, create PR, get ReviewGPT/CI green, merge.

## Validation

Implementation and parent UX review: Ready.

- 202 focused assistant tests and 93 mailbox-import tests passed.
- Assistant Engine, Assistant Runtime, and Web typechecks passed.
- Three focused live Codex journeys passed on GPT-6.1 Sol through a local
  subscription: known sender setup and due call; email-handle clarification;
  uncertain start with no retry. Saved instructions were executed unchanged.
  One save, zero immediate calls, and one due call were observed. No real call
  provider was contacted. All synthetic replies reviewed: Ready.
- Changelog generation and 10 page tests passed. Complexity guard passed with
  source-metadata owner complexity reduced by one; other hotspots unchanged.
- Complete scripted first-provider input: direct 145110 -> 146020 bytes (+910),
  group 132011 -> 132011 bytes. Exact model tokenizer unavailable; no token
  estimates claimed. Deferred phone metadata changes appear on discovery.
- Parent review found no new scheduler, authority bypass, route broadening,
  retries, awaited calls, or dependency additions. All fixtures are synthetic.

The PR owns the remaining exact-head ReviewGPT, CI and merge receipts.

Status: completed
Updated: 2026-10-01
Completed: 2026-10-01
