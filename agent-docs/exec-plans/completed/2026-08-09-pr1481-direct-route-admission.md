# PR 1481 direct-route admission correction

Status: completed
Created: 2026-08-09
Updated: 2026-08-10

## Goal

- Resolve the accepted PR 1481 ReviewGPT finding by rejecting a private
  current-sender continuation before personal Assistant Ask work starts when
  the exact sender has no current same-channel direct Murph route.

## Success criteria

- Fresh and replayed requests fail closed before mailbox handoff when no
  current same-channel direct-member destination exists.
- The unavailable result gives the group Murph one precise recovery action:
  ask the sender to open a direct Murph chat on that channel and retry.
- The private target selects a self-contained direct-recipient answer contract;
  caller-handoff instructions remain limited to group-bound consented asks.
- Missing public group context produces either a truthful limitation with only
  independently useful authorized private information or truthful unavailable
  copy, never an unfinished fact fragment delivered as the final message.
- Existing completion-time and provider-entry authority checks remain intact.
- Focused tests and typechecks pass, the preliminary specialist result is
  resolved, final ReviewGPT reaches `ROUND_OUTCOME: PASS`, exact-head CI is
  green, and GitHub reports a clean merge path.

## Scope

- In scope: the existing Web admission/replay owner, focused Web and Assistant
  Engine coverage, the group-tool recovery instruction, the consented Assistant
  Ask answer profile selected by the trusted target kind, PR evidence,
  ReviewGPT, CI, and mergeability proof.
- Out of scope: new persisted state, provider routing changes, group fallback,
  first-contact messaging, a second model generation, deployment, or merge.

## Round 2 retrospective decision

- Trigger: final ReviewGPT round 2 returned `RETROSPECTIVE_REQUIRED` because the
  remediation repeated the preceding accepted mechanism. A Linq phone-based
  `participant` fallback passed fresh/replay admission, personal work ran, and
  the existing provider-entry owner then rejected the private-completion key as
  non-welcome participant egress.
- Original requirement: the exact group author receives one same-channel
  private answer through an established direct Murph chat, or the request fails
  before personal work with the direct-chat-and-retry recovery. A phone fallback
  that is authorized only for signup welcome does not satisfy that requirement.
- First-versus-current scope: the first reviewed head had no destination gate;
  the current remediation added one by reusing the generic notification
  resolver, but that resolver intentionally includes a first-contact Linq
  participant route that this private purpose cannot use. Review-driven source
  growth remains inside the original Web admission and provider-authority
  boundary and has added no new state owner, queue, service, or lifecycle.
- Decision: Linq `participant` fallback is out of scope for private continuation
  and must return the existing pre-work recovery. The existing private-route
  helper will require the resolver's provider-admissible `thread` delivery kind
  in addition to its current same-channel/direct-member checks. Established and
  pending direct Linq threads remain eligible because the existing provider
  authority already admits both; Telegram direct chats are also thread routes.
- Ownership: the generic notification resolver keeps its broader notification
  semantics. The private current-sender helper owns the narrower feature
  admission/replay/completion predicate, while existing Linq/Telegram provider
  authority remains the final dispatch owner. No provider exception or new
  route state is introduced.
- Required proof matrix: established Linq direct thread accepted through
  completion/provider authority; Linq participant fallback rejected on fresh
  and replay admission before another mailbox append; established Telegram
  direct thread accepted; and missing same-channel destination rejected before
  personal work. Existing provider-boundary tests must continue proving that a
  non-welcome Linq participant send is rejected and accepted thread routes can
  reach dispatch.

## Tasks

1. Add the current direct-destination check to fresh and replay admission.
2. Add focused regression proof for an authenticated Telegram group sender
   without a direct thread and for the model-facing recovery instruction.
3. Run focused verification and inspect the complete corrected candidate.
4. Commit and push the candidate, run the missing preliminary specialist pass,
   final ReviewGPT round 2, and exact-head CI, then resolve any accepted issue.
5. Resolve the specialist's recipient-ready answer-contract finding with one
   explicit target-owned mode and focused Engine/Runtime/Web proof.
6. Complete the parent final review, close this plan, push the final head, and
   prove mergeability without merging the PR.
7. Apply the completed round-2 retrospective by excluding Linq participant
   fallback from private admission/replay, add the route matrix proof, and rerun
   final ReviewGPT on the corrected exact head.

## Verification

- `apps/web` focused Vitest: 167/167 passed across current-sender admission,
  private completion, group-tool dispatch, and signed route coverage.
- `packages/assistant-engine` focused Vitest: 93/93 passed across the exact
  current-sender model boundary and group-tool catalog/dispatch coverage.
- `apps/web` and `packages/assistant-engine` package typechecks passed.
- Scoped Web ESLint passed; Assistant Engine has no package lint script and is
  covered by its typecheck and focused Vitest lane.
- `git diff --check` and the added-lines identifier/secret scan passed.
- Exact-head Linux CI measured the intended dynamic-tool recovery projection at
  9,927,719B total runner output, 7,510B above the previous ceiling. The
  forbidden startup-input guard passed. A clean macOS production assembly then
  measured 9,974,661B total and a 7,997,170B static closure; both baselines are
  ratcheted to the higher exact cross-platform measurements while retaining the
  established 32KB and 96KB allowances. The focused budget test passed 42/42,
  and the assemble-only production probe passed with a 1,672,790B entry,
  7,997,170B static closure, and 9,974,661B total output plus a successful boot
  probe. The Cloudflare package typecheck passed. A scoped root ESLint attempt
  could not run because this workspace has no root `eslint` binary and the
  Cloudflare package exposes no lint script; typecheck and focused Vitest cover
  the changed TypeScript.
- The first preliminary specialist attempt was tooling-invalid: it returned a
  completion marker after 77 seconds, below the required five-minute credibility
  floor. Its result is untrusted and does not count. The valid same-thread retry
  returned two connected findings: the private target inherited caller-handoff
  instructions despite having no second generation, and the tests assumed
  recipient-ready text instead of proving it. Both findings are accepted.
- The correction adds an explicit `caller_handoff` / `direct_recipient` answer
  mode selected by the server-owned Assistant Ask target kind. The direct mode
  requires self-contained recipient-ready text, states missing group context
  truthfully, and forbids raw facts for another assistant to finish. Fixed
  unavailable copy no longer attributes missing evidence specifically to the
  private vault.
- Corrected focused proof passed: Assistant Engine 21/21, Assistant Runtime 2/2,
  and Web 14/14; all three package typechecks and scoped Web ESLint passed.
  Rebuilt Engine/Runtime production artifacts passed the runner byte/boot probe
  at a 1,672,907B entry, 7,998,431B static closure, and 9,975,922B total.
- The existing `caller_handoff` consented-answer instruction profile remains
  byte-for-byte unchanged at 1,497 bytes / 268 `o200k_harmony` tokens. Only the
  opt-in `direct_recipient` profile changes, measuring 1,643 bytes / 286 tokens
  (+146 bytes / +18 tokens) so the later private answer is self-contained.
- After the clean latest-main merge, Assistant Engine passed 21/21, Assistant
  Runtime passed 2/2, and Web passed 14/14 in the focused suites. All three
  package typechecks and scoped Web ESLint passed. Rebuilding current
  hosted-execution, Engine, and Runtime artifacts then passed the production
  runner assembly and boot probe. A second conflict-free latest-main merge
  changed only unrelated Family and Assistant skill surfaces; the focused
  Engine suite still passed 21/21, both Engine/Runtime builds passed, and the
  final probe measured a 1,672,934B entry, 8,023,354B static closure, and
  10,000,845B total, within every ratcheted allowance.
- Exact-head CI at `ee06af0e53` passed every required workflow and job before
  the specialist correction. The first final-round-2 attempt reached a managed
  lane request limit before generation, and the cross-profile same-thread
  recovery failed before staging because that thread was not readable there;
  neither attempt counts as a review round. The fresh-snapshot recovery produced
  `ROUND_OUTCOME: INVALID` after proving that the guarded source snapshot
  included the local specialist correction while the PR diff still described
  pushed head `ee06af0e53`; it issued no code findings and also does not advance
  the round. The specialist correction is now committed and merged cleanly with
  current `origin/main`, so the next round-2 retry can package one clean exact
  pushed head. That candidate still needs exact-head CI, final ReviewGPT, parent
  final review, plan closure, and clean-merge proof.
- Exact-head CI at `b3d3209b8c` passed every required workflow and job. The
  clean round-2 audit ran for more than 26 minutes on the requested Pro model and
  returned `RETROSPECTIVE_REQUIRED` for the Linq participant-fallback route.
  Static tracing and the existing Linq egress-authority suite reproduced the
  accepted-but-terminal-before-provider path, so the retrospective decision
  above is complete.
- The correction adds one predicate to the existing private-route helper:
  accepted destinations must use the provider-admissible `thread` delivery
  kind. Fresh and replayed Linq participant fallback now use the existing
  pre-work recovery; the generic notification resolver and provider authority
  are unchanged. Focused Web route-matrix coverage passed 10/10, existing Linq
  egress-authority coverage passed 44/44, Web typecheck passed, scoped ESLint
  passed, and `git diff --check` passed.
- Focused Assistant Runtime provider-boundary proof passed 2/2 for accepted
  Linq and Telegram private thread routes reaching provider entry under the
  existing repeated authority checks.
- Exact-head CI at `969f7b79ee` passed every required workflow and job:
  Frontend Design Proof, Repo Hygiene, Cloudflare Runner Permission Sandbox,
  Hosted Stripe Billing, Web Viewport Overflow, and the complete Murph Host
  Support matrix and aggregate.
- Final ReviewGPT round 3 ran a fresh full-patch audit for more than 17 minutes
  on the requested `gpt-5.6-sol` route (response model `gpt-5-6-pro`) and
  returned `ROUND_OUTCOME: PASS` with no qualifying findings. It explicitly
  verified the round-1 route gate, direct-recipient answer profile, completed
  round-2 retrospective, Linq participant exclusion, exact-text delivery
  authority, privacy boundary, simplicity, and exact 4,454/144 change shape.
- Parent product-experience revalidation found no material issue: the smallest
  complete journey is still one self-contained same-channel private answer to
  the exact author, nothing in the group, or the existing direct-chat recovery
  before personal work. Parent final full-diff review, prohibited-cast scan,
  identifier/secret scan, `git diff --check`, ancestry check, and worktree
  cleanliness all passed with no additional finding.
Completed: 2026-08-10
