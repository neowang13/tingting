import { ApiError } from "@/lib/api";

export const allowedTemplateVariables = [
  "tenant_name",
  "property",
  "unit",
  "due_date",
  "business_name",
  "business_phone",
  "business_email"
] as const;

export type TemplateVariable = (typeof allowedTemplateVariables)[number];
export type TemplateContext = Record<TemplateVariable, string>;

const variablePattern = /\{\{\s*([a-z_]+)\s*\}\}/g;

export function listTemplateVariables(value: string) {
  return [...value.matchAll(variablePattern)].map((match) => match[1]);
}

export function validateTemplateVariables(...values: Array<string | null | undefined>) {
  const unknown = new Set(
    values.flatMap((value) => value ? listTemplateVariables(value) : [])
      .filter((variable) => !allowedTemplateVariables.includes(variable as TemplateVariable))
  );
  if (unknown.size > 0) {
    throw new ApiError(
      400,
      "UNKNOWN_TEMPLATE_VARIABLE",
      `Unknown template variable: ${[...unknown].join(", ")}.`
    );
  }
}

export function renderTemplate(template: string, context: Partial<TemplateContext>) {
  validateTemplateVariables(template);
  return template.replace(variablePattern, (_match, variable: TemplateVariable) => {
    const value = context[variable];
    if (value === undefined) {
      throw new ApiError(
        400,
        "MISSING_TEMPLATE_VALUE",
        `A value for {{${variable}}} is required.`
      );
    }
    return value;
  });
}

export function estimateSmsSegments(body: string) {
  const usesUnicode = /[^\u0000-\u007f]/.test(body);
  const singleLimit = usesUnicode ? 70 : 160;
  const multipartLimit = usesUnicode ? 67 : 153;
  if (body.length <= singleLimit) return 1;
  return Math.ceil(body.length / multipartLimit);
}

export const sampleTemplateContext: TemplateContext = {
  tenant_name: "Alex Chen",
  property: "1231 Howe Street",
  unit: "1104",
  due_date: "August 1, 2026",
  business_name: "Ting Ting Xu Real Estate",
  business_phone: "604-872-6896",
  business_email: "info@tingtingxu.ca"
};
