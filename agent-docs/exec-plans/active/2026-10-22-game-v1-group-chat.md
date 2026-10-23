# Game v1 group chat cancellation and tools

## Outcome and protected invariants

Cancelling an app change that was queued or sent announces that cancellation once to the same two-player room. It never changes agreed rules or cancels the challenge. Pending/failed unsent and chat-origin changes do not create backend announcements. Current audience and route authority remain required through dispatch; negotiating games are supported.

## Owner and root cause

The canonical cancel transaction clears the proposal and writes its history but reserves no lifecycle receipt. Existing receipt, minute drain, generated notification, bootstrap, and outbox owners already provide durable delivery. Extend those owners; no queue, migration or health data is needed.

## Product UX

- Entry: proposer cancels in the app after the change entered chat delivery.
- Reaches: both players in the proven shared room, including negotiating games. No duplicate backend message for chat-origin requests.
- Message: concise cancellation, no false challenge cancellation, acceptance, restart, or delivery claim. A later pending request must not be described as cancelled.
- Tools: support up to 365 days and prize/dare stakes; tasks and stakes lock at kickoff. Ordinary photos no longer universally require a heart-rate graph.
- Proof: transactional eligibility/idempotency and rollback, drain/wake recovery and dispatch audience checks; generated cancellation, live stake refusal and 75-day real-Codex journeys; complete provider-input comparison.

## Implementation and rollout

Reuse lifecycle reservations in the cancel transaction, with a cancellation-specific template and per-proposal identity. Drain and dispatch through existing generated notifications. Preserve exact-player authorization. Update shared instruction builders and model-facing tools only after the reader floor and rules release.

Develop on main in an isolated checkout; rebase onto the merged rules before verification. Merge only after PR 2 and runtime floor convergence. Cancellation uses the existing generic notification and bootstrap wire shapes; the deployed runtime passes through its event ID and instructions without a new parser. Web owns both reservation and dispatch authority. After PR 2 Web is verified, deploy this Web change and refresh the runtime tool text; no new wire consumer floor is introduced. Required CI and ReviewGPT plus requested Codex review gate landing. Production Vercel admission and runtime convergence are separate proof.

## Verification

Focused game lifecycle/delivery/authority/notification tests, cancellation PostgreSQL proof, package and Web typecheck, provider-input measurement and real Codex journeys, complexity/log/doc guards, parent UX and diff review.

## Progress

- Cancellation reservation, drain, bootstrap, exact-audience dispatch and instruction builder implemented. Tool schema/text and full provider-input comparison added.
- Focused lifecycle, bootstrap, authority, tools and instruction tests pass. Web and package typechecks passed before adding PR-2-dependent fixtures; rerun after rebase.
- Full provider input: individual 155921 -> 155921 bytes; group 144355 -> 143888 bytes (-467, -0.3235%). Exact GPT-6.1 Sol tokenizer unavailable; no token estimate claimed.
- Real Codex cancellation passed through local subscription: exactly one queued intent, truthful short reply, no other capability calls. Default and first alternate homes failed before model action with routing 401; second alternate worked. Live wording assertion corrected to accept a semantically valid negation.
- Real Codex live-stake refusal and 75-day challenge read also pass through production tools, with no mutation calls. Transactional tests await the PR 2 rules base. PR 2 merge and runtime-floor convergence still block landing.

- Requested Astra deep review found two concrete issues, both accepted: bootstrap publication now persists queued proposal metadata before provider work, and cancellation copy describes only the earlier request without assertions about current pending requests or whether play started. Bootstrap failure regression passes for both new and existing route-less workspaces (28 bootstrap tests total). Revised real-Codex cancellation journey passes. Transaction rollback fixture added; PostgreSQL execution still awaits PR 2. Refreshed Web typecheck and complexity/log/doc guards pass.

- Integrated merged PR 2 (`1a822eb0d486383d93f13c761ea2d24c4b8402b8`) and applied its migration on an isolated local database. All 68 PostgreSQL game tests pass, including 13 cancellation eligibility/replay/rollback scenarios. All 301 non-PostgreSQL Web game tests and refreshed Web typecheck pass.
