// The `form` block: native inputs and one submit button. Nothing is sent on
// change or on Enter; the submit click sends one visible reply (format in
// lib/form.ts). Disabled outside `scope` and once the user has submitted
// (their reply naming this form is found in the timeline).

import { React } from "../react";
import type { FormBlock, FormField } from "../schema/index.ts";
import {
  type FormValue,
  type FormValues,
  formErrors,
  formReplyBody,
  formValues,
  initialValues,
} from "../lib/form.ts";
import { myUserId, sendFormReply } from "../matrix";
import type { Interactions } from "./buttons";
import { cx } from "./util";

/** The submitted values (from the reply's `used.values`) over the defaults. */
function submittedValues(block: FormBlock, used: Record<string, unknown> | null): FormValues {
  const out = initialValues(block);
  for (const f of block.fields) {
    const v = used?.[f.id];
    if (typeof v === "string" || typeof v === "boolean" || v === null) out[f.id] = v;
  }
  return out;
}

function Input({
  field,
  id,
  value,
  disabled,
  onChange,
}: {
  field: FormField;
  id: string;
  value: FormValue;
  disabled: boolean;
  onChange: (v: FormValue) => void;
}): React.JSX.Element {
  const str = typeof value === "string" ? value : "";
  switch (field.kind) {
    case "select":
      return (
        <select
          id={id}
          className="mxblocks_input"
          value={str}
          disabled={disabled}
          required={field.required}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">Choose…</option>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "radio":
      return (
        <span className="mxblocks_radios" role="radiogroup" aria-labelledby={`${id}-label`}>
          {field.options.map((o, i) => (
            <label key={o.value} className="mxblocks_check">
              <input
                type="radio"
                name={id}
                id={i === 0 ? id : undefined}
                value={o.value}
                checked={value === o.value}
                disabled={disabled}
                onChange={() => onChange(o.value)}
              />
              {o.label}
            </label>
          ))}
        </span>
      );
    case "checkbox":
      return (
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case "date":
      return (
        <input
          id={id}
          type="date"
          className="mxblocks_input"
          value={str}
          min={field.min ?? undefined}
          max={field.max ?? undefined}
          disabled={disabled}
          required={field.required}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    case "text":
      return (
        <input
          id={id}
          type="text"
          className="mxblocks_input"
          value={str}
          maxLength={field.maxlength}
          placeholder={field.placeholder ?? undefined}
          disabled={disabled}
          required={field.required}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
          // Only the submit click sends: Enter doesn't submit.
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
          }}
        />
      );
  }
}

export function Form({ block, ctx }: { block: FormBlock; ctx: Interactions }): React.JSX.Element {
  const [values, setValues] = React.useState<FormValues>(() => initialValues(block));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const me = myUserId();
  const allowed = block.scope === null || (me !== null && block.scope.includes(me));
  const submitted = ctx.used.has(block.id);
  const locked = submitted || !allowed || pending;
  const shown = submitted ? submittedValues(block, ctx.used.get(block.id) ?? null) : values;
  const base = `mxblocks-${ctx.eventId}-${block.id}`;

  const submit = async (): Promise<void> => {
    if (locked) return;
    const errs = formErrors(block, values);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const v = formValues(block, values);
    setPending(true);
    setError(null);
    try {
      await sendFormReply(ctx.roomId, ctx.eventId, formReplyBody(block, v), block.id, v);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      className="mxblocks_form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
      }}
    >
      {block.title ? <span className="mxblocks_title">{block.title}</span> : null}
      {block.fields.map((f) => {
        const id = `${base}-${f.id}`;
        const label = (
          <span id={`${id}-label`} className="mxblocks_formLabel">
            {f.label}
            {f.required ? <span aria-hidden="true"> *</span> : null}
          </span>
        );
        const input = (
          <Input
            field={f}
            id={id}
            value={shown[f.id] ?? null}
            disabled={locked}
            onChange={(v) => {
              setValues((s) => ({ ...s, [f.id]: v }));
              setErrors((s) => {
                const { [f.id]: _, ...rest } = s;
                return rest;
              });
            }}
          />
        );
        return (
          <div key={f.id} className={cx("mxblocks_formField", `mxblocks_formField--${f.kind}`)}>
            {f.kind === "checkbox" ? (
              <label className="mxblocks_check" htmlFor={id}>
                {input}
                {label}
              </label>
            ) : (
              <>
                {f.kind === "radio" ? label : <label htmlFor={id}>{label}</label>}
                {input}
              </>
            )}
            {errors[f.id] ? <span className="mxblocks_error">{errors[f.id]}</span> : null}
          </div>
        );
      })}
      <div className="mxblocks_buttons">
        <button
          type="button"
          className={cx("mxblocks_btn", submitted ? "mxblocks_btn--done" : "mxblocks_btn--primary")}
          disabled={locked}
          aria-pressed={submitted}
          title={allowed ? undefined : `Only ${block.scope?.join(", ")} can answer`}
          onClick={() => void submit()}
        >
          {submitted ? "✓ Submitted" : block.submit.label}
          {pending ? "…" : ""}
        </button>
        {!allowed ? (
          <span className="mxblocks_muted">Only {block.scope?.join(", ")} can answer</span>
        ) : null}
        {error ? <span className="mxblocks_error">{error}</span> : null}
      </div>
    </form>
  );
}
