/**
 * Zod → JSON Schema conversion for tool parameter schemas.
 *
 * Both providers expect JSON Schema for tool definitions but with slightly
 * different envelopes. The output of `zodToJsonSchema` is the parameters
 * object that lives inside that envelope.
 */

export function zodToJsonSchema(schema: any): Record<string, unknown> {
  // Zod v4 has built-in toJSONSchema()
  if (typeof schema?.toJSONSchema === 'function') {
    const jsonSchema = schema.toJSONSchema()
    delete jsonSchema.$schema
    // DeepSeek (and some strict OpenAI-compatible providers) require the
    // top-level schema to declare type: "object". Zod v4's toJSONSchema()
    // for discriminatedUnion produces { oneOf: [...] } without a type,
    // which these providers reject with "got 'type: null'".
    if (!jsonSchema.type) {
      jsonSchema.type = 'object'
    }
    return jsonSchema
  }
  // Fallback for Zod v3
  if (schema?._def?.typeName === 'ZodObject') {
    const shape = schema._def.shape()
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const [key, val] of Object.entries(shape)) {
      properties[key] = zodTypeToJson(val as any)
      if (!(val as any).isOptional?.()) {
        required.push(key)
      }
    }
    return { type: 'object', properties, required }
  }
  return { type: 'object', properties: {} }
}

function zodTypeToJson(z: any): unknown {
  const def = z?._def
  switch (def?.typeName) {
    case 'ZodString':
      return { type: 'string', description: def.description }
    case 'ZodNumber':
      return { type: 'number', description: def.description }
    case 'ZodBoolean':
      return { type: 'boolean', description: def.description }
    case 'ZodArray':
      return { type: 'array', items: zodTypeToJson(def.type) }
    case 'ZodOptional':
      return zodTypeToJson(def.innerType)
    case 'ZodEnum':
      return { type: 'string', enum: def.values }
    case 'ZodObject':
      return zodToJsonSchema(z)
    default:
      return { type: 'string' }
  }
}

/** @deprecated Renamed — use `zodToJsonSchema`. Kept as alias for compatibility. */
export const zodToOpenAISchema = zodToJsonSchema
