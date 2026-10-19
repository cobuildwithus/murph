# Retire the Biomarkers website feature

## Outcome and invariants

Remove `/biomarkers`, its child pages, and infrastructure that exists only to
serve those pages. Preserve Environment, canonical labs and wearable data,
assistant and CLI capabilities, records, experiments, and shared health reference
content. No data deletion, new abstraction, or replacement feature is needed.

## Ownership and evidence

The Next.js route family owns the presentation. Browser Vault owns private
query projections; Health Commons owns shared reference content and generated
web artifacts. Remove page-specific consumers before deleting unreferenced
providers. Audit remaining callers rather than deleting by biomarker naming.
Claude provides a read-only dependency audit; implementation and verification
remain in this task checkout.

## Product UX

- Outcome: Biomarkers is no longer a website destination.
- Entry: remove navigation, sitemap entries, report links, and design previews.
- People: signed-in members retain records and Environment; public visitors
  retain experiment content without links to retired biomarker pages.
- Proof: focused route/navigation/shared-consumer tests, relevant typechecks,
  and rendered navigation where available.
- Done when: no active link or generated page machinery serves the retired
  feature, and retained consumers keep working.

## Plan

1. Trace routes, components, browser queries, generated artifacts, and callers.
2. Delete exclusive code and update shared consumers and current owner docs.
3. Run focused tests and typechecks; inspect the full diff and privacy boundary.
4. Record proof and limitations, close this plan, and make a scoped local commit.

## Deployment and state

This retirement must not remove canonical records or persisted schemas. Website
routes disappear on the Web release. Shared runtime artifacts remain where
assistant, experiment, or native consumers require them. No production mutation
is part of the task.

## Progress

- Scope corrected before feature edits: Environment remains untouched.
- Removed the route family, exclusive components/charts, projections and
  generators, navigation/report links, tracing rules, telemetry rules, design
  studies, and obsolete tests/assets. Preserved agent/query/catalog owners.
- Experiment icons moved to the experiment owner. Experiment sentiment reads
  the existing compact runtime artifact; its 101 entries exactly match the
  pre-removal primary-checkout generation.
- Records retains one import/reconnect action and all saved data.
- Changelog documents the retirement and removes obsolete historical try-it
  links without rewriting historical release descriptions.
- Local proof passed: Web, Health Commons, and Cloudflare typechecks; focused
  Web routes/navigation/records/experiments/changelog tests; 219 Health Commons
  runtime/generation/validation tests; 29 shared biomarker/lab query tests.
- Records browser proof passed at 390px and 1280px, including Manage,
  disconnect cancellation, import link, privacy link, and overflow checks.
  The first attempt was interrupted by a task edit restarting Next; a stable
  rerun passed. Synthetic screenshots were inspected locally.
- Complexity guard and documentation drift checks passed. No schema, data,
  assistant tools, prompts, ingestion, or Environment implementation changed.
- Final Claude review and PR exact-head CI/ReviewGPT are pending; user requested
  a PR and green ReviewGPT. No merge or production deployment is requested.
