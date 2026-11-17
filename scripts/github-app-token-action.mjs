import { appendFileSync } from "node:fs";
import { createGitHubAppTokenSupplier, revokeGitHubAppToken } from "./github-app-token.mjs";

export async function runTokenAction({
  env = process.env, createSupplier = createGitHubAppTokenSupplier,
  append = appendFileSync, log = console.log, revoke = revokeGitHubAppToken,
} = {}) {
  if (!env.GITHUB_STATE || !env.GITHUB_OUTPUT) throw new Error("Action command files are required.");
  const repositories = (env.INPUT_REPOSITORIES ?? "").split(/[,\n]/u).map((value) => value.trim()).filter(Boolean);
  const supplier = createSupplier({
    appId: env["INPUT_APP-ID"], keyVersion: env["INPUT_KEY-VERSION"], env,
    repository: `${env.INPUT_OWNER}/${repositories[0]}`, repositories,
    permissions: JSON.parse(env.INPUT_PERMISSIONS ?? "null"),
  });
  const token = await supplier();
  try {
    // The supplier admits only single-line credentials. Mask before any output.
    log(`::add-mask::${token.replaceAll("%", "%25")}`);
    append(env.GITHUB_STATE, `token=${token}\n`, { encoding: "utf8" });
    append(env.GITHUB_OUTPUT, `token=${token}\n`, { encoding: "utf8" });
  } catch {
    await revoke(token);
    throw new Error("GitHub App token output failed.");
  }
}

export async function cleanupTokenAction({ env = process.env, revoke = revokeGitHubAppToken } = {}) {
  if (env.STATE_token) await revoke(env.STATE_token);
}
