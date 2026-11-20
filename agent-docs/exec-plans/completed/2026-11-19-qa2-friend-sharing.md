# Friend sharing and unobserved health ranges

Status: completed
Created: 2026-11-19
Updated: 2026-11-19

## Scope and verification

- Preserve the list of committed recipients when a multi-room save stops.
- Align Friends grants with the person board and honor withdrawal in earlier eligible pair rooms.
- Compare the sharing state observed by the form inside the locked save. Cover legacy requests and deliberate reauthorization.
- Check the Friends consent error at the HTTP boundary and distinguish missing health observations from measured zero.
- Exercise synthetic regressions, all game suites including local PostgreSQL, the Web typecheck, and the complexity guard. Keep response changes additive.

## Results

Earlier eligible pair rooms lose the sender’s deselected Progress permissions in the board transaction. The latest room receives new Friends grants. Stale writes preserve the newer choices, and a current read can authorize sharing again. Partial saves report committed recipients. Unobserved health ranges stay unranked. The existing Friends route returned the required consent scopes and a non-retryable 403 in a real database test.

All 3,956 tests in the 152-file game and importer run passed. The final ten focused files passed all 220 tests. The Web typecheck, complexity guard, documentation checks, and golden checks passed.
Completed: 2026-11-19
