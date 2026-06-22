import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = dirname(fileURLToPath(import.meta.url));

export const fraunces400FontPath = join(appDir, "fonts", "Fraunces-400.ttf");
export const fraunces600FontPath = join(appDir, "fonts", "Fraunces-600.ttf");
export const dmSans400FontPath = join(appDir, "fonts", "DMSans-400.ttf");
