import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_RUNS = 5;
const USAGE =
  "Usage: node scripts/benchmark-typescript.mjs [--runs N] [--label LABEL] -- COMMAND [ARG ...]";

function requiredNumber(match, description) {
  if (!match) {
    throw new Error(`Could not parse ${description} from /usr/bin/time output`);
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid ${description} from /usr/bin/time output`);
  }
  return value;
}

export function parseDarwinMaxRssMiB(output) {
  const bytes = requiredNumber(
    /^\s*(\d+)\s+maximum resident set size\s*$/imu.exec(output),
    "Darwin maximum RSS",
  );
  return bytes / (1024 * 1024);
}

export function parseLinuxMaxRssMiB(output) {
  const kibibytes = requiredNumber(
    /^\s*Maximum resident set size \(kbytes\):\s*(\d+)\s*$/imu.exec(output),
    "Linux maximum RSS",
  );
  return kibibytes / 1024;
}

export function median(values) {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) {
    throw new Error("median requires one or more finite numbers");
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function parseArguments(argv) {
  let runs = DEFAULT_RUNS;
  let label = "benchmark";
  const hasPnpmSeparator =
    argv[0] === "--" &&
    argv.indexOf("--", 1) !== -1 &&
    (argv[1] === "--" || argv[1] === "--runs" || argv[1] === "--label");
  let index = hasPnpmSeparator ? 1 : 0;

  while (index < argv.length && argv[index] !== "--") {
    const option = argv[index];
    const value = argv[index + 1];
    if (option === "--runs") {
      runs = Number(value);
      if (!Number.isSafeInteger(runs) || runs < 1) {
        throw new Error("--runs must be a positive integer");
      }
    } else if (option === "--label") {
      if (value === undefined || value === "--") {
        throw new Error("--label requires a value");
      }
      label = value;
    } else {
      throw new Error(`Unknown option: ${option ?? ""}`);
    }
    index += 2;
  }

  if (argv[index] !== "--" || argv.length === index + 1) {
    throw new Error("Expected -- followed by a command");
  }

  return { runs, label, command: argv.slice(index + 1) };
}

function timeConfiguration(platform) {
  if (platform === "darwin") {
    return { flag: "-l", parseMaxRssMiB: parseDarwinMaxRssMiB };
  }
  if (platform === "linux") {
    return { flag: "-v", parseMaxRssMiB: parseLinuxMaxRssMiB };
  }
  throw new Error(`Unsupported platform: ${platform}`);
}

function runBenchmark({ runs, label, command }) {
  const { flag, parseMaxRssMiB } = timeConfiguration(process.platform);
  const elapsedSeconds = [];
  const maximumRssMiB = [];
  const outputDirectory = mkdtempSync(path.join(tmpdir(), "murph-benchmark-"));

  try {
    for (let run = 1; run <= runs; run += 1) {
      const timeOutput = path.join(outputDirectory, `run-${run}.txt`);
      const startedAt = process.hrtime.bigint();
      const result = spawnSync(
        "/usr/bin/time",
        [flag, "-o", timeOutput, ...command],
        { stdio: "inherit" },
      );
      const elapsed = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;

      if (result.error) {
        throw result.error;
      }
      if (result.status !== 0) {
        const outcome = result.signal
          ? `signal ${result.signal}`
          : `exit code ${result.status ?? 1}`;
        console.error(`[${label}] run ${run}/${runs} failed with ${outcome}`);
        return result.status ?? 1;
      }

      const rssMiB = parseMaxRssMiB(readFileSync(timeOutput, "utf8"));
      elapsedSeconds.push(elapsed);
      maximumRssMiB.push(rssMiB);
      console.log(
        `[${label}] run ${run}/${runs}: ${elapsed.toFixed(3)}s, ${rssMiB.toFixed(1)} MiB max RSS`,
      );
    }

    const maxRss = maximumRssMiB.reduce((maximum, value) =>
      Math.max(maximum, value),
    );
    console.log(
      `[${label}] median ${median(elapsedSeconds).toFixed(3)}s, maximum RSS ${maxRss.toFixed(1)} MiB`,
    );
    return 0;
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
}

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  try {
    process.exitCode = runBenchmark(parseArguments(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    process.exitCode = 1;
  }
}
