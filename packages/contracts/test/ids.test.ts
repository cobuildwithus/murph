import assert from "node:assert/strict";

import { test } from "vitest";

import {
  assertContractId,
  contractIdMaxLength,
  GENERIC_CONTRACT_ID_REGEX,
  GENERIC_CONTRACT_ID_PATTERN,
  idPattern,
  isContractId,
  ULID_BODY_LENGTH,
  ULID_BODY_REGEX,
} from "../src/ids.ts";

const VALID_ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const VALID_MEMORY_ID = `mem_${VALID_ULID}`;

test("contract id helpers expose the expected ULID and pattern seams", () => {
  assert.equal(ULID_BODY_LENGTH, 26);
  assert.equal(ULID_BODY_REGEX.test(VALID_ULID), true);
  assert.equal(idPattern("mem"), `^mem_[0-9A-HJKMNP-TV-Z]{26}$`);
  assert.equal(contractIdMaxLength("mem"), 30);
  assert.match(GENERIC_CONTRACT_ID_PATTERN, /\(\?:/u);
  assert.equal(GENERIC_CONTRACT_ID_REGEX.test(VALID_MEMORY_ID), true);
});

test("isContractId validates ids with and without explicit prefixes", () => {
  assert.equal(isContractId(VALID_MEMORY_ID), true);
  assert.equal(isContractId(VALID_MEMORY_ID, "mem"), true);
  assert.equal(isContractId(`evt_${VALID_ULID}`, "mem"), false);
  assert.equal(isContractId("mem_not-a-ulid", "mem"), false);
  assert.equal(isContractId(""), false);
  assert.equal(isContractId(null), false);
});

test("assertContractId returns valid ids and throws prefix-aware errors for invalid inputs", () => {
  assert.equal(assertContractId(VALID_MEMORY_ID), VALID_MEMORY_ID);
  assert.equal(assertContractId(VALID_MEMORY_ID, "mem", "memoryId"), VALID_MEMORY_ID);
  assert.throws(
    () => assertContractId("evt_not-a-ulid", "mem", "memoryId"),
    /memoryId must match mem_<ULID>/u,
  );
  assert.throws(
    () => assertContractId(42, undefined, "recordId"),
    /recordId must match prefix_ulid/u,
  );
});
