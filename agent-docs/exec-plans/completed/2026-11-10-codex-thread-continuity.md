# Keep a conversation on its Codex thread

Status: completed
Created: 2026-11-10
Branch: `fix/thread-continuity`

## Problem

A member chat has one native Codex thread that reply turns resume. When a turn
cannot resume it, the turn starts a new thread: the prompt cache is lost (the
cache key is the thread id) and the reply is slower and billed as a full cache
write. Over the last 14 days the logged turns show 202 `contract_mismatch`, 54
`transcript_bookmark_missing` and 41 `binding_absent` restarts against about
1,139 resumes. Cold replies that follow a recent turn of the same model in the
same conversation cost about $13 per 14 days.

Two causes are proven in code and match the production logs.

1. **A failed turn overwrites or drops the saved thread.** Both failure paths
   (`local-service.ts`, `notification-turn.ts`) call
   `applyAssistantSessionCodexResumeStateAction`:
   - a thread id that differs from the saved one is saved with no transcript
     bookmark, so it can never be resumed (`transcript_bookmark_missing` on the
     next turn), and the good thread it replaced is gone;
   - no thread id clears the binding (`binding_absent` on the next turn), even
     when the saved thread was never tried or is healthy.
   In the logs 30 of 32 quick `transcript_bookmark_missing` restarts follow a
   scheduled job that failed (`ASSISTANT_CODEX_FAILED`, Flex capacity), and they
   chain: each retry restarts again.
2. **Scheduled turns and replies take the thread from each other.** An ordinary
   scheduled occurrence runs with the default profile (`session-thread`), so it
   tries to resume the chat's thread and saves its own thread as the chat's
   binding. Its tool list always differs from a reply's (`subscription`,
   `pending_vault_files`, `my_game_reminders`, `send_progress_update` and others
   need an accepted member message), and `thread/resume` cannot replace tools.
   So the scheduled turn always starts a new thread and rebinds the chat to it,
   and the next reply mismatches and starts another. Neither side ever resumes
   the other's thread; the sharing only produces restarts.

## Rule

The chat's Codex thread belongs to its reply turns. Only a completed turn on
that thread advances it. Everything else reaches it through the transcript
bookmark that `2026-11-09-one-conversation-history` introduced.

## Design

1. **A failed turn leaves the binding alone.** Only a completed reply turn may
   adopt or advance the saved thread. Delete
   `applyAssistantSessionCodexResumeStateAction` and the failed-turn use of
   `resolveAssistantProviderResumeStateAction`. The accepted-no-reply recovery
   after a provider failure finalizes with `preserve-existing`. One exception
   is explicit: when the saved thread itself could not be resumed
   (`ASSISTANT_CODEX_RESUME_STALE`, raised for a missing rollout and for a
   resumed thread with a stale execution context) the binding is cleared, so
   the retry starts fresh instead of failing again. A missing thread id no
   longer means anything.
2. **Scheduled occurrences run on their own thread.**
   `resolveAssistantNotificationTurnProfile` returns the existing isolated
   conversation profile for a scheduled occurrence instead of `null`. Every
   notification turn is then isolated, so notification turns never write the
   binding: the notification resume-state helper and the failed-turn binding
   write are deleted.
3. **A scheduled occurrence still reads the chat.** It gets the committed
   transcript history a new thread gets today (planning already builds it for a
   thread that could not resume). The usage optimizer and manual meal estimation
   keep running without history.

No Codex CLI or patch change, no new persisted state, no new tool or flag.

## What changes for members

- A reply after a reminder resumes the chat's thread (warm cache) and sees the
  reminder as an unseen transcript entry, which is the path isolated game and
  onboarding notifications already use.
- A scheduled turn no longer resumes the previous scheduled turn's thread. It
  starts from the transcript each time. Today that only happens when no reply
  came in between.
- Scheduled turns stop adding their tool calls to the reply thread, so reply
  prompts grow more slowly.

## Out of scope

- Group reply reconsideration clears the binding on purpose (the draft thread
  holds an unsent draft). 19 of 27 quick `binding_absent` restarts fit it. Left
  as is.
- Reply-to-reply tool changes and model switches between turns.
- A stable tool superset per conversation, and a shared prompt-cache key.

## Skew and rollback

Runner-only. Old and new runners can serve the same chat: an old runner may
still rebind the chat to a scheduled thread, which the next reply treats as a
contract mismatch exactly as today. No durable format changes. Revert and
redeploy to roll back.

## Verification

- Real provider, local patched Codex 0.166.0, journey `scheduled reminder between
  two replies leaves the reply thread in place`: fails on base (the reminder
  rebinds the chat to a new thread), passes on head (the reminder names the
  supplement from chat history, the binding is unchanged, the second reply
  resumes the first thread and knows what the reminder was for).
- Unit: failed turns keep the saved thread and bookmark after a provider
  failure, a timeout and an untyped error, and `ASSISTANT_CODEX_RESUME_STALE`
  clears it (`turn-finalizer-transcript-bookmark.test.ts`,
  `assistant-local-service-delivery.test.ts`); a scheduled occurrence beside a
  bound reply thread plans no resume and reads the chat, the usage optimizer
  does not (`assistant-codex-turn-planning.test.ts`, fails without the history
  condition); scheduled occurrences get the isolated profile and never write
  the binding (`assistant-notification-turn-runtime.test.ts`).
- Engine suite: 6,213 passed, 1 failed (needs the generated Health Commons
  `goals.json`, unrelated). Typecheck and `pnpm complexity:diff` pass.
- Production after deploy: reply restarts by reason and gap excluding
  `profile_isolated`, cold first requests on replies that follow a scheduled
  turn, combined reply and scheduled spend per turn.

## Review

ReviewGPT plan review, 2026-11-10 (`audit-packages/plan-codex-thread-continuity.md`):
keep the design; no deploy or migration blocker.

- **P1, accepted.** Clear a stale binding on the exact
  `ASSISTANT_CODEX_RESUME_STALE` code, not on a missing thread id. A spawn or
  transport failure with no thread id must keep the binding.
- **P2, accepted.** The accepted-no-reply recovery finalizer passes
  `preserve-existing`.
- **Accepted.** Drop the usage-optimizer argument from notification profile
  selection: an authorized optimizer is always a scheduled occurrence.
- **Accepted.** History eligibility is edited separately from thread ownership
  (`planning.ts`), keeping the optimizer and manual meal exclusions and the cron
  output-history primitive.
- **Rejected with evidence.** A new checkpoint and restore test for reply,
  isolated scheduled turn, reply. This change adds no persistence path:
  snapshots keep the rollouts the saved session references and restore prunes
  the rest (`collectHostedCodexContinuity`,
  `sanitizeRestoredHostedCodexResumeState`), which is what isolated game,
  onboarding and operator notifications already rely on in production. The
  bookmark replay and advance are covered by the `one-conversation-history`
  planning and finalizer tests.
- **Accepted for post-deploy.** Report reply restarts separately from expected
  `profile_isolated` scheduled starts, and compare combined reply and scheduled
  spend.
Updated: 2026-11-10
Completed: 2026-11-10
