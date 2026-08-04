# Make Vercel Standard builds reliable

Status: active
Created: 2026-08-03
Updated: 2026-08-03

## Outcome

- Make the hosted Web production build complete reliably on Vercel's 4-core,
  8-GB Standard builder without weakening migrations, typechecking, generated
  artifact checks, or runtime behavior.
- Prove the correction with focused local checks and repeated forced-cold
  Standard preview builds before claiming the machine class is safe.

## Protected invariants

- The Vercel production build continues to run production migrations and the
  complete hosted Web build command.
- Build-memory tuning changes only resource behavior; it does not change the
  compiled application, runtime configuration, or deployment trust boundary.
- The existing Linux cgroup memory guard remains truthful observability and is
  not treated as proof of Vercel behavior by itself.
- Production project settings are not mutated without explicit user authority.

## Evidence

- Current project metadata still selects the Standard build machine.
- Multiple production and controlled preview builds on the 4-core, 8-GB
  machine were killed during `next build` with exit 137 and Vercel's OOM
  marker; other identical builds passed, proving an intermittent capacity
  failure rather than a deterministic compile error.
- Current Next config already disables Turbopack source maps, sets two static
  workers, and gives Turbopack a 4-GiB target.
- Repository CI evidence records that reducing only the Turbopack target to
  3 GiB did not reduce the observed cold-build anonymous-memory ramp.
- Next 16.2.6 passes `turbopackMemoryLimit` to the native Turbopack project but
  applies `experimental.cpus` to later build workers. Its isolated static
  workers remove `--max-old-space-size`; the parent `next build` process does
  not, so the parent heap remains a separate candidate contributor.

## Architecture decision gate

1. Confirm the parent-heap hypothesis with Next source, local profiling, and a
   controlled Standard preview; reject it if the build still OOMs or merely
   trades the kernel kill for a V8 heap failure.
2. Prefer one explicit build-command resource bound over another state owner,
   dependency, or deployment service.
3. If the bound is insufficient, profile the compile graph before changing
   route imports or generated-data ownership.

## Tasks

1. Obtain ReviewGPT's independent diagnosis and inspect any returned patch as
   untrusted implementation intent.
2. Add the smallest supported resource-bound change plus focused regression
   proof and truthful build documentation.
3. Run focused config/script tests, hosted Web typecheck, and a local production
   build with memory evidence.
4. Commit and push the candidate, open a PR, and run repeated forced-cold
   Standard preview builds against the exact head.
5. Run the required preliminary specialist and final ReviewGPT gates alongside
   exact-head CI; resolve accepted findings and complete parent final review.
6. Close this plan with `scripts/finish-task` only after the preview evidence,
   review gates, CI, and merge-conflict proof are complete.

## Open operational question

- The project remains on Standard while this work proceeds. Returning the
  production project to Enhanced is a separate reversible incident mitigation
  that requires explicit user authority.
