import {
  readProcessVercelAliasShaEnvironment,
  verifyCurrentVercelProductionDeployment,
} from "./resolve-vercel-production-alias-sha";

verifyCurrentVercelProductionDeployment(
  readProcessVercelAliasShaEnvironment(),
  process.env.DEPLOYED_SHA ?? "",
)
  .then(({ gitSha }) => {
    process.stdout.write(gitSha);
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
