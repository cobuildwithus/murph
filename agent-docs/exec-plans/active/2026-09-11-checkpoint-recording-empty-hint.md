# Complete background updates despite empty runtime hints

Status: active
Created: 2026-09-11
Updated: 2026-09-11

## Goal

- Complete already-prepared background updates after the foreground reply without
  restarting the checkpoint quiet window or abandoning replica publication for
  an empty scheduler notification.

## Success criteria

- A checkpoint interrupted by a caught-up default wake retains its existing
  publication deadline while durable effects or their follow-up remain pending.
- A fresh conversation still replies first and restarts its full quiet window.
- Environment recording completes and its Browser Vault replica publishes.
- An empty notification during Browser Vault refresh cannot leave the completed
  update invisible after a clean replacement invocation.

## Scope

- In scope: the existing empty checkpoint-probe deferral, browser refresh wake
  qualification through the existing mailbox classifier, composed regression
  proof, runtime protocol owner documentation, and a public recovery note.
- Out of scope: owner-mode upgrades, future retry admission, new scheduling state,
  provider/model behavior, and unrelated deployment failures.

## Constraints

- Derive outstanding completion work from existing pending/ready effect arrays
  and the durable follow-up flag. Keep foreground admission unchanged.
- Use synthetic fixtures. Parent owns candidate review, commit, PR, and rollout.

## Risks and mitigations

1. Retrying a checkpoint could overtake genuinely new conversation work.
   Mitigation: preserve the existing conversation probe and verify a message
   arriving during snapshot construction replies before background completion.
2. An empty wake unrelated to completion could change existing quiet behavior.
   Mitigation: limit the exception to an existing durable completion obligation
   and run the checkpoint race and ordinary no-progress wake guards.
3. A refresh wake qualification could suppress real work or outlive its owner.
   Mitigation: accept only fully caught-up empty prefixes while local state and
   processing mode are unchanged. Unknown/error results preempt; abort and join
   the read on refresh release and retain the accepted notification.

## Tasks

1. Reproduce the scheduling regression through a real snapshot abort signal.
2. Preserve the existing deadline when the empty probe cannot service a retained
   durable completion obligation.
3. Qualify browser refresh hints before interruption so an empty hint does not
   discard the only remaining replica-publication opportunity.
4. Run focused recovery, fresh-conversation, checkpoint-race, type, and complexity
   checks; update the protocol and changelog.
5. Present the scoped candidate to the parent before committing.

## Decisions

- Product UX effort: Patch.
- Outcome: background updates finish after the existing quiet window despite an
  empty scheduler hint.
- Reaches: private Environment completion and the shared durable-effect owner.
- Proof: foreground reply, canonical recording removal, handled-through progress,
  Browser Vault publication, and unchanged deadlines under an empty notification.
- RED: the composed checkpoint-hint fixture completed eventually but published a
  fourth deadline before its first effect, versus three before the hint. With a
  1.5-second synthetic quiet window, this added another full window.
- Adjacent mode-upgrade and future-recording experiments are excluded. Their
  scratch proof is not candidate scope or evidence of the fixed cause.
- Browser RED: an empty hint interrupted an actual replica write, the dirty
  invocation returned a scheduled immediate wake, and its clean replacement
  never published the replica. The genuine-foreground companion already passed.
- Browser fix reuses the existing coalescing wake signal, interrupt watcher, and
  complete mailbox-prefix classifier. It adds no persisted state or retry owner.
- Foreground impact: a notification during refresh waits for one logical mailbox
  fetch before preemption. The single watcher serializes classification. It reads
  conversation and system prefixes at import budget plus one per lane: 51 per lane
  for an omitted runtime budget, at most 101 per lane for the validated maximum.
  The existing port decodes inline payloads but does not separately fetch payloads
  or import items. Existing transport allows two attempts, a 100 ms retry delay,
  and the configured per-attempt commit timeout (30 seconds by default). Refresh
  completion, cancellation, and its default 30-second deadline abort and join the
  classifier. Read errors or incomplete coverage preserve preemption.

## Verification

- Focused runtime suite: Environment interrupted recording and checkpoint races.
- Package typecheck and `pnpm complexity:diff --base HEAD`.
- Changelog fragment/page proof after the parent supplies the candidate PR number.
- Expected: empty hints preserve the completion deadline and replica publication;
  fresh input retains reply and quiet-window priority. No new persisted state or
  public API. A notification during browser refresh adds one bounded mailbox
  prefix read before deciding whether to preempt; failures preempt conservatively.
- Focused proof passed: four composed Environment cases (ordinary recovery,
  projection-stage foreground interruption, empty checkpoint hint, and fresh
  checkpoint foreground), plus all 20 checkpoint-race cases. The latter retains
  ordinary unresolved-wake deferral and later-message admission without effects.
- Final combined recovery run passed all five Environment cases, including the
  actual delayed projection retry, and all 20 checkpoint-race cases. Six existing
  browser scheduling/timeout/refresh-request cases passed after wake qualification.
- Changelog page proof passed 10 tests; Web and runtime typechecks passed.
  Complexity against the fixed task HEAD passed with unchanged debt and maximum.
- Browser continuation proof passed five cases: empty hint completes publication;
  genuine conversation is serviced before publication; incomplete coverage,
  classification failure, and a different requested owner preserve preemption.
  Each injected notification made exactly one classifier fetch. Final package
  typecheck includes the new proof file.
- Product UX: Ready at the synthetic composed boundary; hosted release proof
  remains parent-owned. An empty hint retains the original deadline and completes
  recording and publication; new input replies before those effects and schedules
  a new full quiet window.
