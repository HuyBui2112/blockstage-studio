import { useMemo } from "react";
import type { Material } from "../core/catalog";
import { createCapabilityResolver, type CapabilityAction } from "../core/capabilities";
import { resourceName } from "../core/labels";
import type { GameProfile } from "../core/profile";
import type { BlockState } from "../core/schema";
import { assessAppearance } from "../render/appearance-capability";
import type { ModelResolver } from "../render/models";
import { Icon } from "./Icon";
import { CapabilityDetails } from "./CapabilityDetails";

type Props = {
  kind: "block" | "entity";
  id: string;
  state: BlockState;
  profile: GameProfile | null;
  catalog: Material[];
  resolver: ModelResolver;
  onState: (state: BlockState) => void;
  yaw: number;
  onYaw: (yaw: number) => void;
};

export function ResourceInspector(p: Props) {
  const material = p.catalog.find((m) => m.id === p.id);
  const entity = p.profile?.entities.find((e) => e.id === p.id);
  const support = useMemo(() => assessAppearance({
    kind: p.kind, id: p.id, state: p.state, material,
    profile: p.profile, resolver: p.resolver,
  }), [p.kind, p.id, p.profile, p.resolver, p.state, material]);
  const capabilities = useMemo(() => {
    const resolver = createCapabilityResolver(p.catalog, { profile: p.profile ?? undefined });
    const actions: CapabilityAction[] = [
      "registry", "appearance", "design", "context", "translate", "yaw", "mirror",
      "payload-edit", "structure-import", "structure-export", "world",
    ];
    return actions.map((action) => p.kind === "block"
      ? resolver.block(p.state, action, { appearance: support })
      : resolver.entity(p.id, action, { appearance: support }));
  }, [p.catalog, p.profile, p.kind, p.state, p.id, support]);
  const properties = material ? Object.entries(material.properties) : [];

  return (
    <>
      <div className="panel-heading">
        <span>Inspector</span>
        <Icon name="sliders" size={15} />
      </div>
      <div className="inspector-content">
        <div className="asset-identity">
          <div className="asset-type">
            <Icon name={p.kind === "block" ? "cube" : "entity"} size={16} />
            <span>{p.kind === "block" ? "Block" : "Entity"}</span>
            <span className="preview-badge">Preview</span>
          </div>
          <h1>{resourceName(p.id)}</h1>
          <code className="block-id">{p.id}</code>
        </div>
        <section className="appearance-section">
          <h2>Appearance</h2>
          <span
            className={`render-support ${support.status === "supported" ? "supported" : "partial"}`}
            data-status={support.status}
            title={support.reason}
          >
            <Icon name={support.status === "supported" ? "check" : "warning"} size={14} />
            {support.label}
          </span>
          <details className="quiet-details">
            <summary>Rendering details</summary>
            <p>{support.reason}</p>
          </details>
        </section>
        <CapabilityDetails decisions={capabilities} />
        {p.kind === "block" ? (
          <section>
            <div className="section-title">
              <h2>Block state</h2>
              <span>{properties.length || "—"}</span>
            </div>
            {properties.length ? (
              <div className="property-list">
                {properties.map(([name, values]) => (
                  <label className="property-field" key={name}>
                    <span>{name.replaceAll("_", " ")}</span>
                    {values.length === 2 &&
                    values.includes("true") &&
                    values.includes("false") ? (
                      <input
                        type="checkbox"
                        aria-label={name}
                        checked={p.state.properties[name] === "true"}
                        onChange={(event) =>
                          p.onState({
                            ...p.state,
                            properties: {
                              ...p.state.properties,
                              [name]: String(event.target.checked),
                            },
                          })
                        }
                      />
                    ) : (
                      <select
                        aria-label={name}
                        value={p.state.properties[name] ?? ""}
                        onChange={(event) =>
                          p.onState({
                            ...p.state,
                            properties: {
                              ...p.state.properties,
                              [name]: event.target.value,
                            },
                          })
                        }
                      >
                        {!values.includes(p.state.properties[name]) && (
                          <option value={p.state.properties[name] ?? ""}>
                            {p.state.properties[name] ?? "Choose value"}
                          </option>
                        )}
                        {values.map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                    )}
                  </label>
                ))}
              </div>
            ) : (
              <p className="muted compact-note">No state properties</p>
            )}
            {properties.length > 0 && (
              <button
                className="reset-state"
                onClick={() =>
                  p.onState({
                    name: p.id,
                    properties: { ...material!.defaults },
                  })
                }
              >
                <Icon name="refresh" size={12} />
                Reset to default
              </button>
            )}
          </section>
        ) : (
          <section>
            <h2>Orientation</h2>
            <label className="property-field">
              <span>Yaw</span>
              <span className="number-unit">
                <input
                  type="number"
                  aria-label="Entity yaw"
                  step="15"
                  value={p.yaw}
                  onChange={(event) => {
                    const value = event.target.valueAsNumber;
                    if (Number.isFinite(value)) p.onYaw(value);
                  }}
                />
                <span>°</span>
              </span>
            </label>
          </section>
        )}
        <section>
          <h2>Dimensions</h2>
          <div className="dimension-grid">
            <div>
              <span>X</span>
              <strong>
                {p.kind === "block" ? "1" : (entity?.width.toFixed(2) ?? "—")}
              </strong>
            </div>
            <div>
              <span>Y</span>
              <strong>
                {p.kind === "block" ? "1" : (entity?.height.toFixed(2) ?? "—")}
              </strong>
            </div>
            <div>
              <span>Z</span>
              <strong>
                {p.kind === "block" ? "1" : (entity?.width.toFixed(2) ?? "—")}
              </strong>
            </div>
          </div>
          <p className="dimension-caption">
            {p.kind === "block"
              ? "Cell dimensions · blocks"
              : "Registry bounds · blocks"}
          </p>
        </section>
        <section className="technical-section">
          <details className="quiet-details">
            <summary>Registry details</summary>
            <div className="metric-row">
              <span>Source</span>
              <strong>{p.profile ? "Java 26.2" : "Sample registry"}</strong>
            </div>
            <div className="metric-row">
              <span>Data version</span>
              <code>{p.profile?.dataVersion ?? "—"}</code>
            </div>
            {p.kind === "block" && (
              <>
                <div className="metric-row">
                  <span>Render shape</span>
                  <code>{material?.renderShape ?? "Unknown"}</code>
                </div>
                <div className="metric-row">
                  <span>Block entity</span>
                  <strong>
                    {material?.hasBlockEntity === undefined
                      ? "Unknown"
                      : material.hasBlockEntity
                        ? "Yes"
                        : "No"}
                  </strong>
                </div>
                <div className="metric-row">
                  <span>Gravity</span>
                  <strong>
                    {material?.gravity === undefined
                      ? "Unknown"
                      : material.gravity
                        ? "Yes"
                        : "No"}
                  </strong>
                </div>
                {!!material?.tags?.length && (
                  <div className="tag-list">
                    {material.tags.map((tag) => (
                      <span key={tag}>#{tag}</span>
                    ))}
                  </div>
                )}
              </>
            )}
            {p.kind === "entity" && (
              <div className="metric-row">
                <span>Category</span>
                <strong>
                  {entity?.category.replaceAll("_", " ") ?? "Unknown"}
                </strong>
              </div>
            )}
          </details>
        </section>
      </div>
      <div className="inspector-footer">
        <Icon name="eye" size={14} />
        Isolated preview
      </div>
    </>
  );
}
