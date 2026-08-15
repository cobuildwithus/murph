import * as z from '@murphai/contracts/zod-runtime'
import { describe, expect, it } from 'vitest'

import {
  buildSafeToolCallValidationDigest,
  collectSafeJsonSchemaValidationPaths,
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
      schemaRootKeys: Object.keys(schema.shape),
      toolName: 'murph.supplement_lookup',
    })

    expect(digest).toMatchObject({
      detailsSchema: 'murph.tool-call-validation-digest.v1',
      toolName: 'murph.supplement_lookup',
      schemaName: 'murph.supplement_lookup.input',
      rootType: 'object',
      rootKeysPresent: ['servingSize'],
      rootKeyCount: 4,
      unsafeRootKeyCount: 3,
      missingPaths: ['brand', 'product'],
      unknownKeyCount: 3,
      invalidPaths: ['servingSize'],
      issueCodes: ['invalid_type', 'missing_required', 'unrecognized_key'],
      inputShape: [
        'root.object.count_1_10',
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
        path: 'root',
        code: 'unrecognized_key',
        received: 'keys.count_1_10',
      }),
    ]))

    const serialized = JSON.stringify(digest)
    expect(serialized).not.toContain('brandName')
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
        schemaRootKeys: Object.keys(schema.shape),
        toolName: 'murph.supplement_lookup',
      }).validationFingerprint,
    ).toBe(
      buildSafeToolCallValidationDigest({
        error: second.error,
        rawInput: {
          brandName: 'SecondPrivateValue',
          servingSize: 'two scoops',
        },
        schemaRootKeys: Object.keys(schema.shape),
        toolName: 'murph.supplement_lookup',
      }).validationFingerprint,
    )
  })

  it('does not serialize or fingerprint schema-like unknown key names', () => {
    const schema = z.object({
      servingSize: z.number().optional(),
    }).strict()

    const first = schema.safeParse({
      clientAcmeCancerReport: 'private',
      servingSize: 'one scoop',
    })
    const second = schema.safeParse({
      privateProjectPhoenix: 'private',
      servingSize: 'two scoops',
    })
    expect(first.success).toBe(false)
    expect(second.success).toBe(false)
    if (first.success || second.success) {
      throw new Error('expected schema validation to fail')
    }

    const firstDigest = buildSafeToolCallValidationDigest({
      error: first.error,
      rawInput: {
        clientAcmeCancerReport: 'private',
        servingSize: 'one scoop',
      },
      schemaRootKeys: Object.keys(schema.shape),
      toolName: 'murph.supplement_lookup',
    })
    const secondDigest = buildSafeToolCallValidationDigest({
      error: second.error,
      rawInput: {
        privateProjectPhoenix: 'private',
        servingSize: 'two scoops',
      },
      schemaRootKeys: Object.keys(schema.shape),
      toolName: 'murph.supplement_lookup',
    })

    expect(firstDigest.validationFingerprint).toBe(secondDigest.validationFingerprint)
    expect(JSON.stringify(firstDigest)).not.toContain('clientAcmeCancerReport')
    expect(JSON.stringify(secondDigest)).not.toContain('privateProjectPhoenix')
  })

  it('preserves only nested paths owned by the supplied JSON schema', () => {
    const jsonSchema = {
      type: 'object',
      properties: {
        card: {
          type: 'object',
          properties: {
            rows: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  values: { type: 'array', minItems: 2 },
                },
              },
            },
          },
        },
      },
    }
    const schemaPaths = collectSafeJsonSchemaValidationPaths(jsonSchema)
    const schema = z.object({
      card: z.object({
        rows: z.array(z.object({
          values: z.array(z.string()).min(2),
        }).strict()),
      }).strict(),
    }).strict().superRefine((_value, context) => {
      context.addIssue({
        code: 'custom',
        message: 'Synthetic rejected path.',
        path: ['card', 'privateNote'],
      })
    })
    const rawInput = {
      card: {
        privateNote: 'neutral synthetic value',
        rows: [{ values: [] }],
      },
    }
    const parsed = schema.safeParse(rawInput)
    expect(parsed.success).toBe(false)
    if (parsed.success) {
      throw new Error('expected schema validation to fail')
    }

    expect(schemaPaths).toEqual([
      'card',
      'card.rows',
      'card.rows[]',
      'card.rows[].values',
    ])
    const digest = buildSafeToolCallValidationDigest({
      error: parsed.error,
      rawInput,
      schemaPaths,
      schemaRootKeys: ['card'],
      toolName: 'murph.attach_response_card',
    })

    expect(digest.pathIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'card.rows[].values',
        code: 'too_small',
        expected: 'array.min_2',
      }),
    ]))
    const serialized = JSON.stringify(digest)
    expect(serialized).not.toContain('privateNote')
    expect(serialized).not.toContain('neutral synthetic value')

    const smuggledPathDigest = buildSafeToolCallValidationDigest({
      error: new z.ZodError([
        {
          code: 'custom',
          message: 'Synthetic rejected path.',
          path: ['card', 'rows[]', 'values'],
        },
        {
          code: 'custom',
          message: 'Synthetic rejected path.',
          path: ['card', 'rows', '[]', 'values'],
        },
      ]),
      rawInput: {
        card: {
          rows: {
            '[]': { values: 'neutral synthetic value' },
          },
        },
      },
      schemaPaths,
      schemaRootKeys: ['card'],
      toolName: 'murph.attach_response_card',
    })
    expect(smuggledPathDigest.pathIssues).toBeUndefined()
    expect(smuggledPathDigest.invalidPaths).toBeUndefined()
    expect(JSON.stringify(smuggledPathDigest)).not.toContain('rows[]')
    expect(JSON.stringify(smuggledPathDigest)).not.toContain(
      'neutral synthetic value',
    )
  })
})

describe('isSafeSchemaLikeKey', () => {
  it('validates schema identifier syntax only', () => {
    expect(isSafeSchemaLikeKey('brandName')).toBe(true)
    expect(isSafeSchemaLikeKey('servingSize')).toBe(true)
    expect(isSafeSchemaLikeKey('product_name')).toBe(true)
    expect(isSafeSchemaLikeKey('dose-mg')).toBe(true)
    expect(isSafeSchemaLikeKey('clientAcmeCancerReport')).toBe(true)
    expect(isSafeSchemaLikeKey('AG1')).toBe(false)
    expect(isSafeSchemaLikeKey('PrivateSupplement')).toBe(false)
    expect(isSafeSchemaLikeKey('https://private.example.test')).toBe(false)
  })
})
