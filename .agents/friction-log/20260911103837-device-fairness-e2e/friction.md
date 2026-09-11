---
title: 'Device fairness E2E traps the retry needed after a zero-job yield'
severity: 'minor'
---

## Expected Behavior

The fairness proof should hold a receipt-bounded device pass with positive progress and durable backlog while a due reminder is admitted once.

## Current Behavior

The test arms its shutdown checkpoint barrier at the pre-drain retry fence. Runtime maintenance may legitimately yield there before processing any jobs. The test then retains that shutdown barrier while waiting for a positive job count, preventing the scheduled retry that could establish progress.

## Possible Solution

Release a zero-job yielded pass and rearm the existing barrier for its retry. Retain the barrier once positive progress is observed, with the reminder deadline bounding the entire attempt. Preserve the one-admission window, bounded progress, durable backlog, exact reminder delivery, and final drain assertions.

The original 60-second overlap also leaves no useful processing time after a 30-second runtime-log flush and the minimum 30-second progress backoff. Budget the existing flush and backoff owners before the reminder without changing the original 30-second admission assertion or scheduler policy.

## Minimal Reproducible Example

Run the Linq reminder/device-sync non-starvation E2E when the first system pass cooperatively yields immediately after its retry-fence checkpoint. The held shutdown checkpoint prevents the next pass while the test waits for processedJobs greater than zero.

## Context

The original failure formatter also omitted the existing finite pass-stage, outcome, and yield-reason fields needed to distinguish cooperative pre-drain yields from failed work.

After correcting the barrier and retry budget, the same proof exposed a production defect: the system-work caller replaced the receipt-capacity predicate with a reminder-deadline predicate. The pass reached its 100-job ceiling instead of yielding at receipt capacity. The correction removes the override parameter entirely. Receipt capacity remains with the shared system-work owner; a due reminder wakes assistant admission while the import continues. The receipt-bounded E2E assertions are retained.

The terminal backlog check also reused the four-minute observation budget even though the scheduler permits 30-second, two-minute, and ten-minute no-progress retries. A Linux integration run delivered the reminder but timed out with 46 resources remaining. A local replay confirmed that cooperative cancellation can process 63 jobs, then four jobs, then a zero-job pass before resuming the remaining 46 queued jobs. The terminal drain now has a separate 15-minute budget covering those retry levels and one bounded two-minute device pass. Reminder timing, positive receipt-bounded progress, the first admission window, and exact delivery assertions retain their original budgets.
