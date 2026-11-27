import web from "../../vitest.config";
export default { ...web, envDir: false as const, test: { ...web.test,
  include: ["apps/web/scripts/epic-proof/runtime.scenario.ts"], cache: false as const } };
