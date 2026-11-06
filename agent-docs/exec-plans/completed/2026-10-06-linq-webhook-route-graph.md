# Keep the Linq webhook route graph lean

Status: completed
Created: 2026-10-06
Updated: 2026-10-06

## Goal

- Make the first inbound Linq message in each Web process cheaper by removing
  code from the webhook route's static import graph that the route never needs.

## Evidence

- On Vercel, Next runs in minimal mode and loads a route's module graph on that
  route's first request in each process.
- After deploy, 10 of 15 Linq webhooks were the first Linq request in their
  process. Those paid 207–604 ms before the handler ran; later requests paid
  14–24 ms. The 3 inbound member messages all paid it.
- The webhook route loaded 70 chunks (5.51 MB). Import-graph tracing found three
  wrong edges:
  1. `webhook-service.ts` re-exported the Stripe webhook handler.
  2. It imported `reconcileHostedThreadContainerParticipants` from the
     2,850-line `group-tool.ts`, which pulls in the group tool and the
     device-sync wake service.
  3. The two Workflow adapters imported the large `workflow/api` client SDK
     statically, so a rare Telegram phone-call recovery signal put the SDK,
     undici, and another zod copy on the Linq graph.
- Preloading the route at process start was measured and rejected. It removed
  the Linq cost, but it added up to 340 ms to any request arriving during boot,
  which is ~50–60 runtime callbacks per hour against 2–3 faster member messages.

## Success criteria

- The Linq route graph shrinks, and nothing on the Linq path changes behavior.
- The first Linq request in a process that has already served other routes is
  measurably faster in a production build, and other routes are no slower.
- A boundary test keeps these edges from returning.

## Scope

- In scope:
  - Point the Stripe route at its own handler module.
  - Move participant reconciliation into `hosted-groups/thread-container-participants.ts`.
  - Load `workflow/api` inside `startHostedPointerWorkflow` and
    `signalHostedPhoneCallReconciliation`.
  - Add the boundary test and a README note.
- Out of scope:
  - OpenAI: lazy loading would need reworking its `APIError` classification.
  - Privy: needs a `privy.ts` split.
  - Stripe: still reaches the route through `runtime.ts` and `family-plan.ts`.
  - Splitting the Telegram handler out of `webhook-service.ts`: it measured
    ~0.04 MB once the Workflow SDK was lazy.

## Decisions

- Prefer moving code to its owning module over scattering dynamic imports. The
  only dynamic imports are inside the two adapters whose job is to wrap
  `workflow/api`.
- Moving `signalHostedPhoneCallResultNotificationRecovery` next to the signal
  code was tried and reverted. The production bundle did not change, because the
  Workflow compiler already strips workflow bodies from client imports.

## Verification

- Production build route chunks: 70 (5.51 MB) before, 57 (3.91 MB) after.
- Fresh-process benchmark of a minimal-mode production build, 7 runs, medians:
  - First Linq request after another route: 357 → 294 ms.
  - Cold Linq request: 445 → 380 ms.
  - Other route: unchanged (~105 ms).
- Web typecheck, eslint on the changed files, and 46 affected Vitest files.
  Postgres suites ran against a migrated `murph_test_<slug>` database; the
  remaining local Postgres failures reproduce identically on `main` and pass
  in isolation.
Completed: 2026-10-06
