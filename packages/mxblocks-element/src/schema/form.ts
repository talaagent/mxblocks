// The `form` block: MSC4139 input prompts (select, radio, text, checkbox,
// date) with a submit button. Submitting sends one visible reply; see
// lib/form.ts for its exact body and `com.ianm.mtrix.used` values.
// Spec: docs/rich-messages.md.

import { LIMITS, isObj, line, list, oneOf } from "./common.ts";
import { parseId, parseScope } from "./blocks.ts";

export const FORM_KINDS = ["select", "radio", "text", "checkbox", "date"] as const;
export type FormKind = (typeof FORM_KINDS)[number];

export interface FormOption {
  value: string;
  label: string;
}

export interface FormField {
  id: string;
  kind: FormKind;
  label: string;
  required: boolean;
  /** select/radio */
  options: FormOption[];
  /** text */
  maxlength: number;
  placeholder: string | null;
  /** date: YYYY-MM-DD */
  min: string | null;
  max: string | null;
  /** option value, text, boolean or date, matching the kind */
  default: string | boolean | null;
}

export interface FormBlock {
  type: "form";
  id: string;
  title: string | null;
  fields: FormField[];
  submit: { label: string };
  scope: string[] | null;
}

/** `YYYY-MM-DD` with a real month and day (years 2000..2200). */
export function isDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return (
    y >= 2000 &&
    y <= 2200 &&
    t.getUTCFullYear() === y &&
    t.getUTCMonth() === m - 1 &&
    t.getUTCDate() === d
  );
}

function parseOption(v: unknown): FormOption | null {
  if (typeof v === "string") {
    const label = line(v, LIMITS.buttonLabelChars);
    return label && v.length <= 100 ? { value: v, label } : null;
  }
  if (!isObj(v) || typeof v.value !== "string" || !v.value.trim() || v.value.length > 100)
    return null;
  const label =
    v.label === undefined
      ? line(v.value, LIMITS.buttonLabelChars)
      : line(v.label, LIMITS.buttonLabelChars);
  return label ? { value: v.value, label } : null;
}

function parseField(v: unknown): FormField | null {
  if (!isObj(v)) return null;
  const id = parseId(v.id);
  const kind = oneOf(v.kind, FORM_KINDS);
  const label = line(v.label, LIMITS.buttonLabelChars);
  if (!id || !kind || !label) return null;
  const field: FormField = {
    id,
    kind,
    label,
    required: v.required === true,
    options: [],
    maxlength: LIMITS.formText,
    placeholder: null,
    min: null,
    max: null,
    default: null,
  };
  switch (kind) {
    case "select":
    case "radio": {
      const seen = new Set<string>();
      field.options = list(v.options, LIMITS.formOptions, parseOption).filter((o) =>
        seen.has(o.value) ? false : (seen.add(o.value), true),
      );
      if (!field.options.length) return null;
      if (typeof v.default === "string" && seen.has(v.default)) field.default = v.default;
      break;
    }
    case "text": {
      const n = v.maxlength;
      if (typeof n === "number" && Number.isInteger(n) && n >= 1)
        field.maxlength = Math.min(n, LIMITS.formText);
      field.placeholder = line(v.placeholder);
      if (typeof v.default === "string") field.default = v.default.slice(0, field.maxlength);
      break;
    }
    case "checkbox":
      field.default = v.default === true;
      break;
    case "date":
      field.min = isDate(v.min) ? v.min : null;
      field.max = isDate(v.max) ? v.max : null;
      if (field.min && field.max && field.min > field.max) field.max = null;
      field.default = isDate(v.default) ? v.default : null;
      break;
  }
  return field;
}

export function parseForm(v: Record<string, unknown>): FormBlock | null {
  const id = parseId(v.id);
  const submit = isObj(v.submit) ? line(v.submit.label, LIMITS.buttonLabelChars) : null;
  if (!id || !submit) return null;
  const seen = new Set<string>();
  const fields = list(v.fields, LIMITS.formFields, parseField).filter((f) =>
    seen.has(f.id) ? false : (seen.add(f.id), true),
  );
  if (!fields.length) return null;
  return {
    type: "form",
    id,
    title: line(v.title, LIMITS.lineChars),
    fields,
    submit: { label: submit },
    scope: parseScope(v.scope),
  };
}
