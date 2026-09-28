import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { sensitiveFilenameRule } from './release-artifact-secret-guard.mjs';

const changedPatchPattern = /^patches\/@cobuild__review-gpt@[^/]+\.patch$/;
const maxCompressedBytes = 2 * 1024 * 1024;
const maxExpandedBytes = 4 * 1024 * 1024;
const maxFileBytes = 2 * 1024 * 1024;
const hash = (bytes, algorithm = 'sha256', encoding = 'hex') =>
  createHash(algorithm).update(bytes).digest(encoding);

function readLockSection(lockfile, name) {
  const sections = [...lockfile.matchAll(new RegExp(`^${name}:\\r?$`, 'gm'))];
  if (sections.length !== 1) throw new Error(`Review dependency requires one lockfile ${name} section.`);
  const remainder = lockfile.slice(sections[0].index + sections[0][0].length + 1);
  return remainder.split(/^\S/m, 1)[0];
}

export function readReviewGptRegistryInput(lockfile) {
  const patched = readLockSection(lockfile, 'patchedDependencies');
  const patches = [...patched.matchAll(/^  '@cobuild\/review-gpt@([^']+)':\r?\n((?: {4}[^\n]*\n|\s*\n)*)/gm)];
  if (patches.length !== 1) throw new Error('Review dependency requires one exact patched package entry.');
  const version = patches[0][1];
  if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version)) {
    throw new Error('Review dependency requires an exact stable package version.');
  }
  const patchPath = `patches/@cobuild__review-gpt@${version}.patch`;
  const patchPaths = [...patches[0][2].matchAll(/^    path: (.+)\r?$/gm)];
  if (patchPaths.length !== 1 || patchPaths[0][1] !== patchPath) {
    throw new Error('Review dependency patch path does not match the locked package version.');
  }
  const patchHashes = [...patches[0][2].matchAll(/^    hash: ([a-f0-9]{64})\r?$/gm)];
  if (patchHashes.length !== 1) throw new Error('Review dependency requires one exact patch hash.');
  const packages = readLockSection(lockfile, 'packages');
  const entries = [...packages.matchAll(/^  '@cobuild\/review-gpt@([^']+)':\r?\n((?: {4}[^\n]*\n|\s*\n)*)/gm)]
    .filter((entry) => entry[1] === version);
  if (entries.length !== 1) throw new Error('Review dependency requires one exact locked package entry.');
  const match = /^    resolution: \{integrity: (sha512-[A-Za-z0-9+/]{86}==)\}\r?$/m.exec(entries[0][2]);
  if (!match || [...entries[0][2].matchAll(/^    resolution:/gm)].length !== 1) {
    throw new Error('Review dependency requires an exact registry SHA-512 integrity resolution.');
  }
  return { version, patchPath, patchHash: patchHashes[0][1], integrity: match[1] };
}

async function downloadRegistryPackage(registryUrl, fetchImpl) {
  const response = await fetchImpl(registryUrl, {
    redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(30_000),
  });
  if (response.status !== 200 || !response.body) throw new Error('Review dependency registry download failed.');
  const parts = [];
  let size = 0;
  for await (const part of response.body) {
    size += part.byteLength;
    if (size > maxCompressedBytes) throw new Error('Review dependency compressed package exceeds its size limit.');
    parts.push(part);
  }
  return Buffer.concat(parts);
}

function readRegularPackageFiles(tarPath, version) {
  const runTar = (args, maxBuffer = maxExpandedBytes) => execFileSync('tar', args, {
    timeout: 5_000, maxBuffer, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const names = runTar(['-tf', tarPath]).toString('utf8').trimEnd().split('\n');
  const kinds = runTar(['-tvf', tarPath]).toString('utf8').trimEnd().split('\n');
  if (names.length === 0 || names.length > 256 || new Set(names).size !== names.length
    || kinds.length !== names.length || kinds.some((line) => !line.startsWith('-'))) {
    throw new Error('Review dependency archive must contain bounded, unique regular files only.');
  }
  let totalBytes = 0;
  const files = names.map((name) => {
    if (!/^package\/[A-Za-z0-9_.@/-]+$/.test(name)
      || name.split('/').some((segment) => !segment || segment === '.' || segment === '..')
      || sensitiveFilenameRule(name)) {
      throw new Error('Review dependency archive contains an unsafe or private file path.');
    }
    // Read bytes to stdout; never let tar create paths or follow archive links.
    const bytes = runTar(['-xOf', tarPath, '--', name], maxFileBytes);
    totalBytes += bytes.length;
    if (totalBytes > maxExpandedBytes) throw new Error('Review dependency expanded package exceeds its size limit.');
    return { name, bytes };
  });
  const manifest = files.find((file) => file.name === 'package/package.json');
  const identity = manifest && JSON.parse(manifest.bytes.toString('utf8'));
  if (identity?.name !== '@cobuild/review-gpt' || identity?.version !== version) {
    throw new Error('Review dependency archive has the wrong package identity.');
  }
  return files;
}

export async function addReviewGptDependencyContext({
  head, changedFiles, contextDir, repoRoot = process.cwd(), fetchImpl = fetch,
}) {
  const changedPaths = changedFiles.split(/\r?\n/);
  if (!changedPaths.some((name) => changedPatchPattern.test(name))) return false;
  if (!/^[a-f0-9]{40}$/.test(head)) throw new Error('Review dependency requires an exact reviewed head.');
  const git = (args) => execFileSync('git', args, {
    cwd: repoRoot, timeout: 5_000, maxBuffer: maxExpandedBytes, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lockfile = git(['show', `${head}:pnpm-lock.yaml`]);
  const { version, patchPath, patchHash, integrity } = readReviewGptRegistryInput(lockfile.toString('utf8'));
  if (!changedPaths.includes(patchPath)) return false;
  const patch = git(['show', `${head}:${patchPath}`]);
  if (hash(patch) !== patchHash) throw new Error('Review dependency patch bytes do not match the reviewed lockfile hash.');
  const registryUrl = `https://registry.npmjs.org/@cobuild/review-gpt/-/review-gpt-${version}.tgz`;
  const archive = await downloadRegistryPackage(registryUrl, fetchImpl);
  if (`sha512-${hash(archive, 'sha512', 'base64')}` !== integrity) {
    throw new Error('Review dependency registry bytes do not match the reviewed lockfile integrity.');
  }
  const tarBytes = gunzipSync(archive, { maxOutputLength: maxExpandedBytes });
  // The existing packager owns this temporary parent and its EXIT cleanup.
  const tarPath = path.join(path.dirname(contextDir), 'review-gpt-registry.tar');
  await writeFile(tarPath, tarBytes, { flag: 'wx', mode: 0o600 });
  const files = readRegularPackageFiles(tarPath, version);
  const destination = path.join(contextDir, 'dependencies', `review-gpt-${version}`);
  await mkdir(path.dirname(destination), { recursive: true });
  await mkdir(destination);
  for (const file of files) {
    const target = path.join(destination, file.name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.bytes, { flag: 'wx' });
  }
  await writeFile(path.join(destination, 'murph.patch'), patch, { flag: 'wx' });
  await writeFile(path.join(destination, 'provenance.json'), `${JSON.stringify({
    schemaVersion: 1, package: `@cobuild/review-gpt@${version}`, reviewedHead: head, registryUrl,
    lockfileBlob: git(['rev-parse', `${head}:pnpm-lock.yaml`]).toString('utf8').trim(),
    integrity, compressedBytes: archive.length, patchPath, patchSha256: hash(patch),
    files: files.map(({ name, bytes }) => ({ path: name, bytes: bytes.length, sha256: hash(bytes) })),
  }, null, 2)}\n`, { flag: 'wx' });
  await writeFile(path.join(destination, 'README.md'),
    '# Exact ReviewGPT dependency source\n\n'
    + 'The package directory contains every unmodified regular file from the public registry tarball verified against the reviewed commit\'s lockfile. No install or lifecycle script ran. The provenance manifest records each file hash.\n\n'
    + 'To inspect Murph\'s patched dependency, copy this directory to scratch, enter `package` outside any Git checkout, then run `git apply --check ../murph.patch` followed by `git apply ../murph.patch`. The patch is the exact reviewed commit\'s patch.\n',
    { flag: 'wx' });
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [head, changedFilePath, contextDir, ...extra] = process.argv.slice(2);
    if (!head || !changedFilePath || !contextDir || extra.length) throw new Error('Review dependency context arguments are incomplete.');
    await addReviewGptDependencyContext({ head, changedFiles: await readFile(changedFilePath, 'utf8'), contextDir });
  } catch (error) {
    // Child command errors can contain machine paths; expose only our finite diagnostics.
    console.error(error instanceof Error && error.message.startsWith('Review dependency ')
      ? error.message : 'Review dependency context could not be verified or packaged.');
    process.exitCode = 1;
  }
}
