# Member-scoped Apple Health diagnostics

Status: active
Created: 2026-09-08
Updated: 2026-09-08

## Goal

- Operators can investigate a member's Apple Health sync interruption using attributable native observations and separately labeled server receipts.

## Success criteria

- Authenticated, consent-checked, bounded metadata admission into the existing dedicated diagnostic log.
- Native lifecycle and SDK progress snapshots preserve member binding, remain best effort, and never report health values, raw errors, credentials or device identifiers.
- Operator reads distinguish source upload arrival, canonical import completion, pending ingestion, and unavailable phone diagnostics.
- Focused backend and native tests, typechecks where available, privacy review and scoped commits.

## Scope

- In scope: Web admission/read projection, native observations and version correlation, existing retention and deletion owners, integration fixtures and operational documentation.
- Out of scope: changes to sync behavior, historical-data repair, provider mutations, deployment or App Store release.

## Constraints

- Reuse the dedicated hosted log database and its per-subject serialization. No schema, dependency, scheduler, health store, or sync retry owner.
- Native diagnostics cannot grant auth, infer HealthKit read permission, delay user actions, or cross an account switch.
- Complete local work before release decisions. Native build validation requires Xcode, currently unavailable on this host.

## Risks and mitigations

1. Client observations can be missing, stale or inaccurate. Keep server receipt time and client observation time separate; never promote telemetry to canonical sync truth.
2. High volume or private payload leakage. Closed schemas, byte/count caps, existing serialized log admission and bounded native sends.
3. App/backend skew. Deploy additive Web acceptance before releasing native; rejection drops optional telemetry without changing sync.

## Tasks

1. Add strict member-bound diagnostic admission and bounded operator projection.
2. Capture existing SDK sync history and native lifecycle facts, with account-safe optional delivery.
3. Prove parsing, auth, consent, rate bounds, offline behavior, member switches and receipt separation.
4. Review privacy and implementation complexity, document operation and validation, commit scoped changes.

## Decisions

- Existing anonymous auth diagnostics remain anonymous. A shared process-only diagnostic session id connects authenticated native observations to that troubleshooting stream.
- SDK-owned retained progress supplies background history at foreground observation; no new local health reader or persisted diagnostic queue.

## Verification

- Focused Web Vitest, hosted-execution parser tests and Web typecheck.
- SwiftFormat, XcodeGen, native test/typecheck where available; otherwise standalone Foundation contract validation and explicit simulator gap.

## Implementation evidence

- Added authenticated metadata admission and an operator-only seven-day projection into existing log/receipt owners; no migration or health payload retention.
- Web: 34 focused tests passed, 37 hosted runtime-control parser tests passed; Web and hosted-execution typechecks passed. Complexity and raw-health-log guards passed.
- Native: seven shared transport regression checks passed under strict concurrency with warnings as errors; XcodeGen and SwiftFormat passed.
- Full native command `xcodebuild test -scheme MurphCompanion -destination 'platform=iOS Simulator,name=iPhone 17'` cannot run because this host has Command Line Tools without Xcode. The standalone Foundation runner proves transport behavior only; UIKit/SDK/AppSession compilation, simulator tests and physical-device behavior remain unverified.
- Parent privacy and diff review completed. Paired PR review remains pending; no merge, deployment, or release performed.
