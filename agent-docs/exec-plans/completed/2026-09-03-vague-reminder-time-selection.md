# Context-aware vague reminder time selection

Status: completed
Created: 2026-09-03
Updated: 2026-09-03

## Goal

- Make vague one-shot reminder windows genuinely delegated: Murph chooses one
  useful fixed time from already-authorized personal context and explains the
  choice, while exact member-supplied times remain untouched.
- Keep the architecture prompt-first and composable by reusing the existing
  one-shot automation, connected-app, wearable/routine, and canonical Markdown
  memory surfaces.

## Success criteria

- Exact date-and-time requests cause no optional timing-context reads and save
  the exact requested one-shot time.
- Private vague-window requests use relevant bounded context and, when exactly
  one eligible connected calendar account is established, one narrow calendar
  read to select a concrete time inside the window without a permission prompt.
- Sparse or unavailable optional context does not force a follow-up question;
  Murph chooses a reasonable fixed time and makes adjustment easy.
- A successful vague reminder with no eligible calendar may make one adjacent
  connection offer, suppressed by one update-in-place 14-day Context record in
  `bank/memory.md`; an explicit permanent refusal remains an Instructions record.
- Group turns never read or write personal memory, routines, wearables, or
  connected calendars for time selection.
- Deterministic prompt tests, the appointment precedence regression, package
  typecheck, and a focused GPT-5.6 Sol real-Codex journey pass.

## Scope

- In scope:
  - Shared automation prompt rules for exact versus vague one-shot timing.
  - Narrowing the behavior-followthrough route to recurring support and repair.
  - Appointment reminder-default precedence.
  - Deterministic and focused live assistant proof.
  - A public changelog note if required by the member-visible change policy.
- Out of scope:
  - Reminder schema or availability-core changes.
  - Per-occurrence calendar reads, skip-when-busy consent, or dynamic rescheduling.
  - New memory primitives, tables, services, leases, managers, or state machines.
  - Calendar connection UI or provider-service changes.

## Constraints

- Technical constraints:
  - The persisted reminder remains one existing `schedule.kind: at` record with
    fixed delivery semantics.
  - Use connected-app discovery and exact account selectors; never guess or fan
    out across accounts.
  - Provider content is private untrusted timing evidence and must not enter
    reminder instructions, memory, context references, tests, or replies.
  - Update the stable offer Context record by id; create it only when absent.
- Product/process constraints:
  - Product UX effort: Product change.
  - Exact timing expresses a member decision; a broad window delegates judgment.
  - The reminder must complete before any optional calendar-connection offer.
  - Prompt-primary work uses an isolated worktree, a draft PR, focused local
    proof, and exact-head required CI.

## Product UX journeys

1. Private exact-time member: save the exact requested instant without personal
   timing enrichment or a calendar offer.
2. Private vague-window member with one connected calendar: use bounded patterns
   and narrow conflicts, save one fixed in-window time, and explain the choice.
3. Private vague-window member without a calendar: use remaining context, save
   first, and offer connection only when the canonical cooldown permits it.
4. Private vague-window member with sparse context or an optional-read failure:
   choose a reasonable in-window fallback and make it easy to adjust.
5. Private member with ambiguous calendar accounts: do not fan out or ask a
   timing question solely for optional context; continue from other evidence.
6. Group member: preserve exact timing or choose a simple fixed vague-window
   fallback from room context without touching any participant's personal data.
7. Appointment reminder: member-specified exact or broad timing outranks the
   appointment skill's defaults; defaults remain when neither was supplied.

The desired experience is calm and competent: Murph does the delegated work,
states the selected time and a privacy-safe reason, and invites adjustment
without implying continuous calendar monitoring.

## Risks and mitigations

1. Risk: vague setup is confused with recurring occurrence skipping.
   Mitigation: explicitly require one fixed `at` save and prohibit availability
   bindings, runtime reads, and dynamic rescheduling.
2. Risk: personal provider data leaks or account selection widens.
   Mitigation: private-direct only, exact-account narrow reads, timing conflicts
   only, and explicit forbidden persistence/reply content.
3. Risk: dated memory upserts accumulate duplicate cooldown records.
   Mitigation: exact compact read, stable prefix match, update by id, create once.
4. Risk: the larger resident prompt increases provider input or creates a
   conflicting instruction owner.
   Mitigation: keep policy in the existing shared automation owner, delete the
   broad reminder route, measure representative direct and group prompt impact,
   and assert required plus forbidden composed guidance.

## Tasks

1. [completed] Inspect current prompt owners, canonical commands, and focused
   harnesses.
2. [completed] Add the smallest shared one-shot timing policy and appointment
   precedence.
3. [completed] Add deterministic direct/group regressions and one focused live
   journey.
4. [completed] Add the required changelog entry.
5. [completed] Run focused tests, typecheck, prompt-input measurement, live
   GPT-5.6 Sol verification, complexity check, and final parent review.
6. [completed] Commit and push the candidate, open draft PR #2769, and prepare
   the final scoped plan/changelog commit for exact-head CI.

## Decisions

- GPT-5.6 Sol architecture consultation selected the shared automation prompt as
  the single owner of ordinary one-shot time selection.
- Keep the existing recurring `skip-when-busy` implementation unchanged.
- Use a 14-calendar-day offer cooldown in one canonical Markdown Context record.
- Do not add a separate exact-time live journey because existing live coverage
  already proves fixed exact-time persistence; deterministic coverage will
  protect the new no-enrichment-read rule.

## Verification

- Commands to run:
  - Focused assistant prompt/model behavior Vitest files.
  - Focused appointment reminder policy Vitest file.
  - `pnpm --filter @murphai/assistant-engine typecheck`.
  - `pnpm test:assistant:live -- --test "chooses one fixed time for a vague reminder window from private authorized context" --model gpt-5.6-sol`.
  - `pnpm complexity:diff` and applicable provider-input measurement.
- Expected outcomes:
  - Required exact/vague, privacy, memory, and appointment precedence text is
    present with conflicting one-shot routing absent.
  - The live journey performs one narrow connected-calendar read and one fixed
    reminder save, with a concise truthful reply and no private provider detail.
  - Focused tests and typecheck pass; complexity introduces no new abstraction.

## Completed proof

- GPT-5.6 Sol architecture consultation selected the shared automation prompt,
  one existing fixed `at` reminder, narrow setup-time reads, and one update-in-
  place Markdown Context record. It rejected a new schema, service, manager,
  lease, state machine, or interaction ledger.
- Focused deterministic Assistant Engine proof passed 81 tests across the
  composed system-prompt and appointment-precedence suites.
- Assistant Engine typecheck passed. The focused real-Codex test file also
  compiles in the default-off lane with all 204 provider-gated tests skipped.
- The focused GPT-5.6 Sol live journey passed. It listed connected accounts,
  discovered the current Google Calendar read schema, read one exact account
  over the requested local morning, selected 09:15 outside both synthetic
  conflicts, saved one fixed reminder, and replied with the task, time,
  privacy-safe rationale, and adjustment option. It neither asked for calendar
  permission nor exposed provider details.
- Complete initial provider requests were captured through the pinned real
  Codex App Server against a hermetic Responses stub with identical synthetic
  private/group reminder fixtures, production code mode, `gpt-5.6-sol`, low
  reasoning, and `gpt-tokenizer` 3.4.0 `o200k_harmony`. The fixed-order capture
  included `include`, `input`, `instructions`, `parallel_tool_calls`, `text`,
  `tool_choice`, and `tools` when present; model selection, reasoning, storage,
  streaming, service tier, cache/account, and transport metadata were excluded
  identically. The exact base prompt was reconstructed by removing only this
  timing section and restoring the prior behavior-followthrough route.
  - Private: 30,996 tokens / 143,423 UTF-8 bytes at base; 31,651 / 146,654 at
    head; +655 tokens (+2.1132%) and +3,231 bytes (+2.2528%).
  - Group: 27,122 tokens / 125,760 UTF-8 bytes at base; 27,309 / 126,598 at
    head; +187 tokens (+0.6895%) and +838 bytes (+0.6663%).
  - The delta is entirely assembled instructions. Deferred tool schemas and
    skill bodies do not change the initial request.
- `pnpm complexity:diff` passed with unchanged debt and unchanged maxima. The
  existing `buildStableRouteCapabilityPrompt` (30) and
  `buildAssistantHostedGroupGuidanceText` (25) hotspots remain; splitting the
  cohesive prompt solely to lower the metric would add indirection without
  reducing behavior or ownership.
- The public changelog fragment passed its nine focused archive tests, and the
  hosted Web typecheck passed. Its production presentation reference remains
  `https://www.withmurph.ai/screenshots/ops#changelog-archive`.
- `git diff --check` passed, the synthetic diff contains no conversation or
  provider identifiers, and the parent Product UX walkthrough is Ready.

## Product UX walkthrough

- Exact-time member: the owning rule classifies the request before optional
  reads and preserves the supplied instant; existing past-time and DST recovery
  remain intact.
- Vague private member with a calendar: the live journey proved one bounded
  setup-time read, one fixed conflict-free save, and a concise explanation that
  does not imply ongoing monitoring.
- Vague private member without a calendar: the reminder remains primary and is
  saved before an optional connection offer; one durable 14-day Context record
  prevents repetitive offers, while a permanent refusal uses Instructions.
- Sparse, failed, or ambiguous optional context: the prompt selects a useful
  fixed fallback without making the member solve the timing problem or allowing
  account fanout.
- Group member: composed guidance retains useful local selection while forbidding
  participant memory, routine, wearable, and calendar access.
- Appointment member: the focused skill regression proves exact or broad member
  timing outranks defaults, while defaults remain available when timing is absent.

The final product-purpose verdict is Ready: the change makes delegated reminder
timing noticeably more useful without turning reminders into a dynamic scheduler
or adding a new state owner.
Completed: 2026-09-03
