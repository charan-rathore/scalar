import type { SchemaObject } from '@scalar/workspace-store/schemas/v3.2/strict/openapi-document'
import { describe, expect, it } from 'vitest'

import {
  buildDottedNestedRowPredicate,
  coerceLeafValueToSchemaType,
  coerceUntypedValue,
  resolveLeafSchema,
} from './schema-value-coercion'

describe('coerceUntypedValue', () => {
  it('parses non-string JSON values', () => {
    expect(coerceUntypedValue('5')).toBe(5)
    expect(coerceUntypedValue('3.14')).toBe(3.14)
    expect(coerceUntypedValue('true')).toBe(true)
    expect(coerceUntypedValue('false')).toBe(false)
    expect(coerceUntypedValue('null')).toBe(null)
    expect(coerceUntypedValue('[1,2]')).toEqual([1, 2])
    expect(coerceUntypedValue('{"a":1}')).toEqual({ a: 1 })
  })

  it('keeps plain text as-is', () => {
    expect(coerceUntypedValue('hello')).toBe('hello')
    expect(coerceUntypedValue('not json {')).toBe('not json {')
  })

  it('keeps the raw text when the value parses to a string', () => {
    // The user typed the quotes — do not strip them.
    expect(coerceUntypedValue('"quoted"')).toBe('"quoted"')
  })

  it('passes non-string values through', () => {
    expect(coerceUntypedValue(5)).toBe(5)
    expect(coerceUntypedValue(true)).toBe(true)
    const file = new File([''], 'a.txt')
    expect(coerceUntypedValue(file)).toBe(file)
  })
})

describe('coerceLeafValueToSchemaType', () => {
  it('restores schema-declared types', () => {
    expect(coerceLeafValueToSchemaType('5', { type: 'integer' })).toBe(5)
    expect(coerceLeafValueToSchemaType('true', { type: 'boolean' })).toBe(true)
    expect(coerceLeafValueToSchemaType('[1]', { type: 'array' } as SchemaObject)).toEqual([1])
  })

  it('keeps text when the schema allows strings or has no type', () => {
    expect(coerceLeafValueToSchemaType('5', { type: 'string' })).toBe('5')
    expect(coerceLeafValueToSchemaType('5', {} as SchemaObject)).toBe('5')
  })

  it('leaves values that do not parse as the declared type untouched', () => {
    expect(coerceLeafValueToSchemaType('3.14', { type: 'integer' })).toBe('3.14')
    expect(coerceLeafValueToSchemaType('oops', { type: 'number' })).toBe('oops')
  })
})

describe('resolveLeafSchema', () => {
  const schema: SchemaObject = {
    type: 'object',
    properties: {
      user: {
        type: 'object',
        properties: {
          age: { type: 'integer' },
        },
      },
    },
  }

  it('walks dotted paths to the leaf schema', () => {
    expect(resolveLeafSchema(schema, ['user', 'age'])).toEqual({ type: 'integer' })
  })

  it('returns undefined for undeclared segments', () => {
    expect(resolveLeafSchema(schema, ['user', 'missing'])).toBeUndefined()
    expect(resolveLeafSchema(schema, ['missing'])).toBeUndefined()
    expect(resolveLeafSchema(undefined, ['user'])).toBeUndefined()
  })

  it('resolves leaves through an allOf $ref and description', () => {
    const referenced: SchemaObject = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        value: { type: 'integer' },
      },
      required: ['name'],
    }
    const composed = {
      type: 'object',
      properties: {
        file: {
          allOf: [
            { $ref: '#/components/schemas/MyData', '$ref-value': referenced },
            { description: 'JSON file containing the data.' },
          ],
        },
      },
    } as unknown as SchemaObject

    expect(resolveLeafSchema(composed, ['file', 'name'])).toStrictEqual({ type: 'string' })
    expect(resolveLeafSchema(composed, ['file', 'value'])).toStrictEqual({ type: 'integer' })
  })
})

describe('buildDottedNestedRowPredicate', () => {
  const schema: SchemaObject = {
    type: 'object',
    properties: {
      props: {
        type: 'object',
        properties: { name: { type: 'string' } },
      },
      flat: { type: 'string' },
    },
  }

  it('matches dotted names whose top segment is a declared nested object', () => {
    const predicate = buildDottedNestedRowPredicate(schema)
    expect(predicate('props.name', 'x')).toBe(true)
    expect(predicate('flat.name', 'x')).toBe(false)
    expect(predicate('unknown.name', 'x')).toBe(false)
    expect(predicate('props', 'x')).toBe(false)
  })

  it('never matches without a schema', () => {
    const predicate = buildDottedNestedRowPredicate(undefined)
    expect(predicate('props.name', 'x')).toBe(false)
  })

  it('matches dotted names when the nested object is an allOf $ref plus description', () => {
    const referenced: SchemaObject = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        value: { type: 'integer' },
      },
    }
    const composed = {
      type: 'object',
      properties: {
        file: {
          allOf: [
            { $ref: '#/components/schemas/MyData', '$ref-value': referenced },
            { description: 'JSON file containing the data.' },
          ],
        },
      },
    } as unknown as SchemaObject

    const predicate = buildDottedNestedRowPredicate(composed)
    expect(predicate('file.name', '')).toBe(true)
    expect(predicate('file.value', '1')).toBe(true)
    expect(predicate('file', '{"name":""}')).toBe(false)
  })
})
