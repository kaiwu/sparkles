export function anything() {
  return {};
}

export function string() {
  return { type: "string" };
}

export function integer() {
  return { type: "integer" };
}

export function number() {
  return { type: "number" };
}

export function boolean() {
  return { type: "boolean" };
}

export function null_schema() {
  return { type: "null" };
}

export function literal_string(value) {
  return { type: "string", const: value };
}

export function string_enum(values) {
  return { type: "string", enum: values };
}

export function array(items) {
  return { type: "array", items };
}

export function tuple(items) {
  return {
    type: "array",
    prefixItems: items,
    minItems: items.length,
    maxItems: items.length,
  };
}

export function object(properties, additionalProperties) {
  const shape = {};
  const required = [];
  for (const [name, schema, isRequired] of properties) {
    shape[name] = schema;
    if (isRequired) required.push(name);
  }
  // Pi 1.0 passes this schema through to OpenAI-compatible providers.
  // Those providers reject an object schema that omits `required`, including
  // the empty array used when every property is optional.
  return {
    type: "object",
    properties: shape,
    required,
    additionalProperties,
  };
}

export function record(values) {
  return { type: "object", required: [], additionalProperties: values };
}

export function one_of(items) {
  return { anyOf: items };
}

export function nullable(schema) {
  return { anyOf: [schema, { type: "null" }] };
}

export function described(schema, description) {
  return { ...schema, description };
}

export function with_default(schema, defaultValue) {
  return { ...schema, default: defaultValue };
}

export function with_title(schema, title) {
  return { ...schema, title };
}

export function with_string_length(schema, minimum, maximum) {
  return { ...schema, minLength: minimum, maxLength: maximum };
}

export function with_number_range(schema, minimum, maximum) {
  return { ...schema, minimum, maximum };
}

export function with_array_length(schema, minimum, maximum) {
  return { ...schema, minItems: minimum, maxItems: maximum };
}

export function raw(value) {
  return value;
}
