import type { SchemaObject } from '@scalar/workspace-store/schemas/v3.2/strict/openapi-document'
import { describe, expect, it } from 'vitest'

import { allOfDescription, flattenAllOfSchema } from './flatten-all-of-schema'

const myData: SchemaObject = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    value: { type: 'integer' },
  },
  required: ['name'],
}

describe('flattenAllOfSchema', () => {
  it('merges a $ref and a description-only allOf sibling into the referenced object', () => {
    const schema = {
      allOf: [
        { $ref: '#/components/schemas/MyData', '$ref-value': myData },
        { description: 'JSON file containing the data.' },
      ],
    } as unknown as SchemaObject

    expect(flattenAllOfSchema(schema)).toStrictEqual({
      type: 'object',
      properties: myData.properties,
      required: ['name'],
      description: 'JSON file containing the data.',
    })
  })

  it('lets the wrapper description win over a description on the referenced schema', () => {
    const schema = {
      description: 'Wrapper description',
      allOf: [{ type: 'object', description: 'Member description', properties: { name: { type: 'string' } } }],
    } as unknown as SchemaObject

    expect(flattenAllOfSchema(schema)?.description).toBe('Wrapper description')
  })

  it('unions properties and required from allOf members', () => {
    const schema = {
      allOf: [
        { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
        { type: 'object', properties: { value: { type: 'integer' } }, required: ['value'] },
      ],
    } as unknown as SchemaObject

    expect(flattenAllOfSchema(schema)).toStrictEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        value: { type: 'integer' },
      },
      required: ['name', 'value'],
    })
  })

  it('returns a schema that is not an allOf composition unchanged', () => {
    expect(flattenAllOfSchema(myData)).toStrictEqual(myData)
    expect(flattenAllOfSchema(undefined)).toBeUndefined()
  })

  it('reads the description from an allOf wrapper and not from a plain object schema', () => {
    const wrapped = {
      allOf: [
        { $ref: '#/components/schemas/MyData', '$ref-value': myData },
        { description: 'JSON file containing the data.' },
      ],
    } as unknown as SchemaObject
    const plain: SchemaObject = {
      type: 'object',
      description: 'Widget metadata',
      properties: { name: { type: 'string' } },
    }

    expect(allOfDescription(wrapped)).toBe('JSON file containing the data.')
    expect(allOfDescription(plain)).toBeUndefined()
    expect(allOfDescription({ type: 'string' })).toBeUndefined()
  })
})
