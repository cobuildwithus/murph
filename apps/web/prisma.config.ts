import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { defineConfig } from "prisma/config";

const CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url));

loadEnvFiles([
  path.join(CONFIG_DIR, ".env.local"),
  path.join(CONFIG_DIR, ".env"),
]);

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/murph_device_sync";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: DATABASE_URL,
  },
});

function loadEnvFiles(filePaths: string[]): void {
  for (const filePath of filePaths) {
    loadEnvFileIfPresent(filePath);
  }
}

function loadEnvFileIfPresent(filePath: string): void {
  try {
    process.loadEnvFile(filePath);
  } catch (error) {
    if (
      error
      && typeof error === "object"
      && "code" in error
      && error.code === "ENOENT"
    ) {
      return;
    }

    throw error;
  }
}
