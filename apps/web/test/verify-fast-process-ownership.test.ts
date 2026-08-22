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

  it("keeps release test shards isolated from the memory-measured build lane", () => {
    const source = readFileSync(verifyFastPath, "utf8")

    expect(source).toContain(
      "MURPH_HOSTED_WEB_VERIFY_LANE must be all, build, or test-shard.",
    )
    expect(source).toContain(
      "MURPH_HOSTED_WEB_TEST_SHARD must use <index>/<count>",
    )
    expect(source).toContain(
      'pnpm test:prepared -- --shard="$hosted_web_test_shard" --passWithNoTests=false',
    )
    expect(source).toContain(
      'run_timed_step "test shard $hosted_web_test_shard" run_web_tests',
    )
    expect(source).toContain("MURPH_REQUIRE_HEALTH_COMMONS_ROUTE_TRACES=1")
    expect(source).toContain("apps/web/test/instrumentation.test.ts")
    expect(source).toContain(
      'run_timed_step "changelog generated artifacts" pnpm changelog:generate',
    )
    expect(
      source.indexOf('if [[ "$hosted_web_verify_lane" == "test-shard" ]]'),
    ).toBeLessThan(
      source.indexOf(
        "run next build serially because the memory guard owns the measured cgroup scope",
      ),
    )
    expect(source.indexOf('run_timed_step "next build" run_next_build')).toBeLessThan(
      source.indexOf('run_timed_step "dev smoke" run_dev_smoke'),
    )
    expect(source.indexOf('run_timed_step "dev smoke" run_dev_smoke')).toBeLessThan(
      source.indexOf(
        'run_timed_step "build output tests" run_build_output_tests',
      ),
    )
    expect(source).toContain('if [[ "$hosted_web_verify_lane" == "all" ]]; then')
  })
})
