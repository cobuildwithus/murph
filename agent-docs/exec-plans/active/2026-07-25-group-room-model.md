# Land group room-model consolidation

Status: active
Created: 2026-07-25
Updated: 2026-07-25

## Goal

- Land PR #950 as the smallest reliable group-local room-model feature: one
  bounded derived knowledge page that silent managed maintenance refreshes from
  committed group transcript evidence and ordinary group turns use only as
  fallible, optional context.

## Success criteria

- The candidate applies cleanly to current `origin/main` without the temporary
  staging workflow or encoded patch artifact.
- Only immutable Murph-owned automation identities can enter silent
  maintenance, and due group-room maintenance remains preemptible,
  non-delivering, replay-safe, and exact-skip compatible.
- Transcript evidence preserves group sender, reply, reaction, and response
  structure within explicit bounds.
- The derived page is group-local, bounded, fully rewritten, and never treated
  as canonical participant identity or authoritative truth.
- Explicit room-model correction/forget requests can update the page through
  the ordinary current turn without giving reactions or user-authored
  automation metadata maintenance authority.
- Focused package verification and full acceptance pass.
- The product-experience review, preliminary prompt/coverage ReviewGPT pass,
  parent final review, final ReviewGPT gate, and final-head CI have no
  unresolved accepted findings.
- The active plan and ledger row are closed, PR #950 contains only the clean
  feature history, and the final PR is conflict-free and merged.

## Scope

- In scope:
  - `packages/assistant-engine` managed automation, cron execution,
    maintenance evidence, notification planning, prompt context, a
    route-gated room-model dynamic tool, service contracts, group skill
    guidance, and focused tests.
  - Durable architecture, security, reliability, index, and testing claims
    required to describe, deploy, and verify the changed boundary.
  - The stale CLI release-audit expectation that still asserted the previous
    ReviewGPT invalidity contract and blocked the canonical acceptance lane.
  - PR #950 metadata, ReviewGPT rounds, CI remediation, merge, and worktree
    retirement.
- Out of scope:
  - Databases, mailbox replicas, queues, cursors, embeddings, roster services,
    participant pages, or cross-group knowledge.
  - New user-visible scheduled messages, reaction-triggered writes, or broad
    group identity/roster authority.
  - Unrelated assistant prompt, hosted runtime, web, or Cloudflare changes.

## Constraints

- Technical constraints:
  - Reuse existing managed-automation, cron occurrence, committed transcript,
    maintenance write, preemption, replay-barrier, and derived knowledge owners.
  - Keep the page under the existing `derived/knowledge/**` materialization
    boundary and preserve canonical/runtime state placement rules.
  - Keep every maintenance privilege rooted in immutable code-owned automation
    identity, never mutable slug, title, instruction, or tag fields.
  - Preserve foreground priority and ensure silent maintenance cannot enqueue
    delivery.
- Product/process constraints:
  - Current conversation, safety, live tools, and explicit room settings outrank
    advisory room-model tips.
  - Most turns should use no tip; at most one naturally relevant tip may shape
    a response, and callbacks must never be forced.
  - Preserve private-by-default group boundaries and keep raw handles confined
    to the room-local derived page.
  - Follow the exact pushed-head preliminary and final ReviewGPT workflows;
    run final ReviewGPT concurrently with CI.

## Risks and mitigations

1. Risk: A user-created automation imitates the room-model metadata and gains
   silent write authority.
   Mitigation: Match only immutable code-owned automation ids and cover spoofed
   slugs/tags/instructions with negative tests.
2. Risk: Maintenance delays or emits on the foreground reply path.
   Mitigation: Reuse preemption and exact-skip primitives, mark the occurrence
   non-delivering, and cover fresh-input interruption plus replay behavior.
3. Risk: Derived tips become stale authority, identity truth, or repetitive
   callback pressure.
   Mitigation: Bound and label the prompt context as fallible optional advice,
   preserve stronger current-context precedence, and run product/prompt review.
4. Risk: Replacing the staging PR head loses relevant upstream changes.
   Mitigation: start from the exact current `origin/main`, apply the candidate
   as behavioral intent, inspect every conflict and final diff, and force-push
   only the named staging branch with lease protection.
5. Risk: A spoofable group-email reply influences durable room context.
   Mitigation: expose same-turn room-model reads/writes only through a dynamic
   tool admitted for current accepted input on authenticated non-direct Linq or
   Telegram routes, and exclude email sessions from periodic evidence.
6. Risk: Scheduled consolidation writes an oversized page whose prompt
   rendering omits later correction or avoidance guidance.
   Mitigation: enforce one 8 KiB UTF-8 limit at the canonical knowledge write
   boundary for both full rewrites and append attempts, rejecting before the
   prior page changes.
7. Risk: Rolling back the runner after it persists the new immutable automation
   id causes an old bundle to treat silent maintenance as ordinary delivery.
   Mitigation: require immediate runner rollout and exact-fingerprint smoke,
   then hold that bundle as the rollback floor and forward-fix.
8. Risk: Corrupt fixed-slug state is mistaken for absence, or newer ineligible
   sessions consume the group evidence cap.
   Mitigation: keep ordinary reads fail-open but make mutation reads and writes
   conflict-safe, and select 24 eligible group sessions from a bounded
   192-session recent scan.

## Tasks

1. Inspect the candidate, staging PR, active overlaps, and current owners.
2. Apply and reconcile the candidate on current `origin/main`.
3. Run focused canonical verification and direct static/runtime proof; fix
   failures at the owning boundary.
4. Run the local product-experience review and resolve accepted findings,
   including authenticated-chat-only room-model mutation authority.
5. Commit/push the candidate and update the full PR intent contract.
6. Run the preliminary `completion-specialists` prompt/coverage pass, triage it,
   and land accepted corrections.
7. Run parent final review plus final canonical verification.
8. Close this plan through `scripts/finish-task`, push the exact final head, and
   start final ReviewGPT round 1 concurrently with CI.
9. Iterate only on reproduced accepted findings until ReviewGPT passes and CI
   is green; prove mergeability, merge PR #950, and retire the worktree.

## Decisions

- Use one derived group page rather than participant pages or a new product-state
  owner.
- Treat the supplied patch as intent and rebuild the PR branch from current
  `origin/main`; the existing PR commits are temporary staging artifacts only.
- Run both prompt and coverage preliminary lenses. Frontend is not applicable.
- Use the final ReviewGPT gate, not local `deep-review`.

## Verification

- Commands to run:
  - `git diff --check`
  - `pnpm test:diff packages/assistant-engine ARCHITECTURE.md agent-docs`
  - `pnpm verify:acceptance`
  - focused tests or direct proof selected from failures and changed paths
  - `scripts/review-gpt-pr-head-preflight.sh 950`
  - preliminary `pnpm review:gpt completion-specialists ...`
  - final `pnpm review:gpt pr-review ...`
  - final-head GitHub required checks and mergeability inspection
- Expected outcomes:
  - All commands pass on the exact pushed candidate/final heads.
  - Preliminary and final reviews contain the required completion markers and
    zero unresolved accepted findings.
  - PR #950 is green, conflict-free, merged, and its task worktree retires
    cleanly.
