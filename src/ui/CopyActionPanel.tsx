import type { KeyboardEvent } from "react";
import type { Vec3 } from "../core/schema";
import type { CopyActionIntent } from "../editor/copy-action";
import "./copy-actions.css";

type CopyActionPanelProps = {
  intent: CopyActionIntent;
  onChange: (intent: CopyActionIntent) => void;
  valid: boolean;
  error: string;
  cells: number;
  notes: string[];
  onCommit: () => void;
  onCancel: () => void;
};

const axes = ["X", "Y", "Z"] as const;
const titles = { duplicate: "Duplicate", paste: "Paste", repeat: "Repeat", "repeat-grid": "Repeat grid" };

export function CopyActionMenu({
  enabled,
  selected,
  hasClipboard,
  onAction,
}: {
  enabled: boolean;
  selected: boolean;
  hasClipboard: boolean;
  onAction: (action: CopyActionIntent["kind"] | "copy") => void;
}) {
  return (
    <details className="copy-action-menu">
      <summary aria-label="Copy tools" title="Duplicate, clipboard and repeat">
        Copy
      </summary>
      <div>
        {(["duplicate", "copy", "paste", "repeat", "repeat-grid"] as const).map((action) => (
          <button
            key={action}
            type="button"
            aria-label={`${action === "repeat-grid" ? "Repeat grid" : action[0].toUpperCase() + action.slice(1)} objects`}
            disabled={
              !enabled || (action === "paste" ? !hasClipboard : !selected)
            }
            title={
              {
                duplicate: "Shift D",
                copy: "Ctrl C",
                paste: "Ctrl V",
                repeat: "Ctrl Shift D",
                "repeat-grid": "Arrange whole selected objects on a World grid",
              }[action]
            }
            onClick={(event) => {
              event.currentTarget.closest("details")?.removeAttribute("open");
              onAction(action);
            }}
          >
            {action === "repeat-grid" ? "Repeat grid" : action[0].toUpperCase() + action.slice(1)}
          </button>
        ))}
      </div>
    </details>
  );
}

export function CopyActionPanel({
  intent,
  onChange,
  valid,
  error,
  cells,
  notes,
  onCommit,
  onCancel,
}: CopyActionPanelProps) {
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
      if (valid) onCommit();
    }
  }

  function changeVector(index: number, value: number) {
    if (intent.kind === "repeat" || intent.kind === "repeat-grid") return;
    const vector: Vec3 = [
      ...(intent.kind === "duplicate" ? intent.delta : intent.position),
    ];
    vector[index] = value;
    onChange(
      intent.kind === "duplicate"
        ? { ...intent, delta: vector }
        : { ...intent, position: vector },
    );
  }

  function changeGrid(field: "counts" | "spacing", index: number, value: number) {
    if (intent.kind !== "repeat-grid") return;
    const vector: Vec3 = [...intent[field]];
    vector[index] = value;
    onChange({ ...intent, [field]: vector });
  }

  let newCopies: number | undefined;
  if (intent.kind === "repeat-grid") {
    let positions = 1;
    for (const count of intent.counts) {
      if (!Number.isSafeInteger(count) || count < 1 || positions > 100001 / count) {
        positions = 0;
        break;
      }
      positions *= count;
    }
    if (positions > 0) newCopies = positions - 1;
  }

  return (
    <section
      className="copy-action-panel"
      aria-label={`${titles[intent.kind]} preview`}
      onKeyDown={onKeyDown}
    >
      <header className="copy-action-heading">
        <strong>{titles[intent.kind]}</strong>
        {valid && (
          <span role="status">
            {cells.toLocaleString()} {cells === 1 ? "cell" : "cells"}
          </span>
        )}
        <span className="copy-action-world">{intent.kind === "repeat-grid" ? "World · numeric" : "World"}</span>
      </header>
      {intent.kind === "repeat-grid" ? (
        <div className="copy-action-grid-repeat">
          <fieldset className="copy-action-vector">
            <legend>Positions · includes original</legend>
            <div className="copy-action-fields">
              {axes.map((axis, index) => (
                <label key={axis}>
                  <span>{axis}</span>
                  <input type="number" min={1} step={1}
                    aria-label={`Grid count ${axis}`}
                    value={Number.isFinite(intent.counts[index]) ? intent.counts[index] : ""}
                    onChange={(event) => changeGrid("counts", index, event.currentTarget.valueAsNumber)} />
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="copy-action-vector">
            <legend>Spacing · signed blocks between anchors</legend>
            <div className="copy-action-fields">
              {axes.map((axis, index) => (
                <label key={axis} title="Use a nonzero integer on axes with more than one position. Negative spacing repeats in the opposite direction.">
                  <span>{axis}</span>
                  <input type="number" step={1}
                    aria-label={`Grid spacing ${axis}`}
                    value={Number.isFinite(intent.spacing[index]) ? intent.spacing[index] : ""}
                    onChange={(event) => changeGrid("spacing", index, event.currentTarget.valueAsNumber)} />
                </label>
              ))}
            </div>
          </fieldset>
          {newCopies !== undefined && <p className="copy-action-grid-count" role="status">
            {newCopies.toLocaleString()} new {newCopies === 1 ? "copy" : "copies"} · original stays in place
          </p>}
        </div>
      ) : intent.kind === "repeat" ? (
        <div className="copy-action-fields copy-action-repeat">
          <label>
            <span>Axis</span>
            <select
              aria-label="Repeat axis"
              value={intent.axis}
              onChange={(event) =>
                onChange({
                  ...intent,
                  axis: event.currentTarget.value as "x" | "y" | "z",
                })
              }
            >
              {axes.map((axis) => (
                <option key={axis} value={axis.toLowerCase()}>
                  {axis}
                </option>
              ))}
            </select>
          </label>
          <label title="Number of new copies; the original stays in place">
            <span>New copies</span>
            <input
              type="number"
              aria-label="Repeat copies"
              min={1}
              step={1}
              value={Number.isFinite(intent.count) ? intent.count : ""}
              onChange={(event) =>
                onChange({
                  ...intent,
                  count: event.currentTarget.valueAsNumber,
                })
              }
            />
          </label>
          <label title="Signed, nonzero anchor-to-anchor spacing in blocks on the World axis">
            <span>Spacing</span>
            <input
              type="number"
              aria-label="Repeat spacing"
              step={1}
              value={Number.isFinite(intent.spacing) ? intent.spacing : ""}
              onChange={(event) =>
                onChange({
                  ...intent,
                  spacing: event.currentTarget.valueAsNumber,
                })
              }
            />
          </label>
        </div>
      ) : (
        <fieldset className="copy-action-vector">
          <legend>{intent.kind === "duplicate" ? "Offset" : "Position"}</legend>
          <div className="copy-action-fields">
            {axes.map((axis, index) => {
              const value = (
                intent.kind === "duplicate" ? intent.delta : intent.position
              )[index];
              return (
                <label key={axis}>
                  <span>{axis}</span>
                  <input
                    type="number"
                    aria-label={`${intent.kind === "duplicate" ? "Copy offset" : "Paste position"} ${axis}`}
                    step={1}
                    value={Number.isFinite(value) ? value : ""}
                    onChange={(event) =>
                      changeVector(index, event.currentTarget.valueAsNumber)
                    }
                  />
                </label>
              );
            })}
          </div>
        </fieldset>
      )}
      {!valid && (
        <p className="copy-action-error" role="alert">
          {error || "Adjust values to create a valid preview."}
        </p>
      )}
      {notes.length > 0 && (
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
        <span title={intent.kind === "repeat-grid"
          ? "Set grid counts and spacing in World axes. Pointer movement does not change the grid. Enter confirms; Escape cancels."
          : "Point/click in the viewport to position. Enter confirms; Escape cancels. Camera navigation remains available."}>
          {intent.kind === "repeat-grid" ? "Set counts and spacing · Enter / Esc" : "Point to position · Enter / Esc"}
        </span>
        <button
          type="button"
          aria-label="Cancel copy action"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="copy-action-confirm"
          aria-label="Confirm copy action"
          disabled={!valid}
          onClick={onCommit}
        >
          Confirm
        </button>
      </footer>
    </section>
  );
}
