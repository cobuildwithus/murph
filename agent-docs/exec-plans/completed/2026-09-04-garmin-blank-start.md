# Start wearable canaries without restored tabs

## Outcome and invariant

Let the canary attach to its remote browser before opening the current isolated
Web fixture. Preserve the dedicated profile's login state, disabled telemetry,
protected credentials, authorization assertions, and owned cleanup.

## Evidence and ownership

Kernel's profile contract restores saved tabs unless start_url is specified.
The canary creates a new page and persists the profile without closing its tabs.
Those tabs refer to old isolated servers. The pinned Playwright CDP connector
waits for every target to initialize. A loopback Chromium reproduction proved
that a target awaiting its initial HTTP response causes attachment timeout,
while closing that target allows the same browser to attach successfully.
This proves the mechanism; the protected Garmin canary must confirm the repair.

## Smallest correction

Set start_url to about:blank in createAutomationBrowser, which is called only
by the wearable test runner. Kernel already owns clearing restored tabs while
preserving profile auth state. No new state, transport, retries, or dependency.
Keep the bounded diagnostic from the preceding candidate for remaining failures.

## Proof and delivery

Run the Kernel client and browser-runner tests, Web typecheck, and complexity
check. Remove the temporary loopback diagnostic after recording its result.
Review the diff, publish the new PR candidate, then require exact-head CI and
the protected-main live canary. This is internal test infrastructure; Product
UX and public changelog do not apply. The production browser path is unchanged.

Local proof passed: 58 Kernel client and browser-runner tests, Web typecheck,
complexity guard, and diff whitespace check. Parent final review confirmed the
automation method has only the wearable-runner caller and the production
computer-use browser creation method is unchanged. Live confirmation is pending.
Status: completed
Updated: 2026-09-04
Completed: 2026-09-04
