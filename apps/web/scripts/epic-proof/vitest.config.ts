import web from "../../vitest.config";
// The supervisor's run deadline bounds each generation, which can exceed Web's per-test default on a full chart.
export default { ...web, envDir: false as const, test: { ...web.test,
  include: ["apps/web/scripts/epic-proof/runtime.scenario.ts"], cache: false as const, testTimeout: 9 * 60_000 } };
