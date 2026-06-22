import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function readRepoFile(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const generatedTypes = readRepoFile("packages/cli/src/incur.generated.ts");
const configSchema = JSON.parse(readRepoFile("packages/cli/config.schema.json")) as {
  properties: {
    commands: {
      properties: Record<string, CommandNode>;
    };
  };
};
const commandManifestSource = readRepoFile("packages/cli/src/vault-cli-command-manifest.ts");
const captureSource = readRepoFile("packages/cli/src/commands/capture.ts");
const encounterSource = readRepoFile("packages/cli/src/commands/encounter.ts");
const mealSource = readRepoFile("packages/cli/src/commands/meal.ts");
const measurementSource = readRepoFile("packages/cli/src/commands/measurement.ts");
const workoutSource = readRepoFile("packages/cli/src/commands/workout.ts");
const vaultServicesSource = readRepoFile("packages/vault-usecases/src/vault-services.ts");

type CommandNode = {
  properties: {
    commands?: {
      properties: Record<string, CommandNode>;
    };
    options?: {
      properties?: Record<string, unknown>;
      required?: string[];
    };
  };
};

type CommandShape = {
  options: readonly string[];
};

const canonicalTypedOnlyCommands = [
  "capture add",
  "meal add",
  "measurement add",
  "workout add",
  "workout format save",
] as const;

const explicitJsonCommands = {
  "capture import-json": {
    options: [
      "input",
      "media",
      "label",
      "bodySite",
      "collection",
      "tag",
      "relatedId",
      "note",
      "title",
      "occurredAt",
      "source",
      "timeZone",
    ],
  },
  "meal import-json": {
    options: [
      "input",
      "photo",
      "audio",
      "note",
      "occurredAt",
      "source",
      "ingredient",
      "nutritionCalories",
      "nutritionProteinGrams",
      "nutritionCarbsGrams",
      "nutritionFatGrams",
      "nutritionFiberGrams",
      "nutritionSource",
      "nutritionConfidence",
      "nutritionSourceDetail",
    ],
  },
  "measurement import-json": {
    options: ["input", "note", "title", "occurredAt", "source", "media"],
  },
  "encounter import-json": {
    options: ["input"],
  },
  "workout import-json": {
    options: [
      "input",
      "note",
      "title",
      "duration",
      "type",
      "distanceKm",
      "occurredAt",
      "source",
      "media",
    ],
  },
  "workout format import-json": {
    options: ["input"],
  },
} as const satisfies Record<string, CommandShape>;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function generatedCommandLine(command: string) {
  const match = generatedTypes.match(
    new RegExp(`^\\s+'${escapeRegExp(command)}': \\{[^\\n]+\\}$`, "m"),
  );

  if (!match) {
    throw new Error(`Generated command type not found for ${command}`);
  }

  return match[0];
}

function configCommand(command: string) {
  const segments = command.split(" ");
  let commandMap = configSchema.properties.commands.properties;
  let node: CommandNode | undefined;

  for (const segment of segments) {
    node = commandMap[segment];
    if (!node) {
      throw new Error(`Config schema command not found for ${command}`);
    }
    commandMap = node.properties.commands?.properties ?? {};
  }

  if (!node) {
    throw new Error(`Config schema command not found for ${command}`);
  }

  return node;
}

function configOptions(command: string) {
  return configCommand(command).properties.options ?? { properties: {} };
}

describe("canonical CLI JSON input split", () => {
  it("keeps canonical add/save commands typed-only in generated types and config schema", () => {
    for (const command of canonicalTypedOnlyCommands) {
      expect(generatedCommandLine(command), command).not.toContain("input?:");
      expect(generatedCommandLine(command), command).not.toContain("input: string");
      expect(Object.keys(configOptions(command).properties ?? {}), command).not.toContain("input");
    }
  });

  it("keeps explicit JSON escape hatches and their old raw payload override fields", () => {
    for (const [command, shape] of Object.entries(explicitJsonCommands)) {
      const generatedLine = generatedCommandLine(command);
      const configOptionShape = configOptions(command);
      const configOptionNames = Object.keys(configOptionShape.properties ?? {});

      expect(generatedLine, command).toContain("input: string");
      for (const optionName of shape.options) {
        expect(generatedLine, `${command} generated option ${optionName}`).toContain(
          `${optionName}`,
        );
        expect(configOptionNames, `${command} config option ${optionName}`).toContain(optionName);
      }
    }
  });

  it("routes raw payloads through explicit import-json commands without dropping nested import surfaces", () => {
    expect(captureSource).toContain("capture.command('import-json'");
    expect(captureSource).toContain("batch capture metadata, media refs, raw refs");
    expect(captureSource).toContain("runCaptureAdd(options, normalizeInputFileOption(options.input))");

    expect(mealSource).toContain("name: 'import-json'");
    expect(mealSource).toContain("nested nutrition provenance");
    expect(mealSource).toContain("return runMealAdd(");
    expect(mealSource).toContain("typeof options.input === 'string' ? options.input : undefined");

    expect(measurementSource).toContain("measurement.command('import-json'");
    expect(measurementSource).toContain("nested links, external references, rawRefs, stored-media import metadata");
    expect(measurementSource).toContain("inputFile: normalizeInputFileOption(options.input)");

    expect(encounterSource).toContain("encounter.command('scaffold'");
    expect(encounterSource).toContain("scaffoldEncounterBundlePayload()");
    expect(encounterSource).toContain("encounter.command('import-json'");
    expect(encounterSource).toContain("linked visit facts such as vitals");
    expect(encounterSource).toContain("inputFile: normalizeInputFileOption(options.input)");
    expect(encounterSource).not.toContain("encounter.command('save'");

    expect(workoutSource).toContain("workout.command('import-json'");
    expect(workoutSource).toContain("media/raw refs, exercises, and sets");
    expect(workoutSource).toContain("format.command('import-json'");
    expect(workoutSource).toContain("routine exercises, planned sets, grouping, tags, and persistent notes");
  });

  it("does not expose legacy raw health upsert commands in generated types or discovery", () => {
    const upsertCommands = [...generatedTypes.matchAll(/'([^']+ upsert)'/g)].map(
      (match) => match[1],
    );
    expect(upsertCommands.sort()).toEqual(["knowledge upsert", "memory upsert"]);

    const legacyRawHealthRoots = [
      "allergy",
      "blood-test",
      "condition",
      "family",
      "genetics",
      "goal",
      "event",
      "food",
      "provider",
      "recipe",
      "supplement",
    ];

    for (const root of legacyRawHealthRoots) {
      expect(generatedTypes, `${root} generated upsert`).not.toContain(`'${root} upsert'`);
      expect(commandManifestSource, `${root} manifest upsert`).not.toContain(
        `path: ['${root}', 'upsert']`,
      );
    }
  });

  it("does not expose the removed intake raw leaf command in generated metadata", () => {
    expect(generatedTypes).not.toContain("'intake raw':");
    expect(
      Object.keys(configCommand("intake").properties.commands?.properties ?? {}),
    ).not.toContain("raw");
  });

  it("does not expose the removed integration storage migration surface", () => {
    expect(generatedTypes).not.toContain("'vault migrate-integration-storage'");
    expect(commandManifestSource).not.toContain("path: ['vault', 'migrate-integration-storage']");
    expect(vaultServicesSource).not.toContain("migrateIntegrationStorage");
    expect(
      Object.keys(configCommand("vault").properties.commands?.properties ?? {}),
    ).not.toContain("migrate-integration-storage");
  });

  it("keeps command discovery aligned with newly discoverable JSON escape hatches", () => {
    for (const pathLiteral of [
      "path: ['capture', 'import-json']",
      "path: ['encounter', 'scaffold']",
      "path: ['encounter', 'import-json']",
      "path: ['measurement', 'import-json']",
      "path: ['scheduled-log', 'import-json']",
      "path: ['workout', 'import-json']",
      "path: ['workout', 'payload-schema']",
      "path: ['workout', 'format', 'import-json']",
    ]) {
      expect(commandManifestSource).toContain(pathLiteral);
    }
  });
});
