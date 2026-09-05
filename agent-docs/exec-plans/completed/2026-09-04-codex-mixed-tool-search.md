# Restore schema discovery for deferred Murph tools

Status: completed
Created: 2026-09-04
Updated: 2026-09-04

## Goal

- Restore first-attempt schema discovery for deferred Murph tools so a private
  health conversation can read a canonical condition and save a recurring
  rehabilitation reminder with the exact condition reference.
- Run the three hosted product models in Codex mixed Code Mode while retaining
  Murph's existing deferred-loading policy for broad or infrequently used
  dynamic tools.

## Success criteria

- The image-owned and hosted-local Codex catalogs set `tool_mode` to
  `code_mode` for exactly `gpt-5.6-sol`, `gpt-5.6-terra`, and
  `gpt-5.6-luna`.
- Catalog generation fails closed when any required product model is absent and
  preserves each model's unrelated metadata while adding Flex idempotently.
- The automation dynamic tool remains deferred.
- A deterministic exact-Terra App Server test proves the first provider request
  exposes native `tool_search`, the search result contains the complete nested
  `contextReferences` object schema, and one valid reminder save follows a
  canonical condition read without a rejected automation call.
- A focused real-Codex journey with the same model reads one synthetic
  condition, discovers the deferred automation schema, saves exactly one
  reminder with `{ entityKind, entityId }`, and emits a truthful completion.
- Focused tests, typecheck, repository verification, and required PR gates pass.

## Scope

- In scope:
  - The Cloudflare hosted-runner model catalog.
  - The hosted-local catalog used to reproduce production model behavior.
  - Deterministic App Server contract coverage and one focused real-model
    behavior test.
  - Durable operator documentation for the model-mode invariant and rollout.
- Out of scope:
  - Making all Murph tools eager or injecting every deferred schema up front.
  - Changing the automation input contract, validation, or retry allowance.
  - Changing non-product Codex models or Codex CLI source.
  - Deploying the runner image from this task.

## Constraints

- Technical constraints:
  - Keep `MURPH_AUTOMATION_TOOL.deferLoading` and other existing deferral
    decisions unchanged.
  - Use Codex's native mixed-mode `tool_search`; do not add a parallel Murph
    schema-search mechanism or prompt-only workaround.
  - Keep the image catalog restricted to the three authorized product models and
    preserve Flex support.
- Product/process constraints:
  - This is a Patch: restore an already-promised reminder workflow without
    widening product scope.
  - The member must get one created reminder, never a failed mutation followed
    by a guessed retry or duplicate.
  - Production rollout requires normal container replacement because the
    catalog is image-owned.

## Product UX Patch

- Outcome: a private member who asks for a recurring rehabilitation reminder
  tied to a canonical condition gets one created reminder without a rejected
  mutation or guessed record shape.
- Reach: the existing private condition-read to reminder-save flow on Sol,
  Terra, and Luna. The change does not add an audience, consent boundary, or
  new member-facing surface.
- Proof: the deterministic exact-Terra sequence covers canonical condition
  read, native schema search, and one accepted save. The matching real-model
  walkthrough is Ready using an isolated subscription-authenticated Codex home.
- Failure behavior: the model can discover the authoritative schema before it
  mutates. Existing scheduler, delivery, and retry behavior is unchanged.

## Risks and mitigations

1. Risk: Mixed mode accidentally makes every deferred tool eager and increases
   prompt size.
   Mitigation: Assert the automation schema is absent initially, native
   `tool_search` is present, and the schema appears only in its search result.
2. Risk: Catalog patching drops model metadata, Flex support, or a product
   model.
   Mitigation: Exercise the real jq transformation and validate exact slugs,
   idempotent Flex insertion, `tool_mode`, and preserved metadata.
3. Risk: Hosted-local behavior diverges from the production image.
   Mitigation: Apply and test the same three-model mixed-mode invariant in both
   catalog owners.
4. Risk: A protocol-only test passes while Terra still guesses the reminder
   reference in practice.
   Mitigation: Run one focused real-Codex journey and assert its observed
   command/tool sequence and accepted request.

## Tasks

1. Patch and validate the Cloudflare hosted-runner catalog transformation.
2. Apply the same product-model invariant to hosted-local catalog preparation.
3. Update the scripted exact-model journey to cover condition read, native
   schema search, complete nested schema, and one reminder save.
4. Add the focused real-Terra journey using synthetic private-health fixtures.
5. Update durable runtime/deploy documentation.
6. Run focused tests, the real journey, typecheck, and repository verification.
7. Inspect the final diff for privacy and scope, commit the exact allowlist,
   push, open the PR, and complete required CI/review gates.

## Decisions

- The root cause is the catalog's `code_mode_only` override inherited from the
  bundled Codex entries: it supplies deferred tools through the `exec`
  `ALL_TOOLS` contract but does not expose native `tool_search`. Murph will
  override only the three product entries to mixed `code_mode`.
- Existing defer-loading flags remain the owner of which schemas load lazily.
- No automation-schema copy is added to the base prompt because native search
  should return the authoritative dynamic-tool schema.
- GPT-5.6 uses Codex's Responses Lite transport, where native `tool_search` is
  represented in the request's `additional_tools` input item rather than the
  ordinary top-level `tools` array. Regression diagnostics inspect both
  representations so they assert the model-visible surface instead of a
  transport-specific field.
- Mixed mode exposes small non-deferred tools such as the narrow shared-group
  reader directly while broad group-family and automation tools remain lazy.
- Controlled first-request measurements use the same scripted Terra fixtures
  in `code_mode_only` and `code_mode`, normalize only random temporary-root
  suffixes, serialize the complete provider-visible request, and tokenize it
  with `o200k_harmony`. For the individual reminder path, mixed mode is 72,386
  bytes / 16,963 tokens versus 66,622 / 15,638 (+5,764 bytes, +1,325 tokens).
  For the narrow group-read path, it is 77,657 / 18,377 versus 69,048 / 16,416
  (+8,609 bytes, +1,961 tokens). The individual delta is native search; the
  larger group delta also includes the small eager group-read function schema.
- Murph intentionally excludes raw provider response items from its persisted
  parent event stream. The live proof therefore uses a test-created isolated
  Codex home and reads only its single rollout to assert the search call, schema
  result, and action ordering without weakening that privacy boundary.
- Exact Terra refers to the foreground turn. The saved fixed reminder retains
  the existing policy choice of an explicit Luna or Terra execution override;
  both are valid depending on whether future condition context needs judgment.

## Verification

- Commands to run:
  - Focused Cloudflare image-contract test.
  - Focused hosted-local catalog-preparation test.
  - Focused scripted App Server exact-model regression.
  - `pnpm test:assistant:live -- --test "<unique mixed-mode reminder test>"`.
  - Relevant package typechecks and repository complexity verification.
  - PR CI and ReviewGPT if the workflow classifier requires it.
- Expected outcomes:
  - All deterministic checks pass.
  - The live Terra run makes a condition read, searches for automation, makes
    exactly one accepted save with the exact reference shape, and gives a
    member-facing saved-reminder reply.

## Verification record

- Passed all affected package typechecks:
  `@murphai/assistant-engine`, `@murphai/hosted-local-harness`, and
  `@murphai/cloudflare-runner`.
- Passed the complete Cloudflare container image contract suite: 11 tests.
- Passed the complete hosted-local stack suite: 76 tests.
- Passed the focused exact-Terra schema-search journey and neighboring eager
  group-read regression after updating the latter's mixed-mode expectation.
- Passed a five-test sequence spanning the exact regression, eager group read,
  and the previously queue-poisoning failure boundary after resetting unused
  scripted responses between cases.
- Passed the complete scripted Codex App Server suite after that isolation
  change: 111 tests.
- Passed `pnpm complexity:diff`; the existing hosted-local stack hotspot is
  unchanged and the new catalog helper remains below the threshold.
- The alternate subscription profile completed the prescribed real-Terra
  journey. Its isolated rollout proves one canonical condition read, one native
  tool search returning the complete nested context-reference schema, then one
  accepted reminder save and a truthful 9:00 AM rehabilitation confirmation.
- Added the public-safe `health-reminders-keep-the-right-context` changelog item
  for PR #2810. Its nine focused archive tests and the Web typecheck pass.
- ReviewGPT passed the initial production head and the first remediation head
  with no findings. Its independent third-round retrospective request was
  satisfied in the PR description, after which that exact head passed with no
  findings. The final delta changes only the regression harness and is exempt
  from another substantive round under the repository review policy.
- The Linux regression initially failed before Codex started because nested
  bubblewrap could not configure loopback on the hosted runner. The test now
  uses the repository's established unrestricted scripted-exec lane; the
  production runtime remains sandboxed and unchanged.
- The resulting exact PR-head CI run no longer reports the new Terra regression.
  Its remaining red checks are independently attributable to current-main or
  external failures: two assistant assertions fail identically on current
  `main`, one unrelated outbox assertion passes in the focused local rerun, and
  the Frog repository-tool assertion received a GitHub Markdown API 403. The
  focused rerun of all three assistant assertions plus the new Terra regression
  passes four of four.
- A clean exact-head retry cleared the external Frog failure and the transient
  outbox assertion. The two deterministic current-main failures were stale test
  expectations from the merged Goals routing copy change, with no production
  mismatch and no open repair. This branch synchronizes those three prompt-plan
  digests and the renamed signup-link marker as a test-only merge unblock.
Completed: 2026-09-04
