# Use normal subscriptions for Starter image access

## Outcome and invariant

Personal Starter image requests direct members to the existing Pulse or eligible
Group subscription flow. Saving a card alone grants no image access. Ordinary
Starter text, paid plans, Family sponsorship, group allowance, SMS admission,
abuse alerts, and Growth receipt accounting keep their existing owners.

## Evidence and ownership

The existing image reader authorizes direct Starter from Stripe card attachment;
this conflicts with the requested subscription requirement. The canonical usage
gate already distinguishes Starter, active paid, Family, and thread-container
allowances, including suspension and exhaustion. Derive image permission from
that gate and remove the separate setup route, button, and Stripe setup handling.
No schema, state owner, dependency, or direct Stripe read is needed.

The clean PR worktree matched the handed-off reviewed head. Base reconciliation
preserves both added route definitions and independent assistant-test imports.

## Product UX

- Effort: Product change.
- Entry and promise: A Starter member asks for an image; the denied completion
  explains the subscription requirement and links to normal Settings checkout.
- Journeys: Starter with or without a saved card is denied; active Pulse/Group
  and existing paid/Family/group access succeed within allowance; suspended,
  inactive, or exhausted access stays denied; cancelled access falls back to
  Starter and loses image permission. No automatic checkout or image retry.
- Proof: Canonical-gate tests, image gateway HTTP/WebSocket tests, assistant
  deterministic recovery and focused real-Codex journey, existing Settings
  subscription tests, relevant typechecks, exact-head CI and final review.
- Result: Ready.

## Failure and rollout

The signed member-bound Web callback remains before image-provider spend and
fails closed on unavailable or incompatible responses. Deploy Web first, then
the Worker and assistant bundle; verify subscription denial/success before
turning on SMS admission. No backfill or migration. Merge and deploy remain
outside this task.

## Progress

- Base conflicts resolved by preserving both owners' additions.
- Removed the separate image card endpoint, UI, direct Stripe query, and
  setup-event reconciliation changes. Image permission now derives from the
  canonical usage source; recovery points to normal subscription Settings.
- Focused Web, assistant image/tool/completion, Cloudflare gateway/WebSocket,
  and shared-route tests passed. Added composed proof for Pulse/Group access
  and Starter denial with an existing billing customer. Relevant typechecks,
  docs drift, privacy scan, and complexity guard passed.
- The focused real-Codex subscription recovery journey passed on
  gpt-5.6-terra through local subscription auth: one provider turn, zero tool
  actions/media/retries, correct Pulse/eligible Group Settings recovery, and
  no false success or no-charge promise. Parent reviewed the synthetic reply
  as Ready. Initial profiles failed before provider action; the bounded
  alternate-profile path succeeded without changing production code.
- Parent reviewed the authorization boundary, unchanged normal checkout,
  current-access rechecks, signed member binding, shared transport, and merge
  resolutions. OpenAI handler complexity decreases; no existing hotspot grows.
- Implementation and focused proof are complete. PR metadata, exact-head CI,
  and round-three final review are completed through the existing PR owner;
  their live results belong on the PR. Merge and deployment remain separate.
Status: completed
Updated: 2026-09-11
Completed: 2026-09-11
