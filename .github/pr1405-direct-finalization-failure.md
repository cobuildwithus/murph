# PR 1405 direct finalization failed

```text
===== apply =====
Applied final Health Commons simplification.
exit: 0
===== install =====
Scope: all 30 workspace projects
Lockfile is up to date, resolution step is skipped
Progress: resolved 1, reused 0, downloaded 0, added 0
Packages: +1762
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 1762, reused 579, downloaded 0, added 0
Progress: resolved 1762, reused 1739, downloaded 0, added 8
Progress: resolved 1762, reused 1739, downloaded 0, added 403
Progress: resolved 1762, reused 1739, downloaded 0, added 596
Progress: resolved 1762, reused 1739, downloaded 0, added 836
Progress: resolved 1762, reused 1739, downloaded 0, added 1059
Progress: resolved 1762, reused 1739, downloaded 0, added 1409
Progress: resolved 1762, reused 1739, downloaded 0, added 1762, done
 WARN  Failed to create bin at /home/runner/work/murph/murph/apps/cloudflare/node_modules/.bin/murph-device-syncd. ENOENT: no such file or directory, open '/home/runner/work/murph/murph/packages/device-syncd/dist/bin.js'
 WARN  Failed to create bin at /home/runner/work/murph/murph/apps/web/node_modules/.bin/murph-device-syncd. ENOENT: no such file or directory, open '/home/runner/work/murph/murph/packages/device-syncd/dist/bin.js'
 WARN  Failed to create bin at /home/runner/work/murph/murph/packages/assistant-cli/node_modules/.bin/murph-assistantd. ENOENT: no such file or directory, open '/home/runner/work/murph/murph/packages/assistantd/dist/bin.js'
 WARN  Failed to create bin at /home/runner/work/murph/murph/packages/assistant-runtime/node_modules/.bin/murph-device-syncd. ENOENT: no such file or directory, open '/home/runner/work/murph/murph/packages/device-syncd/dist/bin.js'
 WARN  Failed to create bin at /home/runner/work/murph/murph/packages/cli/node_modules/.bin/murph-assistantd. ENOENT: no such file or directory, open '/home/runner/work/murph/murph/packages/assistantd/dist/bin.js'
 WARN  Failed to create bin at /home/runner/work/murph/murph/packages/cli/node_modules/.bin/murph-device-syncd. ENOENT: no such file or directory, open '/home/runner/work/murph/murph/packages/device-syncd/dist/bin.js'
 WARN  Failed to create bin at /home/runner/work/murph/murph/packages/hosted-execution/node_modules/.bin/murph-device-syncd. ENOENT: no such file or directory, open '/home/runner/work/murph/murph/packages/device-syncd/dist/bin.js'
 WARN  Failed to create bin at /home/runner/work/murph/murph/packages/hosted-local-harness/node_modules/.bin/murph-device-syncd. ENOENT: no such file or directory, open '/home/runner/work/murph/murph/packages/device-syncd/dist/bin.js'
 WARN  Failed to create bin at /home/runner/work/murph/murph/packages/operator-config/node_modules/.bin/murph-device-syncd. ENOENT: no such file or directory, open '/home/runner/work/murph/murph/packages/device-syncd/dist/bin.js'

devDependencies:
+ @babel/parser 7.29.3
+ @babel/types 7.29.0
+ @cobuild/repo-tools 0.1.15
+ @cobuild/review-gpt 0.5.122
+ @murphai/health-metrics 1.0.0 <- packages/health-metrics
+ @murphai/hosted-local-harness 1.0.0 <- packages/hosted-local-harness
+ @types/node 25.6.2
+ @vitest/coverage-v8 4.1.6
+ tsx 4.21.0
+ typescript 7.0.2
+ vite 8.0.12
+ vitest 4.1.6

 WARN  Failed to create bin at /home/runner/work/murph/murph/packages/hosted-execution/node_modules/.bin/murph-device-syncd. ENOENT: no such file or directory, open '/home/runner/work/murph/murph/packages/hosted-execution/node_modules/@murphai/device-syncd/dist/bin.js'
 WARN  Failed to create bin at /home/runner/work/murph/murph/packages/operator-config/node_modules/.bin/murph-device-syncd. ENOENT: no such file or directory, open '/home/runner/work/murph/murph/packages/operator-config/node_modules/@murphai/device-syncd/dist/bin.js'
 WARN  Failed to create bin at /home/runner/work/murph/murph/packages/hosted-local-harness/node_modules/.bin/murph-device-syncd. ENOENT: no such file or directory, open '/home/runner/work/murph/murph/packages/hosted-local-harness/node_modules/@murphai/device-syncd/dist/bin.js'
 WARN  Failed to create bin at /home/runner/work/murph/murph/apps/web/node_modules/.bin/murph-device-syncd. ENOENT: no such file or directory, open '/home/runner/work/murph/murph/apps/web/node_modules/@murphai/device-syncd/dist/bin.js'
. prepare$ if [ -z "${CI:-}" ] && [ -z "${VERCEL:-}" ] && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then scripts/install-git-hooks; fi
. prepare: Done
 WARN  Failed to create bin at /home/runner/work/murph/murph/packages/assistant-runtime/node_modules/.bin/murph-device-syncd. ENOENT: no such file or directory, open '/home/runner/work/murph/murph/packages/assistant-runtime/node_modules/@murphai/device-syncd/dist/bin.js'
 WARN  Failed to create bin at /home/runner/work/murph/murph/apps/cloudflare/node_modules/.bin/murph-device-syncd. ENOENT: no such file or directory, open '/home/runner/work/murph/murph/apps/cloudflare/node_modules/@murphai/device-syncd/dist/bin.js'
 WARN  Failed to create bin at /home/runner/work/murph/murph/packages/assistant-cli/node_modules/.bin/murph-assistantd. ENOENT: no such file or directory, open '/home/runner/work/murph/murph/packages/assistant-cli/node_modules/@murphai/assistantd/dist/bin.js'
 WARN  Failed to create bin at /home/runner/work/murph/murph/packages/cli/node_modules/.bin/murph-assistantd. ENOENT: no such file or directory, open '/home/runner/work/murph/murph/packages/cli/node_modules/@murphai/assistantd/dist/bin.js'
 WARN  Failed to create bin at /home/runner/work/murph/murph/packages/cli/node_modules/.bin/murph-device-syncd. ENOENT: no such file or directory, open '/home/runner/work/murph/murph/packages/cli/node_modules/@murphai/device-syncd/dist/bin.js'
╭ Warning ─────────────────────────────────────────────────────────────────────╮
│                                                                              │
│   Ignored build scripts: @nestjs/core@11.1.19, @reown/appkit@1.8.9,          │
│   @swc/core@1.15.3, better-sqlite3@12.6.2, bufferutil@4.1.0,                 │
│   cbor-extract@2.2.2, keccak@3.0.4, msw@2.14.6, protobufjs@7.6.5,            │
│   unrs-resolver@1.11.1, utf-8-validate@5.0.10, utf-8-validate@6.0.6,         │
│   workerd@1.20260507.1.                                                      │
│   Run "pnpm approve-builds" to pick which dependencies should be allowed     │
│   to run scripts.                                                            │
│                                                                              │
╰──────────────────────────────────────────────────────────────────────────────╯
Done in 10.7s using pnpm v10.33.0
exit: 0
===== build-dependencies =====
Scope: 22 of 30 workspace projects
packages/contracts build$ node ../../scripts/rm-paths.mjs dist tsconfig.build.tsbuildinfo tsconfig.scripts.tsbuildinfo && node ../../scripts/run-typescript.mjs package -b tsconfig.build.json --pretty false && node ../../scripts/run-typescript.mjs package -p tsconfig.scripts.json --pretty false
packages/runtime-state build$ node ../../scripts/rm-paths.mjs dist .tsbuildinfo && node ../../scripts/run-typescript.mjs package -b tsconfig.json
packages/gateway-core build$ node ../../scripts/rm-paths.mjs dist .tsbuildinfo && node ../../scripts/run-typescript.mjs package -b tsconfig.json
packages/health-metrics build$ node ../../scripts/rm-paths.mjs dist .tsbuildinfo && node ../../scripts/run-typescript.mjs package -b tsconfig.json --pretty false
packages/health-metrics build: [typescript] lane=package profile=default mode=checkers checkers=default builders=default
packages/runtime-state build: [typescript] lane=package profile=default mode=checkers checkers=default builders=default
packages/gateway-core build: [typescript] lane=package profile=default mode=checkers checkers=default builders=default
packages/contracts build: [typescript] lane=package profile=default mode=checkers checkers=default builders=default
packages/runtime-state build: Done
packages/messaging-ingress build$ node ../../scripts/rm-paths.mjs dist .tsbuildinfo && node ../../scripts/run-typescript.mjs package -b tsconfig.json
packages/messaging-ingress build: [typescript] lane=package profile=default mode=checkers checkers=default builders=default
packages/gateway-core build: Done
packages/exercise-library build$ node ../../scripts/rm-paths.mjs dist .tsbuildinfo && node ../../scripts/run-typescript.mjs package -b tsconfig.json --pretty false && node dist/build.js
packages/exercise-library build: [typescript] lane=package profile=default mode=checkers checkers=default builders=default
packages/health-metrics build: Done
packages/messaging-ingress build: Done
packages/exercise-library build: Done
packages/contracts build: [typescript] lane=package profile=default mode=checkers checkers=default builders=default
packages/contracts build: Done
packages/core build$ node ../../scripts/rm-paths.mjs dist tsconfig.build.tsbuildinfo && node ../../scripts/run-typescript.mjs package -b tsconfig.build.json
packages/clinical-records build$ node ../../scripts/rm-paths.mjs dist .tsbuildinfo && node ../../scripts/run-typescript.mjs package -b tsconfig.json --pretty false
packages/query build$ node ../../scripts/rm-paths.mjs dist .tsbuildinfo && node ../../scripts/run-typescript.mjs package -b tsconfig.json
packages/health-commons build$ node ../../scripts/rm-paths.mjs dist .tsbuildinfo && node ../../scripts/run-typescript.mjs package -b tsconfig.json --pretty false && node dist/build.js
packages/clinical-records build: [typescript] lane=package profile=default mode=checkers checkers=default builders=default
packages/query build: [typescript] lane=package profile=default mode=checkers checkers=default builders=default
packages/health-commons build: [typescript] lane=package profile=default mode=checkers checkers=default builders=default
packages/core build: [typescript] lane=package profile=default mode=checkers checkers=default builders=default
packages/clinical-records build: Done
packages/query build: Done
packages/core build: Done
packages/health-commons build: (node:2750) ExperimentalWarning: SQLite is an experimental feature and might change at any time
packages/health-commons build: (Use `node --trace-warnings ...` to show where the warning was created)
packages/health-commons build: Done
packages/importers build$ pnpm --dir ../.. exec tsx --tsconfig tsconfig.base.json packages/importers/scripts/safe-build.ts
packages/parsers build$ node ../../scripts/rm-paths.mjs dist .tsbuildinfo && node ../../scripts/run-typescript.mjs package -b tsconfig.json
packages/parsers build: [typescript] lane=package profile=default mode=checkers checkers=default builders=default
packages/parsers build: Done
packages/importers build: [typescript] lane=package profile=default mode=checkers checkers=default builders=default
packages/importers build: Done
packages/device-syncd build$ node ../../scripts/rm-paths.mjs dist .tsbuildinfo && node ../../scripts/run-typescript.mjs package -b tsconfig.json
packages/inboxd build$ node ../../scripts/rm-paths.mjs dist .tsbuildinfo && node ../../scripts/run-typescript.mjs package -b tsconfig.json
packages/inboxd build: [typescript] lane=package profile=default mode=checkers checkers=default builders=default
packages/device-syncd build: [typescript] lane=package profile=default mode=checkers checkers=default builders=default
packages/inboxd build: Done
packages/device-syncd build: Done
packages/hosted-execution build$ node ../../scripts/rm-paths.mjs dist .tsbuildinfo && node ../../scripts/run-typescript.mjs package -b tsconfig.json
packages/operator-config build$ node ../../scripts/rm-paths.mjs dist .tsbuildinfo && node ../../scripts/run-typescript.mjs package -b tsconfig.json
packages/operator-config build: [typescript] lane=package profile=default mode=checkers checkers=default builders=default
packages/hosted-execution build: [typescript] lane=package profile=default mode=checkers checkers=default builders=default
packages/hosted-execution build: Done
packages/operator-config build: Done
packages/vault-usecases build$ node ../../scripts/rm-paths.mjs dist .tsbuildinfo && node ../../scripts/run-typescript.mjs package -b tsconfig.json
packages/vault-usecases build: [typescript] lane=package profile=default mode=checkers checkers=default builders=default
packages/vault-usecases build: Done
packages/inbox-services build$ node ../../scripts/rm-paths.mjs dist .tsbuildinfo && node ../../scripts/run-typescript.mjs package -b tsconfig.json
packages/inbox-services build: [typescript] lane=package profile=default mode=checkers checkers=default builders=default
packages/inbox-services build: Done
packages/assistant-engine build$ node ../../scripts/rm-paths.mjs dist .tsbuildinfo && node ../../scripts/run-typescript.mjs package -b tsconfig.json && node dist/assistant/generate-cli-surface-contract.js
packages/assistant-engine build: [typescript] lane=package profile=default mode=checkers checkers=default builders=default
packages/assistant-engine build: Done
packages/assistantd build$ node ../../scripts/rm-paths.mjs dist .tsbuildinfo && node ../../scripts/run-typescript.mjs package -b tsconfig.json
packages/setup-cli build$ node ../../scripts/rm-paths.mjs dist .tsbuildinfo && node ../../scripts/run-typescript.mjs package -b tsconfig.json
packages/assistantd build: [typescript] lane=package profile=default mode=checkers checkers=default builders=default
packages/setup-cli build: [typescript] lane=package profile=default mode=checkers checkers=default builders=default
packages/assistantd build: Done
packages/setup-cli build: Done
packages/assistant-cli build$ node ../../scripts/rm-paths.mjs dist .tsbuildinfo && node ../../scripts/run-typescript.mjs package -b tsconfig.json
packages/assistant-cli build: [typescript] lane=package profile=default mode=checkers checkers=default builders=default
packages/assistant-cli build: Done
exit: 0
===== generate-health-commons =====

> @murphai/health-commons@1.0.0 generate /home/runner/work/murph/murph/packages/health-commons
> pnpm --dir ../.. exec tsx --tsconfig packages/health-commons/tsconfig.json packages/health-commons/src/build.ts

(node:3330) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
exit: 0
===== generate-cli =====

> @murphai/murph@1.3.0 gen:config-schema /home/runner/work/murph/murph/packages/cli
> tsx ./scripts/generate-incur-config-schema.ts

config.schema.json
src/incur.generated.ts
src/vault-cli-skill-hash.generated.ts
exit: 0
===== verify-health-commons =====

> @murphai/health-commons@1.0.0 verify /home/runner/work/murph/murph/packages/health-commons
> pnpm typecheck && pnpm test && pnpm generate:check


> @murphai/health-commons@1.0.0 typecheck /home/runner/work/murph/murph/packages/health-commons
> pnpm generate && node ../../scripts/run-typescript.mjs package -p tsconfig.typecheck.json --pretty false


> @murphai/health-commons@1.0.0 generate /home/runner/work/murph/murph/packages/health-commons
> pnpm --dir ../.. exec tsx --tsconfig packages/health-commons/tsconfig.json packages/health-commons/src/build.ts

(node:3587) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
[typescript] lane=package profile=default mode=checkers checkers=default builders=default

> @murphai/health-commons@1.0.0 test /home/runner/work/murph/murph/packages/health-commons
> pnpm test:vitest


> @murphai/health-commons@1.0.0 test:vitest /home/runner/work/murph/murph/packages/health-commons
> pnpm generate && pnpm --dir ../.. exec vitest run --config packages/health-commons/vitest.config.ts --no-coverage


> @murphai/health-commons@1.0.0 generate /home/runner/work/murph/murph/packages/health-commons
> pnpm --dir ../.. exec tsx --tsconfig packages/health-commons/tsconfig.json packages/health-commons/src/build.ts

(node:3710) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)

[1m[30m[46m RUN [49m[39m[22m [36mv4.1.6 [39m[90m/home/runner/work/murph/murph/packages/health-commons[39m

 [32m✓[39m [30m[42m health-commons [49m[39m test/runtime.test.ts [2m([22m[2m28 tests[22m[2m)[22m[33m 4862[2mms[22m[39m
     [33m[2m✓[22m[39m does not publish any explicit draft, deprecated, or hidden protocol route or bundle [33m 4578[2mms[22m[39m
 [32m✓[39m [30m[42m health-commons [49m[39m test/catalog-coverage.test.ts [2m([22m[2m12 tests[22m[2m)[22m[32m 39[2mms[22m[39m
 [32m✓[39m [30m[42m health-commons [49m[39m test/requested-biomarker-content.test.ts [2m([22m[2m9 tests[22m[2m)[22m[33m 2856[2mms[22m[39m
 [32m✓[39m [30m[42m health-commons [49m[39m test/build-determinism.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 51[2mms[22m[39m
 [32m✓[39m [30m[42m health-commons [49m[39m test/catalog.experiment-onboarding.test.ts [2m([22m[2m8 tests[22m[2m)[22m[33m 4557[2mms[22m[39m
     [33m[2m✓[22m[39m keeps psyllium lab defaults out of daily LDL-C run-in windows [33m 4546[2mms[22m[39m
 [32m✓[39m [30m[42m health-commons [49m[39m test/catalog.test.ts [2m([22m[2m1 test[22m[2m)[22m[33m 4540[2mms[22m[39m
     [33m[2m✓[22m[39m builds a deterministic catalog with protocol revisions and artifact manifests [33m 4538[2mms[22m[39m
 [31m❯[39m [30m[42m health-commons [49m[39m test/knowledge-index-full-catalog.test.ts [2m([22m[2m38 tests[22m[2m | [22m[31m1 failed[39m[2m)[22m[33m 342[2mms[22m[39m
[31m     [31m×[31m answers a normal sauna question without requiring an exact catalog title[39m[32m 13[2mms[22m[39m
     [32m✓[39m returns a safety-only hard stop for sauna and fentanyl patches[32m 5[2mms[22m[39m
     [32m✓[39m keeps caffeine pregnancy safety separate from unrelated safety[32m 4[2mms[22m[39m
     [32m✓[39m returns the core dry-sauna systematic review[32m 8[2mms[22m[39m
     [32m✓[39m does not substitute nearby topics for unsupported queries[32m 12[2mms[22m[39m
     [32m✓[39m preserves the qualifier for Daily Vitamin D3 Supplementation[32m 5[2mms[22m[39m
     [32m✓[39m preserves the qualifier for Walking After Every Meal[32m 7[2mms[22m[39m
     [32m✓[39m preserves the qualifier for Omega-3 Supplementation[32m 8[2mms[22m[39m
     [32m✓[39m does not route vitamin C through a compound collagen alias[32m 3[2mms[22m[39m
     [32m✓[39m does not substitute a child protocol for the family alias UC-II[32m 3[2mms[22m[39m
     [32m✓[39m does not substitute a child protocol for the family alias native type-II collagen[32m 3[2mms[22m[39m
     [32m✓[39m does not substitute a child protocol for the family alias gelatin plus vitamin C[32m 3[2mms[22m[39m
     [32m✓[39m does not substitute a child protocol for the family alias bone broth[32m 2[2mms[22m[39m
     [32m✓[39m does not substitute a child protocol for the family alias cold shower[32m 2[2mms[22m[39m
     [32m✓[39m does not substitute a child protocol for the family alias winter swimming[32m 3[2mms[22m[39m
     [32m✓[39m keeps broad canonical family retrieval and direct child retrieval[32m 29[2mms[22m[39m
     [32m✓[39m normalizes combining-mark aliases without changing their topic[32m 4[2mms[22m[39m
     [32m✓[39m does not compose a topic from unrelated sauna citations[32m 6[2mms[22m[39m
     [32m✓[39m keeps water-fasting evidence and safety on the fasting topic[32m 13[2mms[22m[39m
     [32m✓[39m returns the focused dry-sauna safety boundary for recent fainting[32m 3[2mms[22m[39m
     [32m✓[39m returns the focused dry-sauna safety boundary for unstable cardiovascular disease[32m 4[2mms[22m[39m
     [32m✓[39m returns the focused dry-sauna safety boundary for fever[32m 2[2mms[22m[39m
     [32m✓[39m returns the focused dry-sauna safety boundary for trying to conceive[32m 2[2mms[22m[39m
     [32m✓[39m returns dry-sauna immunity evidence from the resolved owner[32m 3[2mms[22m[39m
     [32m✓[39m returns member-readable broad evidence for Finnish Dry Sauna[32m 7[2mms[22m[39m
     [32m✓[39m returns member-readable broad evidence for Caffeine Curfew[32m 7[2mms[22m[39m
     [32m✓[39m returns member-readable broad evidence for Creatine Monohydrate[32m 7[2mms[22m[39m
     [32m✓[39m returns member-readable broad evidence for Omega-3 Supplementation[32m 7[2mms[22m[39m
     [32m✓[39m returns member-readable broad evidence for Collagen Supplementation[32m 7[2mms[22m[39m
     [32m✓[39m routes typed source findings to their related protocol[32m 5[2mms[22m[39m
     [32m✓[39m omits ambiguous multi-target source findings instead of broadcasting them[32m 8[2mms[22m[39m
     [32m✓[39m routes measurement findings to REM Sleep[32m 3[2mms[22m[39m
     [32m✓[39m routes measurement findings to HRV / RMSSD[32m 3[2mms[22m[39m
     [32m✓[39m routes directly sourced SpO2 safety to its measurement owner[32m 7[2mms[22m[39m
     [32m✓[39m resolves canonical family and protocol title collisions to the family owner[32m 24[2mms[22m[39m
     [32m✓[39m does not attach page-wide efficacy citations to aggregate safety text[32m 5[2mms[22m[39m
     [32m✓[39m never returns an unsourced ordinary item or an overview row[32m 99[2mms[22m[39m
     [32m✓[39m does not return reducer bookkeeping as IT band guidance[32m 6[2mms[22m[39m
 [32m✓[39m [30m[42m health-commons [49m[39m test/cli-coverage.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 73[2mms[22m[39m
 [32m✓[39m [30m[42m health-commons [49m[39m test/sleep-workflow-content.test.ts [2m([22m[2m2 tests[22m[2m)[22m[33m 4484[2mms[22m[39m
 [32m✓[39m [30m[42m health-commons [49m[39m test/biomarker-fallback-ranges.test.ts [2m([22m[2m5 tests[22m[2m)[22m[33m 2870[2mms[22m[39m
 [32m✓[39m [30m[42m health-commons [49m[39m test/knowledge-index.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 146[2mms[22m[39m
 [32m✓[39m [30m[42m health-commons [49m[39m test/protocol-artifacts.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 14[2mms[22m[39m
 [32m✓[39m [30m[42m health-commons [49m[39m test/sleep-complaint-publishing-journeys.test.ts [2m([22m[2m4 tests[22m[2m)[22m[33m 7414[2mms[22m[39m
 [32m✓[39m [30m[42m health-commons [49m[39m test/catalog.measurement-plan.test.ts [2m([22m[2m1 test[22m[2m)[22m[32m 16[2mms[22m[39m
 [32m✓[39m [30m[42m health-commons [49m[39m test/biomarker-web-artifacts.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 6[2mms[22m[39m
 [32m✓[39m [30m[42m health-commons [49m[39m test/pre-sleep-silent-meditation-signal-cards.test.ts [2m([22m[2m1 test[22m[2m)[22m[33m 4479[2mms[22m[39m
     [33m[2m✓[22m[39m keeps the expected signal metadata aligned with the protocol page [33m 4477[2mms[22m[39m
 [32m✓[39m [30m[42m health-commons [49m[39m test/catalog-baseline-policy.test.ts [2m([22m[2m2 tests[22m[2m)[22m[33m 8621[2mms[22m[39m
     [33m[2m✓[22m[39m uses two-week baselines by default and composes total durations from each plan [33m 4483[2mms[22m[39m
     [33m[2m✓[22m[39m keeps Daily Step Floor timing exclusively on its fixed two-week test plan [33m 4137[2mms[22m[39m
 [32m✓[39m [30m[42m health-commons [49m[39m test/load.test.ts [2m([22m[2m2 tests[22m[2m)[22m[32m 31[2mms[22m[39m
 [32m✓[39m [30m[42m health-commons [49m[39m test/tabata-20-10-signal-cards.test.ts [2m([22m[2m1 test[22m[2m)[22m[33m 4549[2mms[22m[39m
     [33m[2m✓[22m[39m keeps the expected signal metadata aligned with the protocol page [33m 4547[2mms[22m[39m
 [32m✓[39m [30m[42m health-commons [49m[39m test/itbs-signal-cards.test.ts [2m([22m[2m1 test[22m[2m)[22m[33m 4538[2mms[22m[39m
     [33m[2m✓[22m[39m keeps the catalog focused on lateral-knee pain and running tolerance [33m 4536[2mms[22m[39m
 [32m✓[39m [30m[42m health-commons [49m[39m test/bryan-johnson-onboarding.test.ts [2m([22m[2m1 test[22m[2m)[22m[33m 4454[2mms[22m[39m
     [33m[2m✓[22m[39m materializes the structured onboarding contract in the catalog [33m 4453[2mms[22m[39m
 [32m✓[39m [30m[42m health-commons [49m[39m test/hash-artifact.test.ts [2m([22m[2m1 test[22m[2m)[22m[32m 8[2mms[22m[39m

[31m⎯⎯⎯⎯⎯⎯⎯[39m[1m[41m Failed Tests 1 [49m[22m[31m⎯⎯⎯⎯⎯⎯⎯[39m

[41m[1m FAIL [22m[49m [30m[42m health-commons [49m[39m test/knowledge-index-full-catalog.test.ts[2m > [22mHealth Commons full-catalog knowledge retrieval[2m > [22manswers a normal sauna question without requiring an exact catalog title
[31m[1mAssertionError[22m: expected 0 to be greater than 0[39m
[36m [2m❯[22m test/knowledge-index-full-catalog.test.ts:[2m44:33[22m[39m
    [90m 42|[39m
    [90m 43|[39m     [34mexpect[39m(result[33m.[39mtopicResolved)[33m.[39m[34mtoBe[39m([35mtrue[39m)[33m;[39m
    [90m 44|[39m     [34mexpect[39m(result[33m.[39mitems[33m.[39mlength)[33m.[39m[34mtoBeGreaterThan[39m([34m0[39m)[33m;[39m
    [90m   |[39m                                 [31m^[39m
    [90m 45|[39m     [34mexpect[39m([34mpacketText[39m(result))[33m.[39m[34mtoMatch[39m([36m/immun/iu[39m)[33m;[39m
    [90m 46|[39m   })[33m;[39m

[31m[2m⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯[22m[39m


[2m Test Files [22m [1m[31m1 failed[39m[22m[2m | [22m[1m[32m21 passed[39m[22m[90m (22)[39m
[2m      Tests [22m [1m[31m1 failed[39m[22m[2m | [22m[1m[32m139 passed[39m[22m[90m (140)[39m
[2m   Start at [22m 12:14:58
[2m   Duration [22m 69.55s[2m (transform 868ms, setup 132ms, import 7.53s, tests 58.95s, environment 3ms)[22m


::error file=/home/runner/work/murph/murph/packages/health-commons/test/knowledge-index-full-catalog.test.ts,title=[health-commons] test/knowledge-index-full-catalog.test.ts > Health Commons full-catalog knowledge retrieval > answers a normal sauna question without requiring an exact catalog title,line=44,column=33::AssertionError: expected 0 to be greater than 0%0A ❯ test/knowledge-index-full-catalog.test.ts:44:33%0A%0A
 ELIFECYCLE  Command failed with exit code 1.
 ELIFECYCLE  Test failed. See above for more details.
 ELIFECYCLE  Command failed with exit code 1.
exit: 1
```
