import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

const verifyFastPath = new URL("../scripts/verify-fast.sh", import.meta.url)

describe("apps/web verify process ownership", () => {
  it("keeps the verification script valid Bash", () => {
    expect(() => execFileSync("bash", ["-n", verifyFastPath.pathname])).not.toThrow()
  })

  it("starts parallel lanes as owned process groups without host process snapshots", () => {
    const source = readFileSync(verifyFastPath, "utf8")

    expect(source).not.toMatch(/\bps\s+-/u)
    expect(source).not.toContain("list_descendant_pids")
    expect(source).not.toMatch(/\b(?:pgrep|pkill|killall)\b/u)
    expect(source).toContain("done < <(jobs -pr)")
    expect(source).toContain('kill "-$signal" "-$pid"')
    expect(source).toContain(
      'start_owned_background_job build_pid run_timed_step "next build" run_next_build',
    )
    expect(source).toContain(
      'start_owned_background_job smoke_pid run_timed_step "dev smoke" run_dev_smoke',
    )
    expect(source).toContain(
      'start_owned_background_job test_pid run_timed_step "test" run_web_tests',
    )
    expect(source).toContain(
      'start_owned_background_job lint_pid run_timed_step "lint" pnpm lint',
    )
  })
})
