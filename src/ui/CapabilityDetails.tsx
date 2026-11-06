import type { CapabilityAction, CapabilityDecision } from "../core/capabilities";
import "./capability-details.css";

const labels: Record<CapabilityAction, string> = {
  registry: "Registry",
  appearance: "Appearance",
  design: "Design placement",
  context: "Context placement",
  translate: "Move",
  yaw: "Yaw rotation",
  mirror: "Mirror",
  copy: "Copy",
  remove: "Delete",
  replace: "Material replacement",
  neighbors: "Auto connections",
  support: "Support diagnostics",
  "payload-preserve": "Preserve payload",
  "payload-edit": "Edit payload",
  "payload-copy": "Copy payload",
  "payload-transform": "Transform payload",
  "structure-import": "NBT import",
  "structure-export": "NBT export",
  "datapack-export": "Datapack export",
  world: "World behavior",
};
const statuses: Record<CapabilityDecision["status"], string> = {
  supported: "Supported",
  partial: "Limited",
  unsupported: "Unavailable",
  unverified: "Unverified",
};

export function CapabilityDetails({ decisions }: { decisions: readonly CapabilityDecision[] }) {
  return <details className="quiet-details capability-details">
    <summary>Capabilities</summary>
    <dl>
      {decisions.map((decision) => <div key={decision.action} data-action={decision.action}>
        <dt>{labels[decision.action]}</dt>
        <dd title={decision.reason} data-status={decision.status}>
          <span>{statuses[decision.status]}</span>
          <small>{decision.reason}</small>
        </dd>
      </div>)}
    </dl>
  </details>;
}
