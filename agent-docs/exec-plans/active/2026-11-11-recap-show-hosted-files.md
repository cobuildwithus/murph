# Restore recap file access in the hosted Linux sandbox

Status: active.

Outcome: restore pair-show authoring from authorized local inputs through file media, preview and one accepted recap with one chat line/link.
Reaches: hosted recap turns only; retain read-only inputs, exact draft/media/preview write roots, denied sibling vault state and denied shell network.
Proof: a synthetic settled pair through the real pinned Linux Codex sandbox in the runner image, existing hosted-local stub provider, real runtime/tools/validator, plus focused planning tests and typechecks.

## Investigation

- Materialization awaits all input writes before returning the manifest. The hosted planner substitutes `/proc/self/cwd` while the recap profile grants relative task descendants.
- Local AMD64 Docker emulation fails before shell execution at seccomp installation; existing Frog issue #3862 owns this constraint. Native Linux CI owns the container reproduction. Do not disable the inner sandbox.
- First capture the exact synthetic command failure, then change only the proven owning boundary and complete the media/preview/acceptance proof.

## Delivery

Runner-only deployment; no Web/schema/client/env changes. Parent owns review, merge and deployment. No ReviewGPT is started by this task.
