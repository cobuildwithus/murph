# Prompt clarity: make Murph's instructions easier to follow and smaller

Status: completed
Created: 2026-11-10
Updated: 2026-11-10

## Goal

Murph's instructions (base instructions, developer prompt, tool descriptions,
public skills, private group skills) grew one incident at a time. The same rule
is stated in many places, copies disagree, and long procedures sit where every
turn pays for them. OpenAI's GPT-6 guidance says this model family follows
instructions more literally and stalls on unclear or conflicting skill text.

Outcome: instructions that say each rule once, in plain sentences, in the place
that owns it; fewer bytes on every turn; tests that check structure and
behavior instead of wording. Behavior parity is not required where the current
text makes Murph over-ask, hedge, stall or go quiet. Privacy, safety, consent
and money boundaries hold.

## Owner decisions (2026-11-10)

- Scope is the product assistant only. Developer-agent guidance is out.
- Member-facing behavior is the implementer's call within the boundaries above.
- Several pull requests, one deploy.
- Cut textbook health knowledge the model already has.
- Rebuild group humor: craft belongs where the model always sees it.

## What the audit found (sixteen read-only reports, 2026-11-10)

Reports and drafted replacement text are kept in a local folder outside both
repositories because they quote private skill text.

- Repetition that turns into conflict: "claim a save only after proof" 27
  times with two standards; "when to ask" with five tests; booking
  authorization with four; "do not joke on every message" at least 12 times.
- Text with no reader or the wrong reader: `triggerHint` strings (21 KB, read
  only by tests); every tool input schema sent twice; scheduled turns carry the
  private-chat prompt; the group-challenge skill describes the older
  data-scored challenge while app-game rules live in tool text.
- Over-asking written into the text: 10 to 16 questions before a first
  proposal in onboarding; up to five yeses for an experiment; booking stops
  for a date of birth on sites that do not ask for one.
- Tests pin wording: about 5,300 prose pins across 139 files; 294 negated pins
  cannot fail; the opt-in size envelope has a floor, so a shrink fails it.
- Live lane: the selected Codex home's global agent instructions leaked into
  most journeys; private group skills had no live coverage.

## Thread rotation (verified in `codex-contract-fingerprint.ts`)

On hosted Codex the thread fingerprint hashes tool declarations and the route,
not the developer prompt. Changing tool text rotates every thread once;
changing prompt text alone does not. All tool text therefore ships in the one
deploy, and base-instruction changes ride the same rotation.

## Sequence

Each step is its own pull request, stacked on one integration branch and
merged to main once.

1. Tests first, prompt bytes unchanged: block identifiers returned beside the
   prompt text, a route-by-block admission matrix, reference integrity for
   commands, tools and skill paths, per-route byte ceilings; delete prose pins
   that those replace. The existing whole-prompt hash proves the prompt did
   not change.
2. Base instructions and the private-chat prompt: one "acting and permission"
   section, one asking rule, one proof rule, ordered turn steps, shorter vault
   recipes and skill router; delete `triggerHint`.
3. Tool descriptions and results: stop sending the schema twice, defer tools
   that are rarely used, move policy out of descriptions, fix results that
   give wrong orders or leak internal names.
4. Scheduled turns: a lean scheduled prompt, a short per-reminder wrapper, one
   send-or-skip rule.
5. Group prompt and humor: craft and targets resident, group-only defaults,
   game tools admitted by room state.
6. Public skills by seam: hot path, setup and behavior, account and transport,
   nutrition, movement and sleep.
7. Private group skills (companion repository): group-chat core plus
   references, comedy, challenge split, scorecards, newsletter; bundler
   support for reference files.

Not in this pass unless the owner says otherwise: rewording text stored in
member vaults (managed automation seeds, saved reminder instructions), and
clinical thresholds.

## Verification

- Offline: rendered prompt and tool catalog diffs per route give exact byte
  deltas.
- Live: baseline worktree at the audited commit against the candidate, same
  Codex binary and home, personal config excluded, real private skills
  mounted, each journey on its production model. Screen at 5 samples per arm
  (10 for hot paths), confirm flagged journeys at 20.
- Humor: a fixed scenario set run five times per arm, read blind by the owner,
  plus mechanical checks for boundaries and silence.

## Decisions on the open questions (owner gave a general go-ahead, 2026-11-10)

The owner said to proceed on the implementer's judgment as long as Murph keeps
behaving well. The defaults that were proposed now stand:

1. New challenges are app games. A data-scored challenge already running in a
   room keeps working from a reference file.
2. Group humor: the least-qualified friend who keeps the count.
3. Onboarding proposes a starting setup after two or three questions.
4. Booking may type identity facts the member already saved into the
   practice's own form. Payment and the final submit still need a yes.
5. Text stored in member vaults is a follow-up, not this pass.
6. Health reference the model already knows is cut.
7. Where two clinical numbers conflict, the more conservative one stays. No
   threshold changes.

Do not make the declared tool set depend on room or turn state: a changed
declaration restarts the hosted thread.

## Progress

- 2026-11-10: audit complete; live lane fixed with a clean-config wrapper;
  baseline pilot started.
- 2026-11-10: baseline pilot (72 live runs) found four journeys failing on
  main: meal log attaches no nutrition card (both models), booking omits the
  saved date of birth (Terra), symptom save unverified (mostly Terra), game
  setup default terms (Sol). Candidates must fix or not worsen them.
- 2026-11-10: prompt block identifiers committed (render byte-identical).
  Seam rewrites in progress, one branch each: private-chat core, capabilities,
  scheduled turns, group prompt and humor, tool catalog, dynamic tools, games,
  five public skill batches, private group skills. Nutrition skills done
  (299,571 to 94,866 bytes).
- 2026-11-10: group humor candidate passes 56 of 56 scenario runs at about a
  third of today's input tokens per reply.
- 2026-11-10: twelve seams integrated on one branch. Prompt size: private chat
  81.1 to 70.2 KB, group 80.9 to 70.9 KB, a private scheduled turn 81.4 to
  44.6 KB. Structural test suite committed (route-by-block matrix, reference
  integrity, size ceilings; about 3,850 wording pins removed). Private group
  skills committed in the companion repository (challenge skill 59 to 6 KB).
- 2026-11-10: first private-chat comparison on the production model, 22
  journeys, three samples per arm: no behavior regression found; symptom save
  improves from 0 of 3 to 2 of 3. Remaining red rows were live assertions that
  pinned old headings or wording, now being adapted.
- 2026-11-10: movement, sleep and mind skills merged (sixteen files to six,
  501 to 80 KB) and cross-seam follow-ups applied (one owner per rule).
- 2026-11-10: group, games and scheduled comparison, 81 journeys, three samples
  per arm: 211 of 243 on main, 210 of 243 on the branch, average input per run
  265,701 to 104,173 tokens. Real regressions found and fixed: a counted day
  kept a paraphrase instead of the player's words; an unposted open day lost
  "you have until 3 AM"; a legacy weekly recap added a missing-data caveat; the
  morning Journal pass re-listed reminders to check its own repairs because the
  lean scheduled prompt had dropped "read once, trust the write result"; a
  deferred optional connection was mentioned again at the end of onboarding;
  the merged physical-therapy skill saved a condition in place of the Journal
  note. Group humor: 75 of 75 scenario runs.
- 2026-11-10: final sizes. Private chat 81.1 to 69.2 KB, group 80.9 to 70.3 KB,
  private scheduled turn 81.4 to 46.2 KB, group scheduled turn to 55.2 KB.

## Follow-ups (not in this change)

- Text stored in member vaults: managed automation seeds reconcile themselves;
  saved reminder instructions keep their old wording.
- Live journeys that cannot pass for reasons outside the assistant are recorded
  in the friction log entry created with this change.
- Retired skill names have no redirect files. The router names the new skills.
Completed: 2026-11-10
