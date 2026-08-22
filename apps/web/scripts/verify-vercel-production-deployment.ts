import {
  readProcessVercelAliasShaEnvironment,
  verifyVercelProductionDeployment,
} from "./resolve-vercel-production-alias-sha";

verifyVercelProductionDeployment(
  readProcessVercelAliasShaEnvironment(),
  {
    deploymentUrl: process.env.HOSTED_WEB_VERCEL_DEPLOYMENT_URL ?? "",
    expectedGitSha: process.env.DEPLOYED_SHA ?? "",
  },
)
  .then(({ gitSha }) => {
    process.stdout.write(gitSha);
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
