# Remove retired Sol model

Status: active
Created: 2026-11-03
Updated: 2026-11-03

## Outcome and invariants

Remove GPT-5.6 Sol from every selectable Murph model surface. Existing vault
automations must execute on GPT-6.1 Sol without member action; explicit writes
must reject the retired model. Preserve GPT-5.6 Luna behavior and historical
usage accounting. Keep current reasoning effort at each hard-coded caller.

## Owners and evidence

- Hosted execution owns product models and strict configuration writes/responses.
- Core owns canonical automation frontmatter reads and writes. Its existing
  override normalizer currently accepts arbitrary model strings in both paths.
- Operator config owns provider target normalization; engine resolves scheduled pins.
- Web owns preferences and allowance accounting; Postgres model columns are the
  member preference plus requested/served usage evidence. The supplied production
  aggregate reports no retired member preference, so no preference migration.
- Existing vault automation target overrides are the known persisted selection
  location. No private vault content is copied into this plan.
- Usage settlement happens in the ingestion transaction when accounting is enabled.
  Old runners and replay can ingest retired-model records after Web deployment,
  so historical pricing must remain distinct from selection/deploy allowlists.

## Product UX

Effort: product change. Settings and chat offer current models only. Existing
scheduled work continues on 6.1 Sol with explicit reasoning preserved. A new
request for 5.6 Sol fails validation. Historical usage remains visible/accounted.
Proof: catalog/write rejection tests, canonical legacy-read/roundtrip tests,
model-call assertions, mixed-version response tests, historical pricing tests,
focused real assistant journey and existing settings rendering.

## Repair billing scope decision

Meal repair runs through encrypted member-action mailbox work, with no
HostedOperatorTask authorization row. The existing operator exemption verifies
that row, member, kind, status and occurrence window. Merely trusting featureKey
would weaken the funding boundary. A separate design must bind repair admission
and each usage attempt to verified operator authority (including retry/expiry
and old-runner attribution), then reuse zero-cost allowance settlement. Per task
instruction, do not implement that larger funding change in this PR. The model
replacement remains in scope. Historical member charges are unchanged.

## Implementation and proof

1. Remove selectable constants, catalogs, descriptions and current model docs.
2. Normalize retired persisted automation pins at the canonical read boundary;
   reject writes and provider execution of the retired id.
3. Accept old Web response catalogs without exposing retired choices. Separate
   historical usage pricing from selectable model admission.
4. Update the native patch only after applicability and native build proof.
5. Run focused owner tests/typechecks, live journey, parent diff review, and
   complexity guard; open draft PR, then Ready and ReviewGPT on lane vonneumann.
6. Resolve findings, obtain exact-head CI and PASS, merge with matched head.
7. Deploy compatible Web before runner, verify both and report ids/remaining risks.

## Rollout

Web first: it still accepts usage from old runners and already supports 6.1 Sol.
Runner second: old Web catalogs containing 5.6 Sol are filtered by new readers;
strict new writes reject the retired id. Warm old runners may continue old calls
until rollout drains; completion requires runner convergence. Historical pricing
remains for delayed/replayed usage. No schema migration or new ledger.

## Verification status

Dependency install passed in a sanctioned replacement checkout on the task branch.
The supplied clean checkout was preserved after its install hook rejected missing
worktree authorization. No guard was bypassed.

- Workspace incremental build and package/Web typechecks passed.
- Focused hosted-execution, core, operator-config, engine, runtime, CLI, Web,
  Cloudflare catalog/preflight and e2e-launcher tests passed.
- Real provider journey: a stored retired-model reminder ran once on 6.1 Sol,
  preserved low reasoning, produced the intended synthetic reminder, and did not
  rewrite its source. Initial provider attempts failed before execution on
  exhausted/unauthenticated profiles; the working authorized profile passed.
- Settings rendering passed at 390 and 1280 pixels with reduced-motion states;
  parent inspected both screenshots. Product result: Ready.
- Complete first-request captures: individual 166393 bytes before/after; group
  161515 before/after. Registered tool text decreased by 13 bytes each. Exact
  target tokenizer unavailable; token counts are not claimed. Shared candidate
  public dependencies/native adapter/catalog are a measurement limitation.
- Complexity guard passed; existing hotspot debt unchanged. Source patch applies
  to pinned native 0.166.0; native build remains a required CI gate.
- ReviewGPT, exact-head CI, merge and both deployments remain pending.

Additional persisted read locations: operator default targets, hosted profiles,
and saved conversation codex targets; no production rows/content were inspected.
Queued automation envelopes share the same normalization helper as vault reads.

## Review packaging correction

The first review attempt used a packet containing SVG assets and was stopped;
it does not count as a substantive review. Shared package exclusions now remove
image extensions across nested paths. Both lean/full archive tests pass with
zero image entries. Restart round one on the updated pushed head and inspect
the exact replacement archive before staging.
