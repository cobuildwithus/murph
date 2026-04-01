import process from "node:process";

import { defineConfig } from "prisma/config";

loadEnvFileIfPresent(".env");

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
