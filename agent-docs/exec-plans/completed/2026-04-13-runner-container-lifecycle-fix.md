Goal (incl. success criteria):
- Replace the custom `RunnerContainer` alarm-based idle teardown with the documented Cloudflare Containers lifecycle so idle cleanup no longer throws `Hosted runner container failed to destroy cleanly.` alarm errors.
- Keep warm-shell reuse and explicit destroy behavior intact.

Constraints/Assumptions:
- Follow current Cloudflare Containers docs/package guidance rather than relying on undocumented alarm behavior.
- Preserve existing trust-boundary behavior around warm-shell reuse, control tokens, and outbound handler invalidation.
- Keep the change proportional to `apps/cloudflare` runner lifecycle code.

Key decisions:
- Use the container package lifecycle (`sleepAfter` / activity expiry hook) instead of overriding `alarm()` and calling raw Durable Object `storage.setAlarm`.
- Keep explicit `destroyInstance()` support for direct teardown calls.
- Add focused tests for idle-expiry cleanup and remove tests that depend on the custom alarm contract.

State:
- in_progress

Done:
- Confirmed the error originates from `RunnerContainer.destroyIfRunning({ failClosed: true })` during idle alarm teardown.
- Reviewed repo workflow docs plus Cloudflare Containers lifecycle docs and package README guidance.

Now:
- Patch `RunnerContainer` to stop overriding `alarm()` and move idle teardown to the documented lifecycle hook.
- Update targeted tests.

Next:
- Run `apps/cloudflare` scoped verification.
- Run required audit passes and final review.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether Cloudflare’s runtime may still briefly report `stopping` immediately after `destroy()`, requiring a small settle loop for explicit destroy paths.

Working set (files/ids/commands):
- `apps/cloudflare/src/runner-container.ts`
- `apps/cloudflare/test/runner-container.test.ts`
- Cloudflare Containers docs: package README `alarm()` / `schedule()` guidance and lifecycle docs
Status: completed
Updated: 2026-04-13
Completed: 2026-04-13
