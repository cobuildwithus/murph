# Apply saved workout capture defaults

Status: completed
Created: 2026-08-28
Updated: 2026-08-30

## Goal

Make an explicit member preference for the default duration of subsequently
reported workouts apply at the canonical workout write boundary, even when a
later model turn does not independently recall freeform memory.

## Product UX Plan

Effort: Product change.

- Outcome: a member sets one workout-duration default once, then reports later
  workouts naturally without being asked for that duration again.
- Entry and promise: in a private conversation, an explicit ongoing default is
  saved immediately; later `workout add` writes use typed current-report facts
  when supplied, otherwise the saved duration default. Positional workout text
  is preserved only as the note and never interpreted as structured authority.
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
- Resolve duration in this order: an explicit typed command/payload value, the
  saved typed capture default, then one eligible legacy value promoted into
  typed state. Raw workout-note text never decides duration, type, distance,
  segmentation, or exercise structure. The default lookup is an explicit
  member-report capability used only by ordinary `workout add`; imports,
  devices, derived records, and workout format logging do not opt into it. The
  write receipt remains authoritative.
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
5. Delete workout-note parsing from the canonical capture path. Keep the text
   verbatim as evidence and require the assistant or direct caller to pass
   structured facts through existing typed flags.

## Final review disposition

- Review rounds 1–6 exposed a repeated architectural problem: prose parsing
  could not safely distinguish authoritative workout facts from temporal,
  segmented, hedged, or competing language.
- The final correction deletes that authority path. Workout and format text is
  preserved as note evidence only. Typed flags, structured payloads, workout
  timestamps, and the typed saved duration default own structured facts.
- Legacy compatibility remains deliberately narrower than ordinary workout
  capture: only two whole-record affirmative preference forms can promote one
  agreeing duration into the typed preference owner.
- ReviewGPT round 7 checked the architecture-collapse candidate and returned
  `ROUND_OUTCOME: PASS` with no qualifying findings. The exact response was
  recovered from the accepted thread after browser capture timed out and was
  bound to the committed user-turn message id and browser-reported model.

## Verification

- Product UX walkthrough:
  - Fresh default: the real-Codex journey saved 60 minutes, then a fresh later
    yoga report sent typed `--type yoga`, omitted `--duration`, produced one
    60-minute workout write, and asked no duration question.
  - Current-report precedence: a later 35-minute swim sent typed
    `--duration 35 --type swimming` and produced a 35-minute workout instead of
    consuming the saved default.
  - Note boundary: the built CLI received a note containing multiple duration,
    activity, distance, and exercise phrases. It preserved the text, used the
    saved 25-minute default, and produced generic `workout` type with no
    distance or exercises. Typed flags produced the requested 40-minute,
    5.5-kilometer cycling record from conflicting note text.
  - Established member: focused CLI proof rejected conflicting legacy
    preferences, promoted agreeing explicit legacy preferences, and persisted
    the promoted duration in the typed owner.
  - Recovery/no default: clearing remained authoritative after migration;
    ordinary missing-duration capture without an applicable default still
    returned the established explicit-duration error.
  - Verdict: Ready. The tested entry, feedback,
    precedence, note boundary, recovery, and legacy paths match the product
    promise without changing import semantics.
- Deterministic proof:
  - contracts preference/public-entrypoint tests: 13 passed, including
    old-shape empty-document compatibility; core preference tests: 23 passed.
  - vault-usecases workout and record-service coverage: 39 passed, including
    structured payloads, format logging, intervention parser isolation, and the
    note-only workout boundary.
  - CLI workout surface: 28 passed; generated schema/hash contracts: 16 passed;
    package shape verified.
  - assistant composed-prompt regressions: 77 passed, including typed workout
    facts, saved defaults, and route-duration boundaries.
  - complete CLI workspace after the final test-fixture corrections: 132 files
    passed; 1,388 tests passed and 30 were skipped.
  - contracts, core, operator-config, vault-usecases, CLI, and assistant-engine
    typechecks passed. Generated CLI schema and skill hash are current.
- Real assistant proof:
  - `pnpm test:assistant:live -- --test "applies a saved workout duration default on a fresh later report"`: 1 passed.
  - The journey saved the default through `workout defaults set`, used the
    default with typed yoga and no duration flag, passed the current swim's
    35-minute duration and type as flags, and mapped a running route to the
    supported walking route profile without allowing estimated route duration
    to override the saved member default.

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
- ReviewGPT round 5 accepted one review-induced High: compound word-hour
  branches still returned 90 or 60-plus-minutes before the bounded role check.
  Direct built CLI proof reproduced a hedged compound workout and intervention
  as 90, and reproduced a clearer 30-minute workout plus an occurrence-offset
  compound as an incorrect 90-minute write.
- Round-5 complexity collapse: unconditional compound returns are deleted.
  Simple and compound word-hour candidates now share one bounded role decision;
  competing duration evidence or an unsupported suffix returns `ambiguous`.
  The existing half-hour rule remains ahead of the embedded `an hour` candidate.
- Round-5 correction proof: parser/format/intervention focused cases 4 passed;
  rebuilt CLI workout-capture slice 6 passed; vault-usecases and CLI typechecks
  and builds passed. Direct built CLI proof now rejects both compound examples
  and the competing-duration example with `invalid_option`, writing no event.

## Round 6 architecture collapse

- ReviewGPT round 6 proved the shared prose grammar could still select one
  word-hour compound while overlooking another word-hour duration elsewhere in
  the same note. The built CLI reproduced one successful 90-minute write from
  a note containing two separately timed activities.
- The user rejected another grammar patch and chose the smaller durable
  contract: canonical workout writes do not interpret raw note text. Existing
  typed flags and structured payloads own duration, activity type, distance,
  and exercise structure; a saved typed duration fills only an omitted typed
  duration on ordinary member-report capture.
- Implementation direction: revert this PR's word-hour parser expansion,
  remove workout-note inference and segmented-note heuristics from the workout
  owner, preserve the note verbatim, and update assistant guidance so current
  facts are passed explicitly. Keep the legacy preference bridge bounded to
  decoding the duration token captured by its whole-record grammar.
- Complexity target: net-delete parser branches and authority checks. Add no
  command, abstraction, durable state, compatibility framework, or downstream
  guard.
- Required proof: built CLI must show that numbers and duration words embedded
  in the note do not affect the record; typed `--duration`, `--type`, and
  `--distance-km` remain authoritative; the saved default fills only omitted
  typed duration; imports and non-manual sources remain excluded; and the real
  assistant passes a member-stated current duration as a typed flag.

## Outcome

- Members can save one typed default with
  `workout defaults set --duration <minutes>` and ordinary manual
  `workout add` capture uses it only when typed current duration and derivable
  workout timestamps are absent.
- Explicit current facts win. Imports, non-manual sources, live tracking, and
  saved-format logging do not consume the member-report default.
- Positional workout text remains a convenient note surface but has no
  structured authority. No replacement workout prose grammar was added.
- The assistant preserves natural reporting by translating current message
  facts into typed CLI arguments and trying the canonical write before asking
  for an omitted duration.

Completed: 2026-08-30
Completed: 2026-08-30
