# Drain ready mailbox work in the current runner

Status: completed
Created: 2026-11-19
Updated: 2026-11-19

## Goal

Process a backlog of ready ordered mailbox items in one hosted invocation. Preserve each item's checkpoint, execution permissions, foreground priority, and retry deadline.

## Evidence and decisions

- A restored fixture with two member edits, a preferences update, and a clinical import previously needed several starts. Requiring all four effects after the first invocation exposed the second edit still pending.
- A second fixture exercised the default owner. Before the change, it returned after publishing the first of two queued edits.
- Reuse each owner's existing item preparation, checkpoint, and recording path. After a completed item leaves the mailbox, consult the live queue for the next eligible item. A retained claim yields to its existing recovery path.
- Keep the queue wake separate from independent action deadlines. This preserves future retries and lets a drained queue become idle.
- The default owner admits new input on each pass. Device and clinical import controllers retain their independent per-admission budgets.

## Verification

- Passed 589 tests across ten runtime suites, including normal and assistant-blocked backlogs, shutdown between edits, snapshot restore, receipt response loss, foreground preemption, future retries, and idle wake publication.
- Passed the assistant-runtime typecheck, 46 changelog tests, documentation checks, and the complexity guard. Product review found the edit and interruption cases ready.
Completed: 2026-11-19
