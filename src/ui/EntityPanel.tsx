import {
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type { SceneEntity, Vec3 } from "../core/schema";
import type { EntityActionIntent } from "../editor/entity-action";
import { entityEditCapability } from "../editor/entity-operations";
import "./entity-panel.css";

export type EntityPanelProps = {
  entities: SceneEntity[];
  selection: string[];
  previewing: boolean;
  error: string;
  disabled: boolean;
  selectableIds: ReadonlySet<string>;
  onSelect: (id: string, toggle: boolean) => void;
  onPreview: (intent: EntityActionIntent) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

type Action = EntityActionIntent["kind"];
const axes = ["X", "Y", "Z"] as const;

export function EntityPanel({
  entities,
  selection,
  previewing,
  error,
  disabled,
  selectableIds,
  onSelect,
  onPreview,
  onConfirm,
  onCancel,
}: EntityPanelProps) {
  const [action, setAction] = useState<Action>("add");
  const [coordinates, setCoordinates] = useState(["0", "0", "0"]);
  const [yaw, setYaw] = useState("0");
  const [localError, setLocalError] = useState("");
  const [limit, setLimit] = useState(100);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (previewing) confirmRef.current?.scrollIntoView({ block: "nearest" });
  }, [previewing]);
  const selectedIds = new Set(selection);
  const editableSelection =
    selection.length > 0 &&
    selection.every((id) => {
      const entity = entities.find((item) => item.id === id);
      return entity && entityEditCapability(entity.type).supported;
    });
  const canPreview = !disabled && (action === "add" || editableSelection);

  function change() {
    setLocalError("");
    if (previewing) onCancel();
  }

  function preview(event?: FormEvent) {
    event?.preventDefault();
    if (!canPreview) return;
    const needsVector =
      action === "add" || action === "move" || action === "duplicate";
    const needsYaw = action === "add" || action === "yaw";
    const vector = coordinates.map(Number) as Vec3;
    const angle = Number(yaw);
    if (
      (needsVector &&
        coordinates.some(
          (value) => !value.trim() || !Number.isFinite(Number(value)),
        )) ||
      (needsYaw && (!yaw.trim() || !Number.isFinite(angle)))
    ) {
      setLocalError("Enter finite numbers in each field.");
      return;
    }
    setLocalError("");
    if (action === "add") {
      onPreview({
        kind: "add",
        entity: {
          id: crypto.randomUUID(),
          type: "minecraft:pig",
          position: vector,
          yaw: angle,
        },
      });
    } else if (action === "move") onPreview({ kind: "move", delta: vector });
    else if (action === "yaw") onPreview({ kind: "yaw", yaw: angle });
    else if (action === "duplicate")
      onPreview({
        kind: "duplicate",
        newIds: selection.map(() => crypto.randomUUID()),
        offset: vector,
      });
    else onPreview({ kind: "remove" });
  }

  function keyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && previewing) {
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
      preview();
    }
  }

  return (
    <details className="entity-panel" onKeyDown={keyDown}>
      <summary>
        Entities <span>{entities.length}</span>
      </summary>
      <div className="entity-panel-body">
        <div className="entity-panel-list" aria-label="Scene entities">
          {entities.length === 0 && (
            <p className="entity-panel-muted">No entities</p>
          )}
          {entities.slice(0, limit).map((entity) => {
            const capability = entityEditCapability(entity.type);
            return (
              <button
                key={entity.id}
                type="button"
                aria-label={`Select entity ${entity.id}`}
                aria-pressed={selectedIds.has(entity.id)}
                disabled={disabled || !selectableIds.has(entity.id)}
                title={`${entity.id}\n${entity.position.join(", ")} · yaw ${entity.yaw}°\n${capability.supported && !selectableIds.has(entity.id) ? "Outside the current editing view" : capability.reason}`}
                onClick={(event) => {
                  change();
                  onSelect(entity.id, event.shiftKey);
                }}
              >
                <span>
                  {entity.type === "minecraft:pig" ? "Pig" : entity.type}
                </span>
                <small>
                  {capability.supported
                    ? entity.position.join(", ")
                    : "Editing unsupported"}
                </small>
              </button>
            );
          })}
        </div>
        {entities.length > limit && (
          <button type="button" onClick={() => setLimit(limit + 100)}>
            Show more ({entities.length - limit})
          </button>
        )}
        <form onSubmit={preview}>
          <fieldset disabled={disabled}>
            <label className="entity-panel-action">
              Action
              <select
                aria-label="Entity action"
                value={action}
                onChange={(event) => {
                  change();
                  setAction(event.target.value as Action);
                }}
              >
                <option value="add">Add pig</option>
                <option value="move">Move selected</option>
                <option value="yaw">Set selected yaw</option>
                <option value="duplicate">Duplicate selected</option>
                <option value="remove">Delete selected</option>
              </select>
            </label>
            {action !== "add" && (
              <p className="entity-panel-muted">{selection.length} selected</p>
            )}
            {(action === "add" ||
              action === "move" ||
              action === "duplicate") && (
              <>
                <p className="entity-panel-muted">
                  {action === "add" ? "World position" : "World offset"}
                </p>
                <div className="entity-panel-vector">
                  {axes.map((axis, index) => (
                    <label key={axis}>
                      {axis}
                      <input
                        type="number"
                        step="any"
                        aria-label={`Entity ${axis}`}
                        value={coordinates[index]}
                        onChange={(event) => {
                          change();
                          setCoordinates(
                            coordinates.map((value, i) =>
                              i === index ? event.target.value : value,
                            ),
                          );
                        }}
                      />
                    </label>
                  ))}
                </div>
              </>
            )}
            {(action === "add" || action === "yaw") && (
              <label className="entity-panel-action">
                Yaw (degrees)
                <input
                  type="number"
                  step="any"
                  aria-label="Entity yaw"
                  value={yaw}
                  onChange={(event) => {
                    change();
                    setYaw(event.target.value);
                  }}
                />
              </label>
            )}
            <div className="entity-panel-buttons">
              <button
                type="submit"
                aria-label="Preview entity action"
                disabled={!canPreview}
              >
                Preview
              </button>
              {previewing && (
                <>
                  <button
                    ref={confirmRef}
                    type="button"
                    aria-label="Confirm entity action"
                    onClick={onConfirm}
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    aria-label="Cancel entity action"
                    onClick={onCancel}
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>
          </fieldset>
        </form>
        {(localError || error) && (
          <p className="entity-panel-error" role="alert">
            {localError || error}
          </p>
        )}
        {previewing && (
          <p className="entity-panel-muted" role="status">
            Preview pending · Confirm to apply
          </p>
        )}
      </div>
    </details>
  );
}
