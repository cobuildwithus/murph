# Private prompt diet: resolve conflicting rules and move procedures into skills

Status: active
Created: 2026-11-05
Updated: 2026-11-05

## Goal

The private (1:1) Murph prompt is about 105KB of developer instructions before
the CLI contract and tool schemas. About 40KB is step-by-step procedure that
most turns never use, and several rules contradict each other, so a literal
model has to guess which one wins. OpenAI's GPT-6 guidance asks for audited,
non-conflicting instructions and warns that more literal instruction following
turns stray procedures into gates.

Outcome: a smaller private prompt whose resident text holds principles and
triggers, with procedures in skill files the model reads when the task needs
them. Group prompts stay byte-identical; the conflict qualifiers render only in
private turns.

## Scope

1. **Conflicts.** One short "saving what the member shares" contract replaces
   the scattered persistence rules:
   - Default consent to save shared health data vs "never infer permission to
     persist" (Delegated initiative) vs "durable private media needs
     confirmation" (Capability offers): the two gates now say they govern
     actions Murph proposes, not data the member sends for Murph to use.
   - "Do not save when the evidence is too ambiguous" vs "preserve raw
     evidence": save what is clear, ask one question for the rest, preserve the
     source when nothing structured is recoverable.
   - "One Journal note per fact" vs typed records: a fact saved to a typed
     record (meal, lab, measurement, workout, medication, symptom) needs no
     duplicate Journal note.
   - "Verify existing records before creating anything" is scoped to the
     missed-capture inquiry it was written for.
   - "Do not skip this because other context seems sufficient" (vague reminder
     calendar read) is restated as the reason the read can change the result.
   - Skill gates: strength-training's consent for "any persisted record" is
     narrowed to plan activation; goal-setup's pre-question reads are checked.
2. **Group-only text out of private turns.** Rules that only apply inside a
   group room (first-reply contact card, current-room shared reads, scheduled
   group email, shared-health scope list) no longer render in 1:1 turns. The
   private-chat group procedures (consult, handoff, membership paging, sharing
   recovery) move to a new direct-only skill with a resident trigger.
3. **Procedures into skills.** Resident text keeps the obligation and a trigger
   line; the mechanics move:
   - Journal note mechanics -> new `journal` skill.
   - Clinical document mapping, NKDA, PDF/audio tooling -> new `health-records`
     skill. Durable progress-photo capture -> same skill.
   - Vault file sends -> new `file-send` skill.
   - Reminder authoring and timing (one-shot time selection, calendar offer,
     wearable freshness, instruction wording, continuity, appointment reminder
     timing) -> new `reminders` skill.
   - Product feedback (and its salience trigger) -> new `product-feedback`.
   - Style settings (direct) -> new `assistant-style`.
   - Habitat -> new `habitat`.
   - Lab test discovery -> new `lab-tests`.
   - Computer-use, browser-action, phone and connected-app procedures -> their
     existing skills, keeping one trigger line each.
   - Skill router recipes (food label batch, goal-setup first round) stay
     resident: they tell the model to read the skill in the same tool step as
     the first command, which is latency choreography, not procedure.
4. **Deletion.** `AssistantModelBehaviorProfile` (`default` | `gpt5-agentic`)
   changes no text for any model. Delete the type, resolver and plumbing.

## Non-goals

- No change to tool schemas, dynamic tool admission or the CLI contract.
- No change to the private group overlay skills (`group-chat`,
  `group-challenge*`, `group-newsletter`, `groupchat-comedy`,
  `music-generation`); murph-cloud replaces them at deploy.
- Group prompts: byte-identical (checked for Linq, email and Telegram).

## Risks and how each is checked

- **Skill not loaded when needed.** Each trigger names the user-visible
  situation, not the tool. Live journeys for each moved area run before and
  after (gpt-6.1-terra pilot), then the full live suite on gpt-6.1-sol.
- **Lost behavior.** Every removed sentence lands in a skill or is deleted as
  a duplicate of a tool description or existing skill; the PR lists where each
  section went. Deterministic tests that pinned prompt text now pin the skill
  text.
- **Latency.** Moved procedures add at most one skill read on turns that need
  them; Journal saves read the skill in the same step as the CLI help they
  already read.
- **Deploy skew.** Skills ship in the same runner bundle as the prompt. No Web
  change.

## Verification

- Deterministic: assistant-engine and assistant-runtime suites, prompt budget
  and route hash tests, skill registry tests.
- Live pilot (gpt-6.1-terra), 23 journeys before vs after: Journal note
  quality and capture recovery, blood type provenance, meal dish names,
  hospital history, approved vault-file continuity and Telegram file delivery,
  reminder authoring, appointment check-in, travel reminder location, weather
  alert, product-feedback summary, personalization, style boundary, Kernel
  browser, group consult from private.
- Live sweep (gpt-6.1-sol, patched native Codex): every live journey except
  the group-only game suites (group prompt is byte-identical and game skills
  are untouched). Failures rerun on main to separate regressions from existing
  failures.
- Harness: journeys that stage a subset of skills now also stage the nine
  skills the private prompt names on every turn, as production ships every
  public skill.
- Provider input before/after for direct and group.

## Progress

- [x] Plan
- [x] Prompt and skill edits
- [ ] Deterministic tests
- [ ] Live journeys
- [ ] PR, ReviewGPT, CI, merge, runner deploy
