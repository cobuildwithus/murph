import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export const HOSTED_RUNTIME_EMAIL_CAPABILITY_ENV = {
  HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID: "acct_123",
  HOSTED_EMAIL_CLOUDFLARE_API_TOKEN: "cf-token",
  HOSTED_EMAIL_DOMAIN: "mail.example.test",
  HOSTED_EMAIL_LOCAL_PART: "assistant",
  HOSTED_EMAIL_SIGNING_SECRET: "email-secret",
  TELEGRAM_BOT_TOKEN: "telegram-token",
} as const;

export async function createHostedRuntimeWorkspace(prefix: string) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), prefix));

  return {
    cleanup: async () => rm(workspaceRoot, { force: true, recursive: true }),
    operatorHomeRoot: path.join(workspaceRoot, "home"),
    vaultRoot: path.join(workspaceRoot, "vault"),
    workspaceRoot,
  };
}
