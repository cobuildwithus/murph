import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

import { defineConfig } from "prisma/config";

const CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url));
const isFormatCommand = process.argv[2] === "format";
const isHelpRequest = process.argv.includes("--help") || process.argv.includes("-h");

if (
  isFormatCommand
  && !isHelpRequest
  && process.env.MURPH_ALLOW_FULL_PRISMA_FORMAT !== "1"
) {
  throw new Error(
    "Refusing to format the full hosted Web Prisma schema. "
      + "Use `pnpm --dir apps/web prisma:validate` for focused verification. "
      + "Set MURPH_ALLOW_FULL_PRISMA_FORMAT=1 only for an intentional repository-wide schema layout change.",
  );
}

for (const envPath of [".env.local", ".env"]) {
  const absoluteEnvPath = path.join(CONFIG_DIR, envPath);

  if (existsSync(absoluteEnvPath)) {
    process.loadEnvFile(absoluteEnvPath);
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
