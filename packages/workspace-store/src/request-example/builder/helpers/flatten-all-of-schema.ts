import { getResolvedRef, mergeSiblingReferences } from '@/helpers/get-resolved-ref'
import type { SchemaObject, SchemaReferenceType } from '@/schemas/v3.2/strict/openapi-document'
import { isObjectSchema } from '@/schemas/v3.2/strict/type-guards'

/**
 * OpenAPI 3.1 cannot put a description next to `$ref`, so generators emit
 * `allOf: [{ $ref }, { description }]`. Callers that look for `type` never see the
 * referenced schema. Depth is capped because resolving a `$ref` allocates a new
 * object, so a cycle cannot be detected by object identity.
 */
const MAX_ALL_OF_DEPTH = 20

const isSchemaRecord = (value: unknown): value is SchemaObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Object keywords live on only one member of the schema union. */
type SchemaWithObjectKeywords = SchemaObject & {
  properties?: Record<string, SchemaReferenceType<SchemaObject>>
  required?: string[]
}

const objectKeywords = (schema: SchemaObject): SchemaWithObjectKeywords => schema as SchemaWithObjectKeywords

const hasAllOf = (schema: SchemaObject | undefined): boolean =>
  Boolean(schema && Array.isArray(schema.allOf) && schema.allOf.length > 0)

/** Drop reference bookkeeping so a merged schema is not resolved again later. */
const withoutReferenceKeys = (schema: SchemaObject): SchemaObject => {
  if (!Object.hasOwn(schema, '$ref') && !Object.hasOwn(schema, '$ref-value')) {
    return schema
  }

  const { $ref: _ref, ...rest } = schema as SchemaObject & { $ref?: string; '$ref-value'?: unknown }
  if (Object.hasOwn(rest, '$ref-value')) {
    delete rest['$ref-value']
  }
  return rest
}

const unionRequired = (base: SchemaWithObjectKeywords, extra: SchemaWithObjectKeywords): string[] | undefined => {
  const values = [...(base.required ?? []), ...(extra.required ?? [])].filter(
    (item): item is string => typeof item === 'string',
  )
  if (values.length === 0) {
    return undefined
  }
  return [...new Set(values)]
}

/** Later schemas win on overlapping keywords. `properties` and `required` are united. */
const mergeSchemaPair = (base: SchemaObject, extra: SchemaObject): SchemaObject => {
  const baseKeywords = objectKeywords(base)
  const extraKeywords = objectKeywords(extra)
  const merged: SchemaWithObjectKeywords = { ...withoutReferenceKeys(base), ...withoutReferenceKeys(extra) }
  if (baseKeywords.properties || extraKeywords.properties) {
    merged.properties = { ...baseKeywords.properties, ...extraKeywords.properties }
  }
  const required = unionRequired(baseKeywords, extraKeywords)
  if (required) {
    merged.required = required
  }
  return merged
}

const declaresAllOf = (schema: SchemaObject | undefined): boolean => {
  if (!isSchemaRecord(schema)) {
    return false
  }
  if (hasAllOf(schema)) {
    return true
  }
  const resolved = getResolvedRef(schema, mergeSiblingReferences)
  return isSchemaRecord(resolved) && hasAllOf(resolved)
}

/**
 * Collapse `allOf` into one schema so a `$ref` plus a description reads as the referenced schema.
 *
 * Member schemas are merged first. Annotations on the wrapper itself win, which matches
 * OpenAPI 3.1 sibling keywords. Schemas that are not `allOf` compositions are returned
 * resolved and otherwise unchanged.
 */
export const flattenAllOfSchema = (
  schema: SchemaReferenceType<SchemaObject> | undefined,
  depth = 0,
): SchemaObject | undefined => {
  if (!isSchemaRecord(schema)) {
    return undefined
  }

  const resolved = getResolvedRef(schema, mergeSiblingReferences)
  if (!isSchemaRecord(resolved)) {
    return undefined
  }
  if (depth > MAX_ALL_OF_DEPTH || !hasAllOf(resolved)) {
    return resolved
  }

  const { allOf, ...rest } = resolved
  let merged = {} as SchemaObject
  for (const member of allOf ?? []) {
    if (!isSchemaRecord(member)) {
      continue
    }
    const flattened = flattenAllOfSchema(member, depth + 1)
    if (flattened) {
      merged = mergeSchemaPair(merged, flattened)
    }
  }
  merged = mergeSchemaPair(merged, rest)
  if (Object.hasOwn(merged, 'allOf')) {
    const { allOf: _allOf, ...withoutAllOf } = merged
    return withoutAllOf
  }
  return merged
}

/**
 * Description carried by an `allOf` wrapper that is not already an object schema.
 *
 * A normal object description stays on that object. Copying it onto every leaf would
 * change nested form rows that already render the parent and the child separately.
 */
export const allOfDescription = (schema: SchemaReferenceType<SchemaObject> | undefined): string | undefined => {
  if (!isSchemaRecord(schema) || (isObjectSchema(schema) && objectKeywords(schema).properties)) {
    return undefined
  }
  if (!declaresAllOf(schema)) {
    return undefined
  }
  const flattened = flattenAllOfSchema(schema)
  const description = flattened && 'description' in flattened ? flattened.description : undefined
  return typeof description === 'string' && description.length > 0 ? description : undefined
}
