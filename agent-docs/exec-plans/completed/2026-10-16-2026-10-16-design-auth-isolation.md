# Keep authentication catalog previews free of live requests

Status: completed
Created: 2026-10-16
Updated: 2026-10-16

## Goal and invariant

Opening the public authentication design study must render the existing synthetic phone, email, messaging, connected-account and security previews without calling authentication APIs or loading an identity-provider SDK. Real login, credential changes, onboarding and Telegram popup behavior remain under their current owners.

## Evidence and ownership

The study mounts real auth controllers beneath `inert`. The two inline messaging editors fetch login-method and approval-passkey state on mount; Telegram proof buttons prepare provider login on mount. Browser inertness does not stop React effects. This violates the current Frontend study contract. Synthetic mount/network proof will establish the mechanism without using production content.

The dedicated task worktree owns this correction. Open PR4159 concerns fixed review-account codes; PR3134 retires legacy auth, with no proven equivalent catalog fix. The catalog row-width change is separate. No other branch is modified. The startup diagnostic PR4156 has already deployed and retains its independent observation window.

## Scope and approach

- Recompose the study from existing production presentation components with synthetic props; extract a minimal shared presentation seam only where required.
- Remove unreachable study interaction state, preserve useful previews and their layout.
- Preserve existing browser-level real-controller popup/delay proof through a suitable local test surface; do not expose a new public live-auth catalog.
- Do not alter authentication policy, server routes, provider contracts, persisted state, member flows, timeout/retry behavior or logging.
- Do not patch an unproven expired-session recovery issue based on this catalog traffic.

## Product UX

Effort: Patch. Journeys: anonymous or signed-in reviewer opening the study; real phone/email login; real messaging setup and Telegram popup. Catalog controls remain inert, and visible states remain representative. The expected outcome is no API or provider side effect from viewing a synthetic study. Product UX verdict: Ready. Composed mount, browser network, real-controller journeys and rendered phone/desktop proof passed.

## Tasks and proof

1. Use ReviewGPT to author the narrow correction and focused regression proof.
2. Run the new proof against baseline to expose requests, then against the patch to prove zero requests and preserved rendering.
3. Run affected existing controller tests, Web typecheck and meaningful browser popup/delay/render proof at phone and desktop widths; inspect safe images.
4. Parent review, complexity and docs checks; scoped commit and PR, final ReviewGPT on the pushed candidate concurrently with required CI.
5. Merge/deploy canonically under verified human authorization only after gates pass, then verify production revision/outcome read-only and reset the existing four-hour observation deadline.

## Decisions and verification

ReviewGPT authored the presentation seam, catalog composition, isolated settings fixture and migrated browser proofs. Parent inspected every changed owner: the live panel only moves its existing entry markup into the shared layout; existing state, effects, API calls, request ownership and provider behavior remain intact. The fixture fails closed before dynamic imports outside development smoke mode or a loopback Host. No new monitoring infrastructure or production mutation used during diagnosis. No public changelog planned: reviewer catalog isolation is internal tooling, not a member product change. Existing shared auth behavior requires regression proof, not a new owner or preview framework.


### Candidate evidence

- The actual unmocked catalog hydration regression fails at base with seven API requests; the exploratory proof also observed one external Telegram SDK load. The patched composed study makes zero API requests and zero SDK loads, preserves ten inert cards and mounts no credential editor.
- Focused Vitest: eight files, 87 tests passed. New fixture coverage rejects production (even with smoke and loopback), ordinary development, non-loopback and missing-Host requests; all three loopback forms render the real settings presentation.
- Browser: two real onboarding/popup tests, fourteen adoption/settings/confirmation tests, and two catalog network tests passed. The real Telegram popup is reused after a six-second preparation delay; messaging setup stays visible before settings resolve, then completes verification. Phone/email product-load recovery, cancellation/resend, recovery-key copy/download, credential add/change/remove and 390/1280px rendering remain covered.
- Parent corrected proof-only drift found during execution: synthetic Telegram preparation/SDK fixtures and the existing records Manage disclosure. The associated task-owned Frog entry is included. An exploratory overlapping Playwright invocation lost its shared server; the catalog proof was rerun serially with its own server and passed. No production change was inferred from that harness error.
- Web typecheck, complexity, docs drift/gardening and diff whitespace checks passed. Complexity: live panel maximum 20 to 19, catalog maximum 2 to 3, pure layout maximum 5; no changed-source hotspots above 20.
- Native-resolution screenshots inspected for phone, email, messaging and recovery presentation. The existing production catalog anchor remains reachable and already represents these unchanged visible states; locally inspected candidate images and the network tests establish the implementation-specific claim. Image publication was unavailable with the installed GitHub CLI 2.96; the documented attachment route requires 2.99+.
- Final ReviewGPT PASS with zero findings on pushed candidate `9ec80f61e75b5fbb9e7f8630c6adbd9e992c0a1f`: https://chatgpt.com/c/6ad25cda-c884-83e9-8851-87dccee1e06b. Full sensitive snapshot, verified GPT-6 Pro, accepted-turn linkage and exact response-file SHA-256 match; canonical 180-second minimum enforced. The reviewer inspected source and proof but did not rerun dependency-requiring checks.
- The read-only production baseline independently reproduced eight attempted authentication/provider requests at both widths (seven APIs plus one SDK). Interception blocked all API/provider calls and three attempted POSTs; no production auth mutation occurred. The test route is already 404 before the new deployment.
- Parent final review: Ready; no accepted findings remain, and the only closeout edits are this explanatory plan and its archival. Required exact-head CI remains a merge gate; canonical Web admission and read-only production outcome proof follow authorized merge. No Worker or runner rollout is required.
Completed: 2026-10-16
