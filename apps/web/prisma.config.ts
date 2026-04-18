import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { defineConfig } from "prisma/config";

const CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url));

for (const envPath of [".env.local", ".env"]) {
  process.loadEnvFile(path.join(CONFIG_DIR, envPath));
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
