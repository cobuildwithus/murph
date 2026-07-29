import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

import { defineConfig } from "prisma/config";

const CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url));

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
