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

## Findings and decisions

- Native AMD64 runner reproduction: Actions run `43003171519`, commit `ebc1731378a5`, pinned Codex 0.166.0. `read_game` returned the materialized manifest; the shell exited 1 before executing `cat` with `bwrap: Can't chdir to /tmp/mv/r-QY5WtH: No such file or directory`.
- Exact synthetic command: `cat .runtime/tmp/recap/745d12188d17e92e80decb204ae2d72d/inputs/writing-guide.md .runtime/tmp/recap/745d12188d17e92e80decb204ae2d72d/inputs/game.json .runtime/tmp/recap/745d12188d17e92e80decb204ae2d72d/inputs/chat.jsonl`.
- Test the concrete restored vault as the recap show's cwd instead of the procfs alias. Preserve the profile's denied workspace root, read-only task inputs and writable drafts/media/previews; ordinary and plain/group turns retain their stable cwd.
- The Linux gate uses a scripted loopback model and the existing synthetic live-lane media fixture, real Codex sandbox/dynamic tools/preview/validator, and the actual outbox. It makes no paid provider calls. Local ARM emulation is not counted as Linux proof.
