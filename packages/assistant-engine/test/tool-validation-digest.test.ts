import { z } from 'zod'
import { describe, expect, it } from 'vitest'

import {
  buildSafeToolCallValidationDigest,
  isSafeSchemaLikeKey,
} from '../src/assistant/tool-validation-digest.ts'

describe('buildSafeToolCallValidationDigest', () => {
  it('records structural Zod validation facts without raw argument values', () => {
    const schema = z.object({
      brand: z.string(),
      product: z.string(),
      servingSize: z.number().optional(),
    }).strict()
    const rawInput = {
      brandName: 'PrivateBrand',
      servingSize: 'two scoops',
      AG1: 'unsafe key value',
      'https://private.example.test': 'unsafe url key value',
    }
    const parsed = schema.safeParse(rawInput)
    expect(parsed.success).toBe(false)
    if (parsed.success) {
      throw new Error('expected schema validation to fail')
    }

    const digest = buildSafeToolCallValidationDigest({
      error: parsed.error,
      rawInput,
      schemaName: 'murph.supplement_lookup.input',
      toolName: 'murph.supplement_lookup',
    })

    expect(digest).toMatchObject({
      detailsSchema: 'murph.tool-call-validation-digest.v1',
      toolName: 'murph.supplement_lookup',
      schemaName: 'murph.supplement_lookup.input',
      rootType: 'object',
      rootKeysPresent: ['brandName', 'servingSize'],
      rootKeyCount: 4,
      unsafeRootKeyCount: 2,
      missingPaths: ['brand', 'product'],
      unknownKeys: ['brandName'],
      unknownKeyCount: 3,
      invalidPaths: ['servingSize'],
      issueCodes: ['invalid_type', 'missing_required', 'unrecognized_key'],
      inputShape: [
        'root.object.count_1_10',
        'brandName.string.len_1_32',
        'servingSize.string.len_1_32',
      ],
    })
    expect(digest.validationFingerprint).toMatch(/^tvd_[a-f0-9]{12}$/)
    expect(digest.pathIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'brand',
        code: 'missing_required',
        expected: 'string',
        received: 'undefined',
      }),
      expect.objectContaining({
        path: 'servingSize',
        code: 'invalid_type',
        expected: 'number',
        received: 'string.len_1_32',
      }),
      expect.objectContaining({
        path: 'brandName',
        code: 'unrecognized_key',
        received: 'present',
      }),
    ]))

    const serialized = JSON.stringify(digest)
    expect(serialized).not.toContain('PrivateBrand')
    expect(serialized).not.toContain('two scoops')
    expect(serialized).not.toContain('AG1')
    expect(serialized).not.toContain('https://private.example.test')
    expect(serialized).not.toContain('unsafe key value')
  })

  it('keeps the validation fingerprint stable across value changes with the same shape', () => {
    const schema = z.object({
      brand: z.string(),
      product: z.string(),
      servingSize: z.number().optional(),
    }).strict()

    const first = schema.safeParse({
      brandName: 'FirstPrivateValue',
      servingSize: 'one scoop',
    })
    const second = schema.safeParse({
      brandName: 'SecondPrivateValue',
      servingSize: 'two scoops',
    })
    expect(first.success).toBe(false)
    expect(second.success).toBe(false)
    if (first.success || second.success) {
      throw new Error('expected schema validation to fail')
    }

    expect(
      buildSafeToolCallValidationDigest({
        error: first.error,
        rawInput: {
          brandName: 'FirstPrivateValue',
          servingSize: 'one scoop',
        },
        toolName: 'murph.supplement_lookup',
      }).validationFingerprint,
    ).toBe(
      buildSafeToolCallValidationDigest({
        error: second.error,
        rawInput: {
          brandName: 'SecondPrivateValue',
          servingSize: 'two scoops',
        },
        toolName: 'murph.supplement_lookup',
      }).validationFingerprint,
    )
  })
})

describe('isSafeSchemaLikeKey', () => {
  it('accepts schema-like keys and rejects likely value-like keys', () => {
    expect(isSafeSchemaLikeKey('brandName')).toBe(true)
    expect(isSafeSchemaLikeKey('servingSize')).toBe(true)
    expect(isSafeSchemaLikeKey('product_name')).toBe(true)
    expect(isSafeSchemaLikeKey('dose-mg')).toBe(true)
    expect(isSafeSchemaLikeKey('AG1')).toBe(false)
    expect(isSafeSchemaLikeKey('PrivateSupplement')).toBe(false)
    expect(isSafeSchemaLikeKey('https://private.example.test')).toBe(false)
  })
})
