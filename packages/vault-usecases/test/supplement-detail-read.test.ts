import { describe, expect, it } from 'vitest'
import { toSupplementListEntity } from '../src/usecases/regimen-read-entities.js'

describe('supplement list summary', () => {
  it('keeps each ingredient amount once the generated body is gone', () => {
    const record = {
      entity: { regimenId: 'reg_synthetic', title: 'Test supplement', status: 'active', kind: 'supplement',
        dose: null, servingSize: '2 capsules', note: 'Do not assume a personal dose.',
        relatedGoalIds: [],
        ingredients: [
          { compound: 'Test compound', amount: 1, unit: 'mg', active: false },
          { compound: 'Second compound', label: 'Label name', amount: 2.5, unit: 'mcg', active: true, note: 'as citrate' },
          { compound: 'Third compound', label: null, amount: null, unit: null, active: true, note: null },
        ],
      },
      document: { relativePath: 'bank/regimens/supplement/test-supplement.md', markdown: '# Test supplement' },
    }
    const item = toSupplementListEntity(record)
    expect(item.data.ingredients).toEqual([
      'Test compound 1 mg; inactive',
      'Second compound (Label name) 2.5 mcg; as citrate',
      'Third compound',
    ])
    expect(item.data).not.toHaveProperty('ingredientsCount')
    expect(item.data).not.toHaveProperty('relatedGoalIdsCount')
    expect(item.data.servingSize).toBe('2 capsules')
    expect(item.data.note).toBe('Do not assume a personal dose.')
  })
})
