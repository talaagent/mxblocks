// What a form's submit click sends (normative; docs/rich-messages.md):
//
//   body:  Form "<title>": <label>: <value>; <label>: <value>
//   <rich key>.used: { event_id, id: <form id>, values: { <field id>: <value>, ... } }
//
// - <title> is the form's title, or its id when it has none.
// - Fields in form order. select/radio show the chosen option's label, text
//   its text (whitespace collapsed), date YYYY-MM-DD, checkbox yes/no.
//   Fields left empty are left out of the body (checkboxes never are). With
//   nothing to show the body is `Form "<title>": (no answers)`.
// - values: every field. text: a string ("" when empty); select/radio: the
//   option's value or null; checkbox: true/false; date: "YYYY-MM-DD" or null.

import type { FormBlock, FormField } from "../schema/index.ts";
import { isDate } from "../schema/index.ts";

export type FormValue = string | boolean | null;
export type FormValues = Record<string, FormValue>;

/** The inputs' starting state: each field's default, or empty. */
export function initialValues(form: FormBlock): FormValues {
  const out: FormValues = {};
  for (const f of form.fields) {
    if (f.kind === "checkbox") out[f.id] = f.default === true;
    else if (f.kind === "text") out[f.id] = typeof f.default === "string" ? f.default : "";
    else out[f.id] = typeof f.default === "string" ? f.default : null;
  }
  return out;
}

/** A field's value normalised for sending (trimmed, capped, kind-checked). */
function clean(f: FormField, v: FormValue | undefined): FormValue {
  switch (f.kind) {
    case "checkbox":
      return v === true;
    case "text":
      return typeof v === "string" ? Array.from(v.trim()).slice(0, f.maxlength).join("") : "";
    case "date":
      return isDate(v) ? v : null;
    default:
      return typeof v === "string" && f.options.some((o) => o.value === v) ? v : null;
  }
}

/** Every field's sendable value. */
export function formValues(form: FormBlock, raw: FormValues): FormValues {
  return Object.fromEntries(form.fields.map((f) => [f.id, clean(f, raw[f.id])]));
}

/** Per-field problems (required and empty, date out of range); empty when ok. */
export function formErrors(form: FormBlock, raw: FormValues): Record<string, string> {
  const errs: Record<string, string> = {};
  const values = formValues(form, raw);
  for (const f of form.fields) {
    const v = values[f.id];
    if (f.kind === "date" && typeof raw[f.id] === "string" && raw[f.id] !== "" && v === null)
      errs[f.id] = "Not a date";
    else if (f.required && (v === null || v === "" || v === false)) errs[f.id] = "Required";
    else if (f.kind === "date" && typeof v === "string") {
      if (f.min && v < f.min) errs[f.id] = `On or after ${f.min}`;
      else if (f.max && v > f.max) errs[f.id] = `On or before ${f.max}`;
    }
  }
  return errs;
}

function display(f: FormField, v: FormValue): string | null {
  switch (f.kind) {
    case "checkbox":
      return v === true ? "yes" : "no";
    case "text":
      return typeof v === "string" && v ? v.replace(/\s+/g, " ") : null;
    case "date":
      return typeof v === "string" ? v : null;
    default:
      return f.options.find((o) => o.value === v)?.label ?? null;
  }
}

/** The reply's body for already-cleaned `values` (see the format above). */
export function formReplyBody(form: FormBlock, values: FormValues): string {
  const parts: string[] = [];
  for (const f of form.fields) {
    const d = display(f, values[f.id] ?? null);
    if (d !== null) parts.push(`${f.label}: ${d}`);
  }
  return `Form "${form.title ?? form.id}": ${parts.length ? parts.join("; ") : "(no answers)"}`;
}
