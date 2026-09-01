import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliEntryRelativePath = path.join('packages', 'cli', 'dist', 'bin.js');
const generatorRelativePath = path.join(
  'packages',
  'assistant-engine',
  'dist',
  'assistant',
  'generate-cli-surface-contract.js',
);
const artifactRelativePath = path.join(
  'packages',
  'assistant-engine',
  'dist',
  'assistant',
  'cli-surface-contract.generated.json',
);

await assertBuiltFile(cliEntryRelativePath, '@murphai/murph');
await assertBuiltFile(generatorRelativePath, '@murphai/assistant-engine');

const { generateAssistantCliSurfaceContract } = await import(
  pathToFileURL(path.join(repoRoot, generatorRelativePath)).href
);

await generateAssistantCliSurfaceContract({
  artifactPath: path.join(repoRoot, artifactRelativePath),
  cliEntryPath: path.join(repoRoot, cliEntryRelativePath),
  workingDirectory: repoRoot,
});

async function assertBuiltFile(relativePath, packageName) {
  try {
    await access(path.join(repoRoot, relativePath));
  } catch {
    throw new Error(
      `Cannot assemble the assistant CLI surface: ${relativePath} is missing. Build ${packageName} first.`,
    );
  }
}
