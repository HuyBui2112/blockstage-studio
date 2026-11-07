import { useRef, useState } from "react";
import {
  resetEditorViewState,
  setViewYRange,
  type EditorViewState,
} from "../editor/view-state";
import "./view-controls.css";

type YBounds = { min: number; max: number };
export function ViewControls({
  view,
  selection,
  entitySelection = [],
  selectionBounds,
  onChange,
}: {
  view: EditorViewState;
  selection: string[];
  entitySelection?: string[];
  selectionBounds: YBounds | null;
  onChange: (view: EditorViewState) => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const [minimum, setMinimum] = useState(String(view.yRange?.min ?? 0));
  const [maximum, setMaximum] = useState(String(view.yRange?.max ?? 0));
  const [error, setError] = useState("");
  const hasSelection = selection.length > 0 || entitySelection.length > 0;
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
          disabled={!hasSelection}
          onClick={() =>
            change({
              ...view,
              hidden: [...new Set([...view.hidden, ...selection])],
              entityHidden: [...new Set([...(view.entityHidden ?? []), ...entitySelection])],
            })
          }
          aria-label="Hide selected"
        >
          Hide selected
        </button>
        <button
          disabled={!view.hidden.length && !view.entityHidden?.length}
          onClick={() => change({ ...view, hidden: [], entityHidden: [] })}
          aria-label="Show all"
        >
          Show all
        </button>
        <button
          disabled={!hasSelection}
          onClick={() =>
            change({
              ...view,
              locked: [...new Set([...view.locked, ...selection])],
              entityLocked: [...new Set([...(view.entityLocked ?? []), ...entitySelection])],
            })
          }
          aria-label="Lock selected"
        >
          Lock selected
        </button>
        <button
          disabled={!view.locked.length && !view.entityLocked?.length}
          onClick={() => change({ ...view, locked: [], entityLocked: [] })}
          aria-label="Unlock all"
        >
          Unlock all
        </button>
        <button
          disabled={!hasSelection}
          onClick={() => change({ ...view,
            isolated: selection.length ? [...new Set(selection)] : null,
            entityIsolated: entitySelection.length ? [...new Set(entitySelection)] : null,
          })}
          aria-label="Isolate selected"
        >
          Isolate selected
        </button>
        <button
          disabled={view.isolated === null && view.entityIsolated == null}
          onClick={() => change({ ...view, isolated: null, entityIsolated: null })}
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
            title="Show selected block cells and entity anchor Y positions"
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
            Block cells · entity anchor Y · inclusive bounds
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
