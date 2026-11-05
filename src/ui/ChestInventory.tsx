import { useState } from "react";
import type { Block } from "../core/schema";
import { BASIC_CHEST_ITEMS } from "../core/chest-items";
import "./chest-inventory.css";

type Items = NonNullable<Block["blockEntity"]>["items"];
export function ChestInventory({ cell, disabled, onApply }: {
  cell: Block;
  disabled: boolean;
  onApply: (items: Items) => boolean;
}) {
  const original = cell.blockEntity?.items ?? [];
  const [items, setItems] = useState<Items>(() => structuredClone(original));
  const [slot, setSlot] = useState(0);
  const [error, setError] = useState("");
  const current = items.find((item) => item.slot === slot);
  const dirty = JSON.stringify(items) !== JSON.stringify(original);
  const changeItem = (id: string) => {
    setError("");
    const remaining = items.filter((item) => item.slot !== slot);
    setItems(id ? [...remaining, { slot, id: id as Items[number]["id"], count: current?.count ?? 1 }].sort((a,b) => a.slot-b.slot) : remaining);
  };
  return <section className="editor-section chest-inventory">
    <div className="section-title"><h2>Chest inventory</h2><span>{items.length}/27</span></div>
    <div className="chest-slot-grid" role="group" aria-label="Chest slots">
      {Array.from({ length: 27 }, (_, index) => {
        const item = items.find((entry) => entry.slot === index);
        return <button key={index} type="button" aria-label={`Chest slot ${index + 1}`}
          aria-pressed={slot === index} disabled={disabled}
          title={item ? `${item.id} × ${item.count}` : `Slot ${index+1} · empty`}
          onClick={() => setSlot(index)}>{item ? item.count : "·"}</button>;
      })}
    </div>
    <label>Slot {slot+1}<select aria-label="Chest slot item" disabled={disabled}
      value={current?.id ?? ""} onChange={(event) => changeItem(event.target.value)}>
      <option value="">Empty</option>
      {BASIC_CHEST_ITEMS.map((id) => <option key={id} value={id}>{id.split(":")[1].replaceAll("_", " ")}</option>)}
    </select></label>
    {current && <label>Count<input aria-label="Chest item count" type="number" min={1} max={64} step={1}
      disabled={disabled} value={current.count} onChange={(event) => {
        const count = Number(event.target.value);
        if (!Number.isInteger(count) || count < 1 || count > 64) { setError("Count must be 1–64"); return; }
        setError(""); setItems(items.map((item) => item.slot === slot ? { ...item, count } : item));
      }} /></label>}
    <div className="chest-inventory-actions">
      <button type="button" disabled={disabled || !dirty || !!error} aria-label="Apply chest inventory"
        onClick={() => { if (!onApply(items)) setError("Inventory was not applied. Review the editor message."); }}>Apply</button>
      <button type="button" disabled={disabled || !dirty} aria-label="Reset chest inventory"
        onClick={() => { setItems(structuredClone(original)); setError(""); }}>Reset</button>
    </div>
    {error && <small role="alert">{error}</small>}
    <small title="Plain items only; enchanted, named and other data-component items are rejected on import.">Basic items · no item components</small>
  </section>;
}
