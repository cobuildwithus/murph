# Product UX workflow

## Goal

Make agents plan and verify the complete member experience for every materially
different affected user before a user-facing change reaches technical review.

## Scope

- Add one durable Product UX planning and walkthrough contract.
- Route user-facing work through that contract automatically.
- Make the existing product-experience lens judge the implementation against
  the planned member journeys.
- Replace fixed desktop/mobile screenshot quotas with evidence selected by the
  changed UX risk.
- Keep the existing design catalog and ReviewGPT passes.

## Constraints

- Add no command, service, database, state owner, or review pass.
- Scale the work from a three-line patch note to feature shaping and user
  approval.
- Use affected member journeys instead of a Cartesian persona matrix.
- Cover what each person sees, reads, understands, does, publishes, reveals,
  and receives across goals, channels, devices, data sources, roles, plans,
  history, knowledge depth, and weak states.
- Treat loading time, skeletons, empty states, partial states, stale states,
  errors, and recovery as Product UX.
- Keep private feedback out of repository files. Major feature shaping may use
  only de-identified summaries through approved read-only access.
- Preserve unrelated working-tree changes.

## Verification

- Read back every changed workflow and prompt section.
- Run focused tests for the frontend design-proof validator and PR template.
- Run syntax checks for changed Node scripts.
- Run the low-risk repo-internal diff verification lane if dependencies are
  available.
- Inspect the final base-to-head diff for conflicting old screenshot or Product
  UX rules.

## Tasks

- [x] Map current Product UX, rendered-evidence, and design-proof owners.
- [x] Add the durable Product UX contract and routing.
- [x] Align completion, review prompts, PR metadata, and evidence packaging.
- [x] Update design-proof enforcement and focused tests.
- [x] Validate the workflow against the Fable 5 review and the de-identified
  failure classes in recorded product frustrations.
- [ ] Verify, review, close the plan, and commit the scoped change.
