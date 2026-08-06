# Make browser progress updates proactive

Status: active
Created: 2026-08-06
Updated: 2026-08-06

## Goal

- Make member-visible progress reliable at the start of browser work without
  turning routine page operations into status chatter.
- Remove the base-instruction conflict that tells Codex to use hidden native
  commentary for progress.

## Success criteria

- The Codex base instructions no longer direct progress into commentary and
  still reserve the final channel for the complete answer.
- Computer-use guidance requires one member-visible update for each current
  user message that starts or resumes site operation or multi-call browser work,
  while preserving a narrow exception for a genuinely quick single read.
- If a quick read expands into another browser call, the guidance requires the
  update before continuing; an update from an earlier user message does not
  satisfy the current one.
- The progress tool's text contract permits a truthful task acknowledgement and
  immediate next step before the first browser action.
- Focused Assistant Engine tests and typechecking pass, exact-head CI is green,
  and the required prompt, product-experience, and coverage specialist lenses
  have no unresolved accepted findings.

## Scope

- In scope:
  - Codex base execution instructions.
  - The browser-open tool's turn-local progress prerequisite and the
    browser-act expansion boundary for work that starts as a single read.
  - Deletion of competing browser progress cadence from the computer-use skill.
  - The progress tool text description needed by that pre-action rule.
  - Deterministic prompt and skill regression tests.
- Out of scope:
  - Cold-start/runtime latency changes.
  - Host-generated progress timers, delivery state, queues, or new telemetry.
  - Progress policy for non-browser skills or group conversations.

## Constraints

- Technical constraints:
  - Keep the change prompt-primary; do not alter runtime dispatch or delivery.
  - Preserve the existing per-turn progress budget and browser safety rules.
  - Keep instructions lean, task-specific, and non-duplicative for Sol.
- Product/process constraints:
  - Progress must be member-visible through `murph.send_progress_update`.
  - Do not narrate individual page checks, navigations, actions, or clicks.
  - Use the isolated worktree/PR lane and run the preliminary ReviewGPT pass
    with product-experience, prompt, and coverage lenses.

## Risks and mitigations

1. Risk: Murph sends noisy updates for trivial browser reads.
   Mitigation: exempt only a genuinely quick single read and retain the ban on
   page-by-page narration.
2. Risk: The model treats an earlier turn's update as sufficient after the user
   replies or approves continuation.
   Mitigation: state explicitly that every current user message starts a fresh
   progress decision.
3. Risk: Pre-action guidance conflicts with a schema that demands completed
   progress.
   Mitigation: allow a truthful task acknowledgement plus the immediate next
   step while continuing to ban unverified claims and final conclusions.

## Tasks

1. Update the base instructions, computer-use skill, and progress text contract.
2. Add deterministic regressions for the removed conflict and browser rule.
3. Run focused tests, typecheck, diff review, and provider-input impact proof.
4. Commit and push the candidate, open the PR, run the required preliminary
   specialist pass alongside exact-head CI, and resolve accepted findings.
5. Perform the parent final review, close this plan with `scripts/finish-task`,
   push the final head, and prove mergeability.

## Decisions

- Use a surgical prompt-only correction. Production traces proved the model
  skipped an available progress tool; they did not prove a delivery failure
  that would justify a new timer or runtime state owner.
- Put the browser trigger in `computer_open`, where it is visible before the
  first browser action even when the on-demand computer skill has not yet been
  loaded. Keep the skill focused on browser safety and delete its competing,
  permissive progress paragraph.
- A stochastic target-model trial showed that `computer_open` alone did not
  reliably cover a one-read task that expanded after seeing the page. Put the
  narrow follow-up rule in `computer_act`: before browser call two in the
  current turn, send progress if it is available and not already sent. This
  keeps the rule adjacent to the exact decision boundary without adding state
  or narrating every browser action.
- Do not inject a browser reminder into every ordinary turn. Computer tools are
  available on more turns than browser work is needed, so that would repeat
  irrelevant conditional text and weaken the stable prompt prefix.

## Verification

- Focused prompt, skill, tool-description, route-assembly, and fingerprint
  Vitest suite: 5 files passed, 146 tests passed, and 6 opt-in cases skipped.
- Assistant Engine package typecheck: passed.
- Assistant Engine dependency-closure build: passed across 18 workspace
  projects before the final wording refinement; the corrected head typechecks.
- The package-wide suite could not complete locally. Its default fork lane hit
  the existing roughly 4 GB integration-test memory ceiling, and the supported
  one-worker lane later left its sole Vitest worker idle at 0% CPU for nearly
  ten minutes without firing a test timeout. Only the exact owned sessions were
  stopped. Focused proof passed, and exact-head CI remains the broad gate.
- `git diff --check`: passed; both temporary real-model and provider-request
  capture harnesses were removed and verified absent.
- Complete first-provider request capture used the pinned real Codex App Server,
  the local scripted Responses provider, `gpt-5.6-terra`, low reasoning, code
  mode, and `gpt-tokenizer` 3.4.0 `o200k_harmony`. The serialized provider fields
  were `include`, `input`, `parallel_tool_calls`, `text`, and `tool_choice`, with
  local paths and UUIDs normalized identically and transport-only fields
  excluded:
  - direct browser turn: 115,428 bytes / 25,312 tokens at base and 115,396 bytes
    / 25,311 tokens at head (`-32` bytes / `-1` token);
  - group browser turn: 99,145 bytes / 21,642 tokens at base and 99,131 bytes /
    21,646 tokens at head (`-14` bytes / `+4` tokens).
- A production-faithful, authenticated `gpt-5.6-terra` trial exercised the real
  Codex App Server, full production base/developer prompts, production dynamic
  tool executor, and synthetic browser transport. The corrected event order
  was:
  - initial multi-step work: progress, open, act, finish, final;
  - single read that expanded: open, progress, act, finish, final;
  - first turn paused for approval: progress, open, pause, final;
  - new approval message resumed: progress, open, act, finish, final;
  - progress delivery unavailable: open, act, finish, final.
  No real site, member, message, or external state was touched. The temporary
  harness was deleted.
- Preliminary `completion-specialists` ReviewGPT pass on the first pushed
  candidate returned two accepted findings: add actual target-model ordering
  proof for four browser journeys, and update a stale route-assembly assertion.
  Both are resolved above. Per workflow, the preliminary pass is not rerun.
- Parent corrected-head product verdict: the irreducible purpose is one
  truthful, member-visible orientation before reply-critical browser waiting,
  without per-action chatter. Existing progress delivery plus the two adjacent
  browser tool contracts is the smallest complete owner boundary. The five
  event timelines prove initial work, expansion, cross-turn resume, and the
  unavailable-tool fallback. Residual stochastic model compliance remains; a
  hard guarantee would require separately scoped runtime enforcement.
- Pending: corrected exact-head GitHub Actions, parent final diff review, plan
  closure, and mergeability proof.
