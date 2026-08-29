# Apply saved workout capture defaults

Status: active
Created: 2026-08-28
Updated: 2026-08-29

## Goal

Make an explicit member preference for the default duration of subsequently
reported workouts apply at the canonical workout write boundary, even when a
later model turn does not independently recall freeform memory.

## Product UX Plan

Effort: Product change.

- Outcome: a member sets one workout-duration default once, then reports later
  workouts naturally without being asked for that duration again.
- Entry and promise: in a private conversation, an explicit ongoing default is
  saved immediately; later `workout add` writes use an explicit duration when
  supplied, otherwise the saved default.
- Affected people: an established member with a typed default, a member whose
  explicit default still exists only in legacy freeform memory, a member who
  states a different duration for one workout, and a member with no default.
- Recovery: clearing the default restores the existing explicit-duration
  requirement; malformed or unavailable preferences fail without inventing a
  duration.
- Deliberate exclusions: imports and live tracked workouts keep their existing
  timing owners; no default is inferred from history, past workouts, or
  conflicting memory. One exact legacy memory preference can be migrated.
- Proof: focused command and persistence tests, a deterministic composed-prompt
  regression, deterministic legacy migration coverage, and one
  production-derived real-Codex journey for a fresh typed default.

## Architecture

- Keep the value in the existing canonical `bank/preferences.json` document.
- Add one workout-capture preference owner beside the existing workout-unit
  preference owner. On a missing-duration write, a narrow compatibility path
  can recognize one explicit legacy preference, reject ambiguity or conflicts,
  and atomically promote it into typed state only when the typed value is unset.
- Resolve duration in this order: explicit command/payload evidence, the saved
  typed capture default, then one eligible legacy value promoted into typed
  state. The default lookup is an explicit member-report capability used only
  by ordinary `workout add`; imports, devices, derived records, and workout
  format logging do not opt into it. The write receipt remains authoritative.
- Keep legacy compatibility narrow: recognize only two affirmative default
  sentence forms, aggregate all strictly matched values, and fail closed on
  conflicts. Negated, historical, preference-adjacent, and unrelated prose is
  ignored.
- Teach Murph to use the typed preference command for new explicit ongoing
  workout defaults, not duplicate the fact into freeform memory, and try the
  canonical workout write before asking for a missing duration.

## Tasks

1. Add the typed preference schema, core read/write owner, CLI use case, and
   `workout defaults show|set` surface with clear support.
2. Apply the saved duration only to ordinary member-reported `workout add`
   capture when the message and flags omit duration.
3. Add deterministic command, schema, persistence, precedence, clearing, and
   assistant-instruction regressions.
4. Add and run one focused real-Codex journey, then complete the required
   Product UX and ReviewGPT gates.

## Review remediation

Final ReviewGPT round 1 found six reachable boundary gaps. The correction
candidate now:

- recognizes explicit `an hour` and `one hour` workout reports while preserving
  `half an hour` as 30 minutes;
- replaces broad legacy-memory inference with bounded affirmative grammar and
  conflict aggregation;
- makes saved-default lookup opt-in only for ordinary member-report capture, so
  workout formats and non-manual sources cannot consume or migrate it;
- omits an empty workout-capture object from unrelated preference writes to
  preserve the old strict serialized document shape;
- prevents route-estimated duration from becoming explicit workout duration;
  saved member defaults remain authoritative when the member omitted duration.

## Verification

- Product UX walkthrough:
  - Fresh default: the real-Codex journey saved 60 minutes, then a fresh later
    yoga report produced one 60-minute workout write with no duration question.
  - Current-report precedence: focused CLI proof covered text and flag
    overrides, while ambiguous duration still failed closed.
  - Established member: focused CLI proof rejected conflicting legacy
    preferences, promoted agreeing explicit legacy preferences, and persisted
    the promoted duration in the typed owner.
  - Recovery/no default: clearing remained authoritative after migration;
    ordinary missing-duration capture without an applicable default still
    returned the established explicit-duration error.
  - Verdict: Ready. The tested entry, feedback, precedence, recovery, and
    legacy paths match the product promise without changing import semantics.
- Deterministic proof:
  - contracts preference tests: 10 passed, including old-shape empty-document
    compatibility.
  - core preference tests: 2 passed, including unrelated-writer preservation of
    the old strict serialized shape.
  - shared duration/parser and workout-format seam tests: 2 passed; the seam
    proves format logging does not opt into member-report defaults.
  - built CLI workout-capture slice: 6 passed, including explicit-hour
    precedence, manual-source boundaries, bounded legacy migration, unsupported
    prose, clearing, ambiguity, and imports.
  - assistant composed-prompt route-duration regression: 1 passed.
  - relevant contracts, core, operator-config, vault-usecases, CLI, and
    assistant-engine typechecks passed.
- Real assistant proof:
  - `pnpm test:assistant:live -- --test "applies a saved workout duration default on a fresh later report"`: 1 passed; actual reply confirmed one logged 60-minute yoga workout and no duration question.
  - The exact correction candidate added a route-bearing continuation and was
    attempted twice on 2026-08-29. The second attempt selected the correct
    `workout defaults set --duration 60` command, but the real CLI process did
    not return within the assistant tool window under severe host contention;
    Murph correctly declined to claim the write succeeded, and the journey did
    not reach the route step. This is recorded as a live-lane environment
    limitation, not a passing check; the exact built CLI and deterministic
    prompt/route boundaries above are green.

## Round 2 anomaly retrospective

- Trigger: final ReviewGPT round 2 returned `RETROSPECTIVE_REQUIRED` because
  the round-1 corrections for explicit word-hour phrases and legacy-memory
  inference retained the same underlying mechanism: an unscoped matching
  substring could still become duration authority.
- Original requirement: one saved duration should fill only a genuinely
  omitted duration on an ordinary member-reported workout. Definite current
  duration wins, ambiguous current duration clarifies, temporal references do
  not become duration, and only an affirmative legacy preference may migrate.
- Shape comparison: the first-reviewed head contained 494 authored-source
  additions and 7 deletions; the integrated round-2 head contains 499 additions
  and 13 deletions. The review correction stayed small, but its global
  `an|one hour` normalization and clause-level legacy scans repeated the prior
  authority defect rather than resolving it.
- Current-report decision: keep the existing shared duration parser as the one
  owner because workouts and interventions already compose through it. Remove
  global word substitution. Its bounded grammar will distinguish definite
  word-hour compounds, word-hour ranges, and temporal references before
  returning one duration; unsupported prose fails closed. Do not add a second
  workout-only parser or a growing context blacklist.
- Legacy decision: retain the bridge because an established member may already
  have the reported preference only in `bank/memory.md`, but make each of the
  two accepted forms a whole-record contract. Remove substring scanning; quoted,
  historical, revoked, trailing, or multi-assertion records do not migrate.
  Agreement across separate qualifying records remains required.
- Correction direction: shrink both problematic branches, add no owner or
  persisted state, and prove the ordinary built-CLI path for definite,
  compound, temporal, ambiguous, quoted, and revoked examples before the next
  substantive review.
- Production-path reproduction: the pre-correction built CLI wrote 60 minutes
  for `an hour and a half`, `an hour or two`, and `an hour ago`; rejected a
  definite 30-minute run followed by `one hour ago`; and migrated a revoked
  60-minute legacy sentence. All five findings reproduced without a mock.
- Landed correction: temporal duration references are removed by the shared
  grammar before duration resolution, definite word-hour compounds resolve as
  one value, word-hour ranges and unsupported word-hour prose fail closed, and
  whole-record anchors replace legacy substring scans.
- Correction proof: shared parser/format seam 2 passed; existing duration and
  intervention callers 2 passed; rebuilt CLI workout-capture slice 6 passed;
  vault-usecases and CLI typechecks passed.
- ReviewGPT round 3 accepted one review-induced High: blanket removal of
  duration phrases followed by `before`, `after`, or `later` could erase an
  explicitly framed activity duration and unlock the saved default. The built
  CLI reproduced `Yoga for 30 minutes after lunch` as 25 with a 25-minute
  default and reproduced the same intervention phrase with a null duration.
- Complexity-collapse correction: occurrence-offset removal now owns only
  duration phrases followed by `ago`; explicit `for one hour` remains duration
  evidence even when later scheduling context follows, while an unframed word
  hour before/after a reference fails ambiguous. This deletes three blanket
  temporal categories and adds no downstream guard or replacement owner.
- Round-3 correction proof: parser/format/intervention focused cases 4 passed;
  rebuilt CLI workout-capture slice 6 passed; vault-usecases and CLI typechecks
  and builds passed. Direct built CLI proof now records 30 minutes for both
  workout and intervention `for 30 minutes after lunch` examples.
- ReviewGPT round 4 accepted one review-induced High: the broadened positive
  `for one hour` matcher treated hedged or negated arbitrary tails as definite.
  Direct built CLI proof reproduced both workout and intervention
  `for one hour or maybe two` as successful 60-minute writes.
- Round-4 complexity collapse: the terminal positive form is restored, and the
  only nonterminal form is a structurally bounded `before|after` plus one-word
  scheduling reference. Every other continuation reuses the existing
  `ambiguous` result; no new resolver guard or parser owner was added.
- Round-4 correction proof: parser/format/intervention focused cases 4 passed;
  rebuilt CLI workout-capture slice 6 passed; vault-usecases and CLI typechecks
  and builds passed. Direct built CLI proof now rejects both hedged workout and
  intervention examples with `invalid_option` and writes neither event.
