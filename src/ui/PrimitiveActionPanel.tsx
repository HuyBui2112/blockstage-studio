import { useState, type KeyboardEvent } from "react";
import type { Vec3 } from "../core/schema";
import type { PrimitiveIntent, PrimitiveKind } from "../editor/primitive-plan";
import {
  dimensionAxes, dimensionsFromCorners, primitiveEndFromDimensions,
  type PrimitiveDimensions, type PrimitiveAxis, type PrimitivePlane,
} from "../editor/primitive-dimensions";
import "./copy-actions.css";
import "./primitive-actions.css";

const titles: Record<PrimitiveKind, string> = {
  line: "Line",
  plane: "Plane",
  "solid-box": "Solid box",
  "hollow-box": "Hollow box",
};
const axes = ["X", "Y", "Z"] as const;
export function PrimitiveActionMenu({
  enabled,
  onAction,
  onWall,
}: {
  enabled: boolean;
  onAction: (kind: PrimitiveKind) => void;
  onWall: () => void;
}) {
  return (
    <details className="copy-action-menu primitive-action-menu">
      <summary
        aria-label="Primitive tools"
        title="Build with the selected block Design state"
      >
        Build
      </summary>
      <div>
        {(Object.keys(titles) as PrimitiveKind[]).map((kind) => (
          <button
            type="button"
            key={kind}
            disabled={!enabled}
            aria-label={`Build ${titles[kind].toLowerCase()}`}
            onClick={(event) => {
              event.currentTarget.closest("details")?.removeAttribute("open");
              onAction(kind);
            }}
          >
            {titles[kind]}
          </button>
        ))}
        <button type="button" disabled={!enabled} aria-label="Build wall with openings"
          onClick={(event) => {
            event.currentTarget.closest("details")?.removeAttribute("open");
            onWall();
          }}>Wall with openings</button>
      </div>
    </details>
  );
}
type Props = {
  intent: PrimitiveIntent;
  onChange: (intent: PrimitiveIntent) => void;
  valid: boolean;
  error: string;
  cells: number;
  anchors: number;
  notes: string[];
  onCommit: () => void;
  onCancel: () => void;
  fixed?: boolean;
};
export function PrimitiveActionPanel({
  intent,
  onChange,
  valid,
  error,
  cells,
  anchors,
  notes,
  onCommit,
  onCancel,
  fixed,
}: Props) {
  const [dimensions, setDimensions] = useState(() => dimensionsFromCorners(intent.start, intent.end));
  const sizing = intent.sizing === "dimensions";
  const activeAxes = dimensionAxes(intent.kind, dimensions);
  let dimensionError = "";
  if (sizing) {
    try { primitiveEndFromDimensions(intent.kind, intent.start, dimensions); }
    catch (cause) { dimensionError = cause instanceof Error ? cause.message : "Invalid dimensions"; }
  }
  const canCommit = valid && !dimensionError;
  function publishDimensions(next: PrimitiveDimensions, start = intent.start) {
    setDimensions(next);
    let end: Vec3;
    try { end = primitiveEndFromDimensions(intent.kind, start, next); }
    catch { end = [NaN, NaN, NaN]; }
    onChange({ ...intent, start: [...start], end, sizing: "dimensions" });
  }
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    } else if (
      event.key === "Enter" &&
      event.target instanceof HTMLInputElement &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (canCommit) onCommit();
    }
  }
  function changeVector(field: "start" | "end", index: number, value: number) {
    const vector: Vec3 = [...intent[field]];
    vector[index] = value;
    if (sizing && field === "start") { publishDimensions(dimensions, vector); return; }
    onChange({ ...intent, [field]: vector });
  }
  return (
    <section
      className={`copy-action-panel primitive-action-panel${fixed ? " pointer-region-panel" : ""}`}
      aria-label={`${titles[intent.kind]} preview`}
      onKeyDown={onKeyDown}
    >
      <header className="copy-action-heading">
        <strong>{titles[intent.kind]}</strong>
        {valid && (
          <span role="status">
            {cells.toLocaleString()} cells · {anchors.toLocaleString()} anchors
          </span>
        )}
        <span className="copy-action-world">World · Design</span>
      </header>
      <code className="primitive-action-material">
        {intent.state.name.replace("minecraft:", "")}
      </code>
      <div className="copy-action-fields primitive-sizing-controls">
        <label><span>Sizing</span><select aria-label="Primitive sizing mode" value={sizing ? "dimensions" : "corners"}
          onChange={(event) => {
            if (event.target.value === "dimensions") publishDimensions(dimensionsFromCorners(intent.start, intent.end));
            else onChange({ ...intent, sizing: undefined });
          }}>
          <option value="corners">Start / End</option><option value="dimensions">Dimensions</option>
        </select></label>
        {sizing && intent.kind === "line" && <label><span>World axis</span><select aria-label="Primitive line axis"
          value={dimensions.axis} onChange={(event) => publishDimensions({ ...dimensions, axis: event.target.value as PrimitiveAxis })}>
          {axes.map((axis) => <option key={axis} value={axis.toLowerCase()}>{axis}</option>)}
        </select></label>}
        {sizing && intent.kind === "plane" && <label><span>World plane</span><select aria-label="Primitive plane"
          value={dimensions.plane} onChange={(event) => publishDimensions({ ...dimensions, plane: event.target.value as PrimitivePlane })}>
          {["xy", "xz", "yz"].map((plane) => <option key={plane} value={plane}>{plane.toUpperCase()}</option>)}
        </select></label>}
      </div>
      {((sizing ? ["start"] : ["start", "end"]) as ("start" | "end")[]).map((field) => (
        <fieldset className="copy-action-vector" key={field}>
          <legend>{field === "start" ? "Start" : "End"}</legend>
          <div className="copy-action-fields">
            {axes.map((axis, index) => (
              <label key={axis}>
                <span>{axis}</span>
                <input
                  type="number"
                  step={1}
                  aria-label={`Primitive ${field} ${axis}`}
                  value={
                    Number.isFinite(intent[field][index])
                      ? intent[field][index]
                      : ""
                  }
                  onChange={(event) =>
                    changeVector(
                      field,
                      index,
                      event.currentTarget.valueAsNumber,
                    )
                  }
                />
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      {sizing && <fieldset className="copy-action-vector primitive-dimensions-fields">
        <legend title="Inclusive anchor counts; complete multi-block footprints may extend beyond these dimensions">Dimensions · anchor counts</legend>
        <div className="copy-action-fields">
          {activeAxes.map((index) => <div key={index} className="primitive-dimension-axis"><label><span>{axes[index]} blocks</span>
            <input type="number" min={1} step={1} aria-label={`Primitive size ${axes[index]}`}
              value={Number.isFinite(dimensions.size[index]) ? dimensions.size[index] : ""}
              onChange={(event) => { const size: Vec3 = [...dimensions.size]; size[index] = event.target.valueAsNumber;
                publishDimensions({ ...dimensions, size }); }} /></label>
            <label><span>Direction</span>
            <select aria-label={`Primitive direction ${axes[index]}`} value={dimensions.direction[index]}
              onChange={(event) => { const direction: Vec3 = [...dimensions.direction]; direction[index] = Number(event.target.value);
                publishDimensions({ ...dimensions, direction }); }}>
              <option value={1}>+{axes[index]}</option><option value={-1}>−{axes[index]}</option>
            </select></label>
          </div>)}
        </div>
        {!dimensionError && <small className="primitive-dimensions-end">End · {intent.end.join(", ")} · inclusive</small>}
      </fieldset>}
      {!canCommit && (
        <p className="copy-action-error" role="alert">
          {dimensionError || error || "Adjust endpoints to create a valid preview."}
        </p>
      )}
      {!!notes.length && (
        <details className="copy-action-notes">
          <summary>Notes ({notes.length})</summary>
          <ul>
            {notes.map((note, index) => (
              <li key={`${index}-${note}`}>{note}</li>
            ))}
          </ul>
        </details>
      )}
      <footer className="copy-action-footer">
        <span
          title={
            fixed
              ? "Drag endpoints are fixed. Refine the numeric fields or confirm."
              : "Inclusive integer endpoints. Point or click to stage the end. Enter confirms; Escape cancels."
          }
        >
          {sizing ? "Numeric dimensions · Enter / Esc" : fixed
            ? "Enter confirm · Esc cancel"
            : "Point to set end · Enter / Esc"}
        </span>
        <button
          type="button"
          aria-label="Cancel primitive action"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="copy-action-confirm"
          aria-label="Confirm primitive action"
          disabled={!canCommit}
          onClick={onCommit}
        >
          Confirm
        </button>
      </footer>
    </section>
  );
}
