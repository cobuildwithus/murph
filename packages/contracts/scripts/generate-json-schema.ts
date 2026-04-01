import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { schemaCatalog } from "@murphai/contracts/schemas";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const generatedDir = path.resolve(__dirname, "../../generated");

await mkdir(generatedDir, { recursive: true });

for (const [name, schema] of Object.entries(schemaCatalog)) {
  const outputPath = path.join(generatedDir, `${name}.schema.json`);
  await writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
}

console.log(`Generated ${Object.keys(schemaCatalog).length} schema artifact(s).`);
