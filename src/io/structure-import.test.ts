import { describe, it, expect } from "vitest";
import { gzipSync } from "fflate";
import { encodeNbt, exportStructureScene } from "./structure";
import { decodeNbtFile, readNbt, type NbtTag } from "./nbt-reader";
import { inspectStructure } from "./structure-import";
import { DEMO_MATERIALS, type Material } from "../core/catalog";
type Tag = Parameters<typeof encodeNbt>[0];
const integer = (value: number): Tag => ({ type: 3, value }),
  text = (value: string): Tag => ({ type: 8, value }),
  compound = (value: Record<string, Tag>): Tag => ({ type: 10, value }),
  list = (element: number, value: Tag[]): Tag => ({ type: 9, element, value });
const air: Material = {
  id: "minecraft:air",
  label: "Air",
  family: "air",
  color: "#000000",
  properties: {},
  defaults: {},
};
const bed: Material = {
  id: "minecraft:red_bed",
  label: "Bed",
  family: "bed",
  color: "#ff0000",
  properties: {
    facing: ["north", "east", "south", "west"],
    part: ["foot", "head"],
    occupied: ["false", "true"],
  },
  defaults: { facing: "north", part: "foot", occupied: "false" },
};
const catalog = [...DEMO_MATERIALS, air, bed];
function fixture() {
  return compound({
    DataVersion: integer(4903),
    size: list(3, [integer(4), integer(2), integer(4)]),
    palette: list(10, [
      compound({ Name: text("minecraft:stone") }),
      compound({ Name: text("minecraft:air") }),
    ]),
    blocks: list(10, [
      compound({
        state: integer(0),
        pos: list(3, [integer(1), integer(0), integer(1)]),
      }),
      compound({
        state: integer(1),
        pos: list(3, [integer(3), integer(0), integer(3)]),
      }),
    ]),
    entities: list(10, []),
  });
}
const fields = (tag: Tag) =>
  (tag as { type: 10; value: Record<string, Tag> }).value;
const inspect = (tag: Tag) =>
  inspectStructure(
    readNbt(encodeNbt(tag)),
    "Room.nbt",
    "architecture",
    catalog,
  );
describe("bounded Java Structure NBT import", () => {
  it("reads raw/gzip structure and preserves sparse coordinates and explicit air", async () => {
    const raw = encodeNbt(fixture());
    for (const bytes of [raw, gzipSync(raw)]) {
      const result = inspectStructure(
        await decodeNbtFile(bytes),
        "Room.nbt",
        "component",
        catalog,
      );
      expect(result.size).toEqual([4, 2, 4]);
      expect(result.blockCount).toBe(2);
      expect(result.airCount).toBe(1);
      expect(result.document.workspace).toBe("component");
      expect(
        result.document.objects.map((object) => object.cells[0].pos),
      ).toEqual([
        [1, 0, 1],
        [3, 0, 3],
      ]);
      expect(result.document.objects[1].cells[0].state.name).toBe(
        "minecraft:air",
      );
    }
  });
  it("reconstructs complete beds as a single multi-block and rejects incomplete pairs", () => {
    const source = fixture(),
      root = fields(source);
    root.palette = list(
      10,
      ["foot", "head"].map((part) =>
        compound({
          Name: text("minecraft:red_bed"),
          Properties: compound({
            facing: text("south"),
            part: text(part),
            occupied: text("false"),
          }),
        }),
      ),
    );
    root.blocks = list(10, [
      compound({
        state: integer(0),
        pos: list(3, [integer(0), integer(0), integer(0)]),
      }),
      compound({
        state: integer(1),
        pos: list(3, [integer(0), integer(0), integer(1)]),
      }),
    ]);
    const result = inspect(source);
    expect(result.multiBlocks).toBe(1);
    expect(result.document.objects[0].kind).toBe("multiblock");
    root.blocks = list(10, [(root.blocks.value as Tag[])[0]]);
    expect(() => inspect(source)).toThrow("Incomplete");
  });
  it("accepts writer output for the supported subset without changing legal direction state", async () => {
    const file = exportStructureScene(
      {
        name: "Beam",
        target: { gameVersion: "26.2", dataVersion: 4903 },
        blocks: [
          {
            pos: [-8, 4, 7],
            state: { name: "minecraft:oak_log", properties: { axis: "x" } },
          },
        ],
        entities: [],
      },
      catalog,
    );
    const result = inspectStructure(
      await decodeNbtFile(file.bytes),
      "Beam.nbt",
      "architecture",
      catalog,
    );
    expect(result.document.objects[0].cells[0]).toEqual({
      pos: [0, 0, 0],
      state: { name: "minecraft:oak_log", properties: { axis: "x" } },
    });
  });
  it("reconstructs a door and retains explicit stair/slab state without neighbor simulation", () => {
    const source = fixture(),
      root = fields(source);
    const common = {
      facing: "west",
      hinge: "right",
      open: "true",
      powered: "false",
    };
    const states = [
      { name: "minecraft:oak_door", properties: { ...common, half: "lower" } },
      { name: "minecraft:oak_door", properties: { ...common, half: "upper" } },
      {
        name: "minecraft:oak_stairs",
        properties: {
          facing: "east",
          half: "top",
          shape: "inner_left",
          waterlogged: "false",
        },
      },
      {
        name: "minecraft:stone_brick_slab",
        properties: { type: "top", waterlogged: "false" },
      },
    ];
    root.palette = list(
      10,
      states.map((state) =>
        compound({
          Name: text(state.name),
          Properties: compound(
            Object.fromEntries(
              Object.entries(state.properties).map(([key, value]) => [
                key,
                text(value),
              ]),
            ),
          ),
        }),
      ),
    );
    root.blocks = list(
      10,
      [
        [0, 0, 0],
        [0, 1, 0],
        [1, 0, 0],
        [2, 0, 0],
      ].map((pos, index) =>
        compound({ state: integer(index), pos: list(3, pos.map(integer)) }),
      ),
    );
    const door: Material = {
      id: "minecraft:oak_door",
      label: "Door",
      family: "door",
      color: "#000000",
      defaults: {},
      properties: {
        facing: ["north", "south", "east", "west"],
        half: ["lower", "upper"],
        hinge: ["left", "right"],
        open: ["false", "true"],
        powered: ["false", "true"],
      },
    };
    const result = inspectStructure(
      readNbt(encodeNbt(source)),
      "Door.nbt",
      "architecture",
      [...catalog, door],
    );
    expect(result.multiBlocks).toBe(1);
    expect(
      result.document.objects[0].cells.map(
        (cell) => cell.state.properties.half,
      ),
    ).toEqual(["lower", "upper"]);
    expect(result.document.objects[1].cells[0].state).toEqual(states[2]);
    expect(result.document.objects[2].cells[0].state).toEqual(states[3]);
  });
  it("rejects unsupported version, multiple palettes, unknown root fields and entity payload", () => {
    for (const change of [
      (root: Record<string, Tag>) => {
        root.DataVersion = integer(1);
      },
      (root: Record<string, Tag>) => {
        root.palettes = list(9, []);
      },
      (root: Record<string, Tag>) => {
        root.extra = text("do not drop");
      },
      (root: Record<string, Tag>) => {
        root.entities = list(10, [
          compound({ nbt: compound({ id: text("minecraft:pig") }) }),
        ]);
      },
    ]) {
      const source = fixture();
      change(fields(source));
      expect(() => inspect(source)).toThrow();
    }
  });
  it("rejects payload and absent/illegal registry states without silent correction", () => {
    const source = fixture();
    fields((fields(source).blocks.value as Tag[])[0]).nbt = compound({
      id: text("minecraft:chest"),
    });
    expect(() => inspect(source)).toThrow("payload");
    const unknown = fixture();
    fields(unknown).palette = list(10, [
      compound({ Name: text("example:unknown") }),
    ]);
    expect(() => inspect(unknown)).toThrow("Registry missing");
    const invalid = fixture();
    fields(invalid).palette = list(10, [
      compound({
        Name: text("minecraft:oak_log"),
        Properties: compound({ axis: text("diagonal") }),
      }),
    ]);
    expect(() => inspect(invalid)).toThrow();
  });
  it("rejects duplicate/out-of-bounds coordinates and invalid palette indices", () => {
    for (const mutate of [
      (root: Record<string, Tag>) => {
        const b = root.blocks.value as Tag[];
        root.blocks = list(10, [b[0], b[0]]);
      },
      (root: Record<string, Tag>) => {
        fields((root.blocks.value as Tag[])[0]).state = integer(9);
      },
      (root: Record<string, Tag>) => {
        fields((root.blocks.value as Tag[])[0]).pos = list(3, [
          integer(-1),
          integer(0),
          integer(0),
        ]);
      },
      (root: Record<string, Tag>) => {
        root.size = list(3, [integer(2049), integer(1), integer(1)]);
      },
    ]) {
      const source = fixture();
      mutate(fields(source));
      expect(() => inspect(source)).toThrow();
    }
  });
  it("bounds malformed/truncated/trailing input and rejects corrupt gzip checksums", async () => {
    const raw = encodeNbt(fixture());
    expect(() => readNbt(raw.slice(0, -1))).toThrow("Truncated");
    expect(() => readNbt(new Uint8Array([...raw, 0]))).toThrow("Trailing");
    const gzip = gzipSync(raw);
    gzip[gzip.length - 8] ^= 255;
    await expect(decodeNbtFile(gzip)).rejects.toThrow();
    await expect(
      decodeNbtFile(new Uint8Array(16 * 1024 ** 2 + 1)),
    ).rejects.toThrow("16 MiB");
    await expect(
      decodeNbtFile(gzipSync(new Uint8Array(32 * 1024 ** 2 + 1))),
    ).rejects.toThrow("32 MiB");
  });
  it("keeps TAG_Long precision and decodes Java modified UTF-8 NUL/surrogates", () => {
    const raw = new Uint8Array([
      10, 0, 0, 4, 0, 1, 108, 0x7f, 255, 255, 255, 255, 255, 255, 255, 8, 0, 1,
      115, 0, 8, 192, 128, 237, 160, 189, 237, 184, 128, 0,
    ]);
    const value = readNbt(raw).value as Record<string, NbtTag>;
    expect(value.l.value).toBe(9223372036854775807n);
    expect(value.s.value).toBe("\0😀");
    expect(() =>
      readNbt(
        new Uint8Array([10, 0, 0, 9, 0, 1, 120, 3, 255, 255, 255, 255, 0]),
      ),
    ).toThrow("length");
    expect(() =>
      readNbt(
        new Uint8Array([
          10, 0, 0, 3, 0, 1, 120, 0, 0, 0, 0, 3, 0, 1, 120, 0, 0, 0, 1, 0,
        ]),
      ),
    ).toThrow("Duplicate");
  });
});
