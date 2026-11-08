import type { KeyboardEvent } from "react";
import type { WallIntent, WallOpening } from "../editor/wall-plan";
import type { Vec3 } from "../core/schema";
import "./copy-actions.css";
import "./wall-actions.css";

type Props = {
  intent: WallIntent;
  onChange: (intent: WallIntent) => void;
  valid: boolean;
  error: string;
  cells: number;
  notes: string[];
  onCommit: () => void;
  onCancel: () => void;
};
const numericValue = (value: number) => Number.isFinite(value) ? value : "";

export function WallActionPanel({ intent, onChange, valid, error, cells, notes,
  onCommit, onCancel }: Props) {
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); onCancel();
    } else if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
      event.preventDefault(); event.stopPropagation(); if (valid) onCommit();
    }
  }
  function openingChange(id: string, property: keyof Omit<WallOpening, "id">, value: number) {
    onChange({ ...intent, openings: intent.openings.map(opening =>
      opening.id === id ? { ...opening, [property]: value } : opening) });
  }
  function addOpening(kind: "doorway" | "window") {
    if (intent.openings.length >= 32) return;
    onChange({ ...intent, openings: [...intent.openings, {
      id: crypto.randomUUID(), offset: 1, bottom: kind === "doorway" ? 0 : 1,
      width: kind === "doorway" ? 1 : 2, height: kind === "doorway" ? 2 : 1,
    }] });
  }
  return <section className="copy-action-panel wall-action-panel" aria-label="Wall preview" onKeyDown={onKeyDown}>
    <header className="copy-action-heading"><strong>Wall</strong>
      {valid && <span role="status">{cells.toLocaleString()} cells</span>}
      <span className="copy-action-world">World · Design</span>
    </header>
    <div className="copy-action-fields wall-action-fields">
      {(["X", "Y", "Z"] as const).map((axis, index) => <label key={axis}>
        <span>Start {axis}</span><input aria-label={`Wall start ${axis}`} type="number" step={1}
          value={numericValue(intent.start[index])} onChange={event => {
            const start = [...intent.start] as Vec3;
            start[index] = event.target.valueAsNumber;
            onChange({ ...intent, start });
          }} />
      </label>)}
      <label><span>Axis</span><select aria-label="Wall axis" value={intent.axis}
        onChange={event => onChange({ ...intent, axis: event.target.value as WallIntent["axis"] })}>
        <option value="x">X</option><option value="z">Z</option>
      </select></label>
      <label><span>Direction</span><select aria-label="Wall direction" value={intent.direction}
        onChange={event => onChange({ ...intent, direction: Number(event.target.value) as 1 | -1 })}>
        <option value="1">+</option><option value="-1">−</option>
      </select></label>
      <label><span>Length</span><input aria-label="Wall length" type="number" min={1} step={1}
        value={numericValue(intent.length)} onChange={event => onChange({ ...intent, length: event.target.valueAsNumber })} /></label>
      <label><span>Height</span><input aria-label="Wall height" type="number" min={1} step={1}
        value={numericValue(intent.height)} onChange={event => onChange({ ...intent, height: event.target.valueAsNumber })} /></label>
    </div>
    <div className="wall-opening-heading"><span>Openings ({intent.openings.length}/32)</span>
      <button type="button" aria-label="Add doorway" disabled={intent.openings.length >= 32} onClick={() => addOpening("doorway")}>+ Doorway</button>
      <button type="button" aria-label="Add window" disabled={intent.openings.length >= 32} onClick={() => addOpening("window")}>+ Window</button>
    </div>
    {!!intent.openings.length && <div className="wall-openings" aria-label="Wall openings">
      {intent.openings.map((opening, index) => <fieldset className="wall-opening" key={opening.id}>
        <legend>Opening {index + 1}</legend>
        {(["offset", "bottom", "width", "height"] as const).map(property => <label key={property}>
          <span>{property[0].toUpperCase() + property.slice(1)}</span>
          <input aria-label={`Opening ${index + 1} ${property}`} type="number" min={property === "width" || property === "height" ? 1 : 0} step={1}
            value={numericValue(opening[property])} onChange={event => openingChange(opening.id, property, event.target.valueAsNumber)} />
        </label>)}
        <button type="button" aria-label={`Remove opening ${index + 1}`} onClick={() => onChange({ ...intent,
          openings: intent.openings.filter(candidate => candidate.id !== opening.id) })}>Remove</button>
      </fieldset>)}
    </div>}
    <p className="copy-action-grid-count" title="Creates independent blocks using the selected Design state. Openings omit new cells and never remove existing content.">1 cell thick · Openings leave existing blocks intact</p>
    {!valid && <p className="copy-action-error" role="alert">{error || "Adjust wall dimensions or openings to create a valid preview."}</p>}
    {!!notes.length && <details className="copy-action-notes"><summary>Notes ({notes.length})</summary>
      <ul>{notes.map((note, index) => <li key={`${index}:${note}`}>{note}</li>)}</ul>
    </details>}
    <footer className="copy-action-footer"><span>Enter confirm · Esc cancel</span>
      <button type="button" aria-label="Cancel wall action" onClick={onCancel}>Cancel</button>
      <button type="button" className="copy-action-confirm" aria-label="Confirm wall action" disabled={!valid} onClick={onCommit}>Confirm</button>
    </footer>
  </section>;
}
