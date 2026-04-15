# Goal (incl. success criteria):
- Reduce hosted signup activation latency by warming the Cloudflare user crypto context before `member.activated` runs.
- Success means hosted onboarding now best-effort pre-provisions Cloudflare right after Privy verification when checkout is next and again after checkout-session creation, without changing activation semantics or blocking the user flow.

# Constraints/Assumptions:
- Keep the change limited to `apps/web`.
- Do not trigger full hosted runtime bootstrap or any user-visible activation before billing confirms.
- Preserve overlapping dirty hosted-onboarding work, especially the separate completion-route auth lane.
- Background warmup must fail safely and only emit sanitized logs.

# Key decisions:
- Reuse the existing hosted execution control client and add one explicit best-effort pre-provision helper rather than introducing a new control-plane abstraction.
- Run warmup from route-level background hooks so the user-facing verification and checkout responses stay fast.
- Keep `completeHostedPrivyVerification(...)` authoritative for the next onboarding stage and only expose the member id server-side for the route hook.

# State:
- in_progress

# Done:
- Traced the signup, checkout, Stripe webhook, activation, and Cloudflare bootstrap paths to isolate safe pre-work from true activation.
- Confirmed the real hosted vault/runtime bootstrap is still correctly gated on `member.activated`.

# Now:
- Patch the hosted execution helper and onboarding routes to schedule best-effort pre-provisioning without adding user-facing latency.

# Next:
- Add focused route/helper tests and run the `apps/web` verification lane for the touched slice.

# Open questions (UNCONFIRMED if needed):
- UNCONFIRMED whether `apps/web verify` is currently green in this dirty tree or still blocked by unrelated hosted-onboarding test edits.

# Working set (files/ids/commands):
- Files: `apps/web/app/api/hosted-onboarding/{billing/checkout,privy/complete}/route.ts`, `apps/web/src/lib/{hosted-execution/control.ts,hosted-onboarding/authentication-service.ts}`, focused `apps/web/test/**`, this plan, and the coordination ledger
- Commands: focused `pnpm --dir apps/web exec vitest ...`, `pnpm --dir apps/web verify` if truthful, `git diff --check`
Status: completed
Updated: 2026-04-13
Completed: 2026-04-13
