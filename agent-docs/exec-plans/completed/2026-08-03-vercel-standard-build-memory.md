# Make Vercel Standard builds reliable

Status: completed
Created: 2026-08-03
Updated: 2026-08-04

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
- Next 16.2.6 accepts `turbopackMemoryLimit` at the JavaScript/native boundary
  but discards `_memory_limit` when constructing the native backend. The option
  is not an enforced governor and must be removed from config and claims.
- Next applies `experimental.cpus` to later build workers. Its isolated static
  workers remove `--max-old-space-size`; the parent and non-isolated TypeScript
  worker do not, so they require a shared phase-aware invocation.
- A 2 GiB parent-old-space candidate passed one forced-cold Standard preview,
  then an identical forced-cold build was killed during `next build` with exit
  137 and Vercel's OOM marker. The 2 GiB bound is therefore rejected as
  insufficient rather than accepted from a single success.
- Global 1 GiB and 1.5 GiB follow-ups completed Turbopack compilation locally,
  then exhausted V8 old space during Next's generated-contract TypeScript
  validation. A 1 GiB parent / 2 GiB TypeScript-worker split failed at the same
  boundary; a 1 GiB / 3 GiB split completed the full local build. Next 16.2.6
  derives the non-isolated worker limit from `NODE_OPTIONS` but honors the
  direct CLI flag in the parent, while isolated static workers remove the flag.
- The first forced-cold Standard preview using that phase-aware split still hit
  the container OOM boundary during Turbopack compilation, so the split alone
  is necessary but insufficient.
- `/design` made its top-level catalog component a Client Component only to
  read and replace the `tab` query parameter. That boundary pulled every design
  study, and their server-only transitive imports, into one browser compilation
  graph. Moving query parsing to the page Server Component and rendering tab
  navigation as links removes that graph-wide client boundary. The few shared
  client modules exposed by a diagnostic Webpack build now import through
  client-safe public entrypoints instead of server-heavy barrels, and only the
  four synthetic studies that pass callback props declare local client
  boundaries.
- After that boundary correction, a cold local production Turbopack build with
  the same 1 GiB parent / 3 GiB TypeScript-worker policy compiled in 57 seconds
  instead of roughly 4.4 minutes and completed all 229 static pages. Repeated
  exact-head Standard previews remain the acceptance proof.
- The next exact-head Standard preview still OOM-killed Turbopack during
  compilation. The catalog correction is retained as a proven graph and
  server/client-boundary fix, but it is rejected as sufficient capacity proof.
- Next's documented Webpack fallback completed the same application locally
  with `webpackBuildWorker` and `webpackMemoryOptimizations` enabled. The worker
  is explicit because the Workflow integration contributes custom Webpack
  configuration, which otherwise disables Next's automatic worker selection.
- That stricter build exposed one browser-vault parser re-export through a
  server-heavy cursor module plus invalid Next route exports and optional route
  props. Moving the parser to its browser-vault owner, keeping the cursor as the
  legacy-facing re-export, and making route entry modules conform to Next 16
  preserved validation instead of suppressing it. The complete Webpack build
  then passed locally in the same 1 GiB / 3 GiB heap policy with all 229 pages.
- Three consecutive forced-cold previews of the production-code candidate
  completed on Vercel's 4-core, 8-GB Standard builder. Webpack compilation took
  2.8, 2.6, and 2.5 minutes; generated-route TypeScript validation took 59, 53,
  and 58 seconds; each build generated all 229 static pages without an OOM.
- After merging the current base branch, an integration preview completed on
  the same Standard builder in 2.8 minutes of compilation and 56 seconds of
  generated-route TypeScript validation, generating all 233 static pages.
  The final corrected head completed again in 2.6 minutes and 56 seconds with
  all 233 pages, proving the post-merge client boundary correction on the
  target machine class.
- Focused exact-head browser proof loaded `/design?tab=sections` successfully
  and passed all five selected chart, onboarding, and responsive ownership
  checks. Focused catalog tests, Web typechecking, and scoped linting also
  passed.
- Final ReviewGPT round 3 passed after inspecting the exact corrected head,
  responsive catalog evidence, and the required change-shape retrospective.
- Every required exact-head CI check passed. The assistant coverage shard's
  first run had one unrelated 60-second warm-process test timeout followed by
  busy-process cascades; the exact test passed locally with and without
  coverage instrumentation, and the failed CI shard passed on rerun.

## Architecture decision gate

1. Confirm the parent-heap hypothesis with Next source, local profiling, and a
   controlled Standard preview; reject it if the build still OOMs or merely
   trades the kernel kill for a V8 heap failure.
2. Prefer one explicit build-command resource bound over another state owner,
   dependency, or deployment service.
3. The bound was insufficient; compile-graph profiling identified and removed
   an accidental catalog-wide client boundary without changing product data
   ownership or adding another runtime mechanism.
4. Turbopack still exceeded the Standard container after that correction, so
   use Next's supported Webpack build worker and memory optimization path for
   production builds while retaining Turbopack for local development.

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
Completed: 2026-08-04
