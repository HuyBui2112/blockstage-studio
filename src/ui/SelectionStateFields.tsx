import { useEffect, useRef } from "react";
import type { SharedStateFields } from "../editor/state-edit";

function StateCheckbox({
  property,
  value,
  onChange,
}: {
  property: string;
  value: string | null;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = value === null;
  }, [value]);
  return (
    <span className="state-field-value">
      {value === null && <small className="muted">Mixed</small>}
      <input
        ref={ref}
        type="checkbox"
        aria-label={`State ${property}`}
        aria-checked={value === null ? "mixed" : value === "true"}
        checked={value === "true"}
        onChange={(event) => {
          if (value === null) event.currentTarget.indeterminate = true;
          onChange(String(event.target.checked));
        }}
      />
    </span>
  );
}

export function SelectionStateFields({
  common,
  onChange,
}: {
  common: SharedStateFields;
  onChange: (property: string, value: string) => void;
}) {
  return (
    <section className="editor-section selection-state">
      <h2>Block state</h2>
      <div className="property-list">
        {common.fields.map(({ property, values, value }) => {
          let mixed = "__mixed__";
          while (values.includes(mixed)) mixed += "_";
          return (
            <label className="property-field" key={property}>
              <span>{property.replaceAll("_", " ")}</span>
              {values.length === 2 &&
              values.includes("true") &&
              values.includes("false") ? (
                <StateCheckbox
                  property={property}
                  value={value}
                  onChange={(next) => onChange(property, next)}
                />
              ) : (
                <select
                  aria-label={`State ${property}`}
                  value={value ?? mixed}
                  onChange={(event) => {
                    if (event.target.value !== mixed)
                      onChange(property, event.target.value);
                  }}
                >
                  {value === null && (
                    <option value={mixed} disabled>
                      Mixed
                    </option>
                  )}
                  {values.map((next) => (
                    <option key={next} value={next}>
                      {next}
                    </option>
                  ))}
                </select>
              )}
            </label>
          );
        })}
        {common.reason && <span className="editor-hint">{common.reason}</span>}
      </div>
    </section>
  );
}
