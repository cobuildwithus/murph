# Vercel build memory headroom

Status: completed
Created: 2026-09-15
Updated: 2026-09-15

## Outcome and protected behavior

Reduce measured build memory while retaining full source and generated-route
checks, all static output, migration ordering, and managed deployment admission.
Resource policy stays in the existing Vercel entrypoint and production Next
runner. No application state, runtime protocol, or dependency changes.

## Diagnosis and existing recovery

The failed Standard build exited 137 during the initial native TypeScript
source check, before Next compilation. Vercel reported a container OOM.
PR #3490 already limits that check to one checker. Two subsequent managed
builds reached Ready with that setting and generated all 758 pages; the
production domain was verified to point to the first corrected deployment.

The corrected candidate's Linux CI observation still peaked at 7.26 GB during
the later Next build, against the advisory 7.20 GB budget. Local process-tree
inspection identified separate Go-based esbuild services under the Next parent
and compiler worker, each retaining substantial memory alongside V8.

## Selected change

Set the native Go soft memory target to 1 GiB only on the final Next compilation
command. The runner reports the target alongside its existing memory policy.
Keep the 1 GiB Next parent, 3 GiB Webpack worker, and 6 GiB compatibility-check
V8 budgets. The initial TypeScript 7 source check remains outside this target.

The existing executable fixture supplies an inherited 8 GiB Go target and
proves that route generation and compatibility checking retain it, while Next
compilation receives 1 GiB. Failed checking still prevents compilation; cache
transition, build failure propagation, and epoch publication remain covered.

## Resource comparisons

All comparisons used the same checkout and dependency versions. TypeScript
source runs disabled incremental reuse. Next compilation retained disabled
Webpack caching and generated all 758 pages on every successful run. Other host
activity varied substantially, so timings do not establish a speedup.

| Native source check, one checker | Maximum RSS across two cold runs | Median seconds |
| --- | ---: | ---: |
| Existing Go defaults | 5677.6 MiB | 38.120 |
| Global Go target 4 GiB | 5008.4 MiB | 93.166 |
| Global Go target 5 GiB | 5127.7 MiB | 91.727 |

Neither global target was retained. The much smaller esbuild target must not
be applied to the full package build, which also invokes native TypeScript.

| Next experiment | Sampled summed process RSS peak |
| --- | ---: |
| Existing 3 GiB worker | 7078.1 MiB |
| 2.5 GiB V8 worker | 7025.6 MiB |
| Two-thread native pool | 7026.2 MiB |
| Next/esbuild Go target 1 GiB, initial probe | 6763.9 MiB |
| Final runner with compilation-only Go target | 6483.3 MiB |

The V8 and thread-pool changes were rejected and reverted: each changed the
observed total peak by less than one percent. The two esbuild-target runs
reduced it by approximately 4.4 to 8.4 percent. Sampling used three-second
process-tree RSS sums. These sums can double-count shared pages, omit peaks
between samples, and are not equivalent to Linux cgroup accounting or Vercel
container measurements. The Go target is soft and is not a hard RSS limit.

## Verification and review

- Complete production Next runner builds passed with the selected target,
  including generated-route TypeScript checking and all 758 static pages.
- Three focused Web runner/migration-contract tests and 17 compiler/benchmark
  tests passed. Unrelated migration cases were deliberately not selected.
- Post-build cleanup passed; catalog tracing checked 378 files, asset tracing
  checked 21 OG/share-card traces and the contact-card trace, and six emitted OG
  routes rendered from a relocated function directory without the checkout.
- Full source typecheck passed with one checker and incremental reuse disabled.
  Documentation drift and gardening checks passed, with zero gardening issues.
- Shell syntax, whitespace, and complexity checks passed. No authored JS/TS
  production source or new complexity hotspot was introduced.
- Parent reviewed the scoped environment, inherited options, check ordering,
  failure behavior, cache compatibility, privacy, and remaining evidence gaps.
- Reused the existing initial-Web-typecheck friction report from PR #3490;
  no duplicate Frog entry was created.

## Delivery boundary

The original incident correction is already live. This additional setting is
prepared for a scoped local commit; it has not been deployed. Exact-head CI,
final review, and a Standard-machine build remain release gates for the new
setting. No production configuration, secret, alias, migration, or paid machine
setting was changed during this investigation. Internal build infrastructure
only; no member-facing changelog or rendered UX change applies.
Completed: 2026-09-15
