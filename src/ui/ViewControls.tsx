import { useRef, useState } from "react";
import {
  isolateRoots,
  resetEditorViewState,
  setViewYRange,
  type EditorViewState,
} from "../editor/view-state";
import "./view-controls.css";

type YBounds = { min: number; max: number };
export function ViewControls({
  view,
  selection,
  selectionBounds,
  onChange,
}: {
  view: EditorViewState;
  selection: string[];
  selectionBounds: YBounds | null;
  onChange: (view: EditorViewState) => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const [minimum, setMinimum] = useState(String(view.yRange?.min ?? 0));
  const [maximum, setMaximum] = useState(String(view.yRange?.max ?? 0));
  const [error, setError] = useState("");
  const change = (next: EditorViewState) => {
    onChange(next);
    setError("");
    if (menu.current) menu.current.open = false;
  };
  const applyRange = (range: YBounds | null) => {
    try {
      change(setViewYRange(view, range));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Enter an integer Y range.",
      );
    }
  };
  const apply = () => {
    if (!minimum.trim() || !maximum.trim()) {
      setError("Enter both Y bounds.");
      return;
    }
    applyRange({ min: Number(minimum), max: Number(maximum) });
  };
  return (
    <details
      ref={menu}
      className="object-view-menu"
      onToggle={(event) => {
        if (event.currentTarget.open) {
          setMinimum(String(view.yRange?.min ?? 0));
          setMaximum(String(view.yRange?.max ?? 0));
          setError("");
        }
      }}
    >
      <summary aria-label="View tools">
        View
        {view.yRange && (
          <small className="view-range-indicator">
            Y {view.yRange.min}…{view.yRange.max}
          </small>
        )}
      </summary>
      <div role="group" aria-label="Object visibility">
        <button
          disabled={!selection.length}
          onClick={() =>
            change({
              ...view,
              hidden: [...new Set([...view.hidden, ...selection])],
            })
          }
          aria-label="Hide selected"
        >
          Hide selected
        </button>
        <button
          disabled={!view.hidden.length}
          onClick={() => change({ ...view, hidden: [] })}
          aria-label="Show all"
        >
          Show all
        </button>
        <button
          disabled={!selection.length}
          onClick={() =>
            change({
              ...view,
              locked: [...new Set([...view.locked, ...selection])],
            })
          }
          aria-label="Lock selected"
        >
          Lock selected
        </button>
        <button
          disabled={!view.locked.length}
          onClick={() => change({ ...view, locked: [] })}
          aria-label="Unlock all"
        >
          Unlock all
        </button>
        <button
          disabled={!selection.length}
          onClick={() => change(isolateRoots(view, selection))}
          aria-label="Isolate selected"
        >
          Isolate selected
        </button>
        <button
          disabled={view.isolated === null}
          onClick={() => change({ ...view, isolated: null })}
          aria-label="Exit isolate"
        >
          Exit isolate
        </button>
        <fieldset className="view-y-range">
          <legend>Show Y</legend>
          <div className="view-y-fields">
            <label>
              Min
              <input
                type="number"
                min={-2048}
                max={2048}
                step={1}
                aria-label="Show Y min"
                value={minimum}
                onChange={(event) => {
                  setMinimum(event.target.value);
                  setError("");
                }}
              />
            </label>
            <label>
              Max
              <input
                type="number"
                min={-2048}
                max={2048}
                step={1}
                aria-label="Show Y max"
                value={maximum}
                onChange={(event) => {
                  setMaximum(event.target.value);
                  setError("");
                }}
              />
            </label>
          </div>
          <div className="view-y-actions">
            <button aria-label="Apply Y range" onClick={apply}>
              Apply
            </button>
            <button
              aria-label="Clear Y range"
              disabled={!view.yRange}
              onClick={() => applyRange(null)}
            >
              Clear
            </button>
          </div>
          <button
            aria-label="Focus selected Y"
            disabled={!selectionBounds}
            title="Show the complete selected cell Y bounds"
            onClick={() => {
              if (selectionBounds) applyRange(selectionBounds);
            }}
          >
            Focus selected Y
          </button>
          {error && (
            <small className="view-range-error" role="alert">
              {error}
            </small>
          )}
          <small className="view-range-help">
            Inclusive cells · free entities stay visible
          </small>
        </fieldset>
        <button
          onClick={() => change(resetEditorViewState(view))}
          aria-label="Reset view"
        >
          Reset view
        </button>
      </div>
    </details>
  );
}
