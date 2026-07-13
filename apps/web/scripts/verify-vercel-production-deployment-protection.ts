import { verifyVercelProductionDeploymentProtection } from "./resolve-vercel-production-alias-sha";

verifyVercelProductionDeploymentProtection()
  .then((deploymentType) => {
    process.stdout.write(`Verified Vercel deployment protection: ${deploymentType}\n`);
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
