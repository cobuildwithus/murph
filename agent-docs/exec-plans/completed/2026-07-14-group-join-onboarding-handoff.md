Goal (incl. success criteria):
- Keep a new member's group invite as the primary journey through authentication, explicit sharing consent, and membership acceptance.
- Automatically open the join authentication dialog for an unauthenticated visitor on a valid group link, matching the intent-driven `/connect` behavior while retaining the visible page CTA as a recovery action.
- After a successful join, route a new accessible member through the normal initial-visit Murph handoff, an existing accessible member to home, and a member who still needs account setup to the hosted setup flow.
- Success means focused routing and component coverage, required frontend/coverage review, exact-head ReviewGPT, green required CI, and no new auth or membership authority derived from client-controlled state.

Constraints/Assumptions:
- Preserve the existing group preview, auth dialog, launch-consent gate, and explicit sharing choice before membership is created.
- Keep post-auth state presentational only. It may choose among fixed internal destinations but must never grant access, join membership, or carry an arbitrary redirect.
- Reuse the existing hosted onboarding destinations and group acceptance route; add no persisted product state, session table, or compatibility layer.
- Preserve unrelated worktrees, ledger rows, processes, and active reviews.

Key decisions:
- Return to the same group join page immediately after auth rather than detouring through generic onboarding.
- Open the auth dialog once on mount for the valid anonymous join state; closing it leaves the group preview and `Continue to join` action available without reopening automatically.
- Carry one bounded query marker through the server-rendered join page so the successful join action can choose a fixed next step.
- Use intent-first copy, `Continue to join`, because the action supports both account creation and sign-in.
- Keep the join itself explicit because the member's name is shared and optional health projections require a deliberate choice.

State:
- Local implementation and completion checks are done; ready for the scoped commit and PR gates.

Done:
- Traced the current anonymous preview, auth, launch-consent, sharing, membership, and homepage routing paths.
- Confirmed the current group flow returns to the invite after auth but discards the normal new-member `initialVisitEligible` result.
- Confirmed group membership acceptance does not derive authority from the proposed presentation marker.
- Added a bounded, presentation-only post-auth marker that selects only fixed internal destinations after the existing membership POST succeeds.
- Made the valid anonymous join page open the existing auth dialog on first render while preserving dismiss and fallback reopen behavior.
- Added direct coverage for auth return paths, marker sanitization, explicit membership-before-navigation, and new-versus-existing member destinations.
- Passed focused tests, lint, prepared typecheck, the full diff-aware web verification suite, frontend review, coverage review, and parent final review.

Now:
- Close the active plan and create the scoped task commit.

Next:
- Push the exact head, open the PR, and run ReviewGPT concurrently with required CI.

Open questions (UNCONFIRMED if needed):
- None. The approved behavior is group first, then the appropriate private Murph handoff after membership succeeds.

Working set (initial; narrow as implementation resolves ownership):
- apps/web/app/groups/join/[joinCode]/page.tsx
- apps/web/src/components/hosted-groups/group-join-client.tsx
- apps/web/src/lib/hosted-groups/group-join-handoff.ts
- apps/web/test/hosted-group-join-*.test.ts*
Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
