export interface CooperativeJsonStringifyOptions {
  signal?: AbortSignal;
  sortKeys?: boolean;
}

interface JsonExitAction {
  kind: "exit";
  value: object;
}

interface JsonTextAction {
  kind: "text";
  value: string;
}

interface JsonValueAction {
  kind: "value";
  location: "array" | "root";
  value: unknown;
}

type JsonStringifyAction = JsonExitAction | JsonTextAction | JsonValueAction;

interface JsonChunkBuffer {
  completedChunks: string[];
  currentChunkChars: number;
  currentChunkParts: string[];
}

const JSON_CHUNK_TARGET_CHARS = 16 * 1_024;

export async function stringifyJsonCooperatively(
  value: unknown,
  options: CooperativeJsonStringifyOptions = {},
): Promise<string> {
  const activeObjects = new Set<object>();
  const output: JsonChunkBuffer = {
    completedChunks: [],
    currentChunkChars: 0,
    currentChunkParts: [],
  };
  const stack: JsonStringifyAction[] = [{
    kind: "value",
    location: "root",
    value,
  }];
  let visited = 0;

  while (stack.length > 0) {
    options.signal?.throwIfAborted();
    visited += 1;
    if (options.signal && visited % 512 === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      options.signal.throwIfAborted();
    }

    const action = stack.pop();
    if (!action) {
      continue;
    }
    if (action.kind === "text") {
      appendJsonChunk(output, action.value);
      continue;
    }
    if (action.kind === "exit") {
      activeObjects.delete(action.value);
      continue;
    }

    const current = action.value;
    if (current === null || typeof current !== "object") {
      const encoded = JSON.stringify(current);
      if (encoded === undefined) {
        if (action.location === "array") {
          appendJsonChunk(output, "null");
          continue;
        }
        throw new TypeError("Browser Vault replica values must be JSON serializable.");
      }
      appendJsonChunk(output, encoded);
      continue;
    }

    if (activeObjects.has(current)) {
      throw new TypeError("Browser Vault replica values must not contain cycles.");
    }
    activeObjects.add(current);
    stack.push({ kind: "exit", value: current });

    if (Array.isArray(current)) {
      stack.push({ kind: "text", value: "]" });
      for (let index = current.length - 1; index >= 0; index -= 1) {
        stack.push({
          kind: "value",
          location: "array",
          value: current[index],
        });
        if (index > 0) {
          stack.push({ kind: "text", value: "," });
        }
      }
      stack.push({ kind: "text", value: "[" });
      continue;
    }

    const entries = Object.entries(current)
      .filter((entry) => !isOmittedJsonObjectValue(entry[1]));
    if (options.sortKeys === true) {
      entries.sort(([left], [right]) => left.localeCompare(right));
    }
    stack.push({ kind: "text", value: "}" });
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (!entry) {
        continue;
      }
      stack.push({
        kind: "value",
        location: "root",
        value: entry[1],
      });
      stack.push({ kind: "text", value: ":" });
      stack.push({ kind: "text", value: JSON.stringify(entry[0]) });
      if (index > 0) {
        stack.push({ kind: "text", value: "," });
      }
    }
    stack.push({ kind: "text", value: "{" });
  }

  options.signal?.throwIfAborted();
  return finishJsonChunks(output);
}

function appendJsonChunk(output: JsonChunkBuffer, value: string): void {
  if (output.currentChunkChars + value.length > JSON_CHUNK_TARGET_CHARS) {
    flushJsonChunk(output);
  }
  output.currentChunkParts.push(value);
  output.currentChunkChars += value.length;
}

function finishJsonChunks(output: JsonChunkBuffer): string {
  flushJsonChunk(output);
  return output.completedChunks.join("");
}

function flushJsonChunk(output: JsonChunkBuffer): void {
  if (output.currentChunkParts.length === 0) {
    return;
  }
  output.completedChunks.push(output.currentChunkParts.join(""));
  output.currentChunkChars = 0;
  output.currentChunkParts = [];
}

function isOmittedJsonObjectValue(value: unknown): boolean {
  return value === undefined || typeof value === "function" || typeof value === "symbol";
}
