import type { ErrorCodeValue, JsonValue } from "./zod.ts";

export interface ErrorCodeEntry {
  code: ErrorCodeValue;
  retryable: boolean;
  summary: string;
}

export type JsonSchemaTypeName =
  | "array"
  | "boolean"
  | "integer"
  | "null"
  | "number"
  | "object"
  | "string";

export interface JsonSchema {
  $schema?: string;
  $id?: string;
  $defs?: Record<string, JsonSchema>;
  title?: string;
  const?: JsonValue;
  enum?: readonly JsonValue[];
  type?: JsonSchemaTypeName | readonly JsonSchemaTypeName[];
  format?: string;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  oneOf?: readonly JsonSchema[];
  anyOf?: readonly JsonSchema[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  additionalProperties?: boolean | JsonSchema;
  propertyNames?: JsonSchema;
  [key: string]: unknown;
}
