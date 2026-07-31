import { readFile } from "node:fs/promises";

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function typeMatches(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

function visit(schema, value, path, errors) {
  if (schema.const !== undefined && value !== schema.const) errors.push(`${path} must equal ${JSON.stringify(schema.const)}.`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path} is not an allowed value.`);
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => typeMatches(value, type))) {
      errors.push(`${path} has the wrong type.`);
      return;
    }
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path} is too short.`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path} is too long.`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path} has an invalid format.`);
    if (schema.format === "uuid" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      errors.push(`${path} must be a UUID.`);
    }
    if (
      schema.format === "date-time" &&
      (
        Number.isNaN(Date.parse(value)) ||
        !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      )
    ) {
      errors.push(`${path} must be an ISO timestamp with an offset.`);
    }
    if (schema.format === "date" && !validIsoDate(value)) errors.push(`${path} must be an ISO date.`);
    if (schema.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
      errors.push(`${path} must be an email address.`);
    }
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} is below the minimum.`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} exceeds the maximum.`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path} has too few items.`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path} has too many items.`);
    if (schema.uniqueItems && new Set(value.map(JSON.stringify)).size !== value.length) errors.push(`${path} contains duplicates.`);
    if (schema.items) value.forEach((item, index) => visit(schema.items, item, `${path}[${index}]`, errors));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const properties = schema.properties ?? {};
    const propertyCount = Object.keys(value).length;
    if (schema.minProperties !== undefined && propertyCount < schema.minProperties) {
      errors.push(`${path} has too few properties.`);
    }
    if (schema.maxProperties !== undefined && propertyCount > schema.maxProperties) {
      errors.push(`${path} has too many properties.`);
    }
    for (const required of schema.required ?? []) {
      if (!(required in value)) errors.push(`${path}.${required} is required.`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) errors.push(`${path}.${key} is not allowed.`);
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (key in value) visit(childSchema, value[key], `${path}.${key}`, errors);
    }
  }
}

export async function validateWithSchema(schemaUrl, value) {
  const schema = JSON.parse(await readFile(schemaUrl, "utf8"));
  const errors = [];
  visit(schema, value, "$", errors);
  if (errors.length > 0) {
    const error = new Error(`Local schema validation failed: ${errors.join(" ")}`);
    error.code = "LOCAL_VALIDATION_ERROR";
    throw error;
  }
  return value;
}
