import type { KeyboardEvent } from "react";
import type { MirrorIntent } from "../editor/mirror-plan";
import "./copy-actions.css";

type Props = {
  intent: MirrorIntent;
  onChange: (intent: MirrorIntent) => void;
  valid: boolean;
  error: string;
  cells: number;
  notes: string[];
  onCommit: () => void;
  onCancel: () => void;
};

export function MirrorActionPanel({ intent, onChange, valid, error, cells, notes, onCommit, onCancel }: Props) {
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); onCancel();
    } else if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
      event.preventDefault(); event.stopPropagation(); if (valid) onCommit();
    }
  }
  return <section className="copy-action-panel mirror-action-panel" aria-label="Mirror preview" onKeyDown={onKeyDown}>
    <header className="copy-action-heading"><strong>Mirror</strong>
      {valid && <span role="status">{cells.toLocaleString()} cells</span>}
      <span className="copy-action-world">World</span>
    </header>
    <div className="copy-action-fields">
      <label><span>Plane</span><select aria-label="Mirror plane" value={intent.plane}
        onChange={(event) => onChange({ ...intent, plane: event.target.value as MirrorIntent["plane"] })}>
        <option value="yz">YZ · flip X</option><option value="xy">XY · flip Z</option>
      </select></label>
      <label><span>Pivot</span><select aria-label="Mirror pivot" value={intent.pivotMode}
        onChange={(event) => onChange({ plane: intent.plane, pivotMode: event.target.value as MirrorIntent["pivotMode"],
          ...(event.target.value === "custom" ? { plane2: intent.plane2 ?? 0 } : {}) })}>
        <option value="selection">Selection center</option><option value="active">Object origin</option>
        <option value="individual">Individual origins</option><option value="custom">Custom plane</option>
      </select></label>
      {intent.pivotMode === "custom" && <label><span>{intent.plane === "yz" ? "X" : "Z"} coordinate</span>
        <input aria-label="Mirror plane coordinate" type="number" step={0.5}
          value={intent.plane2 !== undefined && Number.isFinite(intent.plane2) ? intent.plane2 / 2 : ""}
          onChange={(event) => onChange({ ...intent, plane2: event.target.valueAsNumber * 2 })} />
      </label>}
    </div>
    <p className="copy-action-grid-count" title="Reflects the existing selected roots in place. Duplicate first to keep both sides. Only vertical World planes are supported.">
      Reflect selected objects · Duplicate first to keep both sides
    </p>
    {!valid && <p className="copy-action-error" role="alert">{error || "Adjust the plane or selection to create a valid preview."}</p>}
    {!!notes.length && <details className="copy-action-notes"><summary>Notes ({notes.length})</summary>
      <ul>{notes.map((note, index) => <li key={`${index}:${note}`}>{note}</li>)}</ul>
    </details>}
    <footer className="copy-action-footer"><span>Enter confirm · Esc cancel</span>
      <button type="button" aria-label="Cancel mirror action" onClick={onCancel}>Cancel</button>
      <button type="button" className="copy-action-confirm" aria-label="Confirm mirror action" disabled={!valid} onClick={onCommit}>Confirm</button>
    </footer>
  </section>;
}
