import { describe, expect, it } from "vitest";
import { strToU8 } from "fflate";
import { ModelResolver, choose, matches, positionHash } from "./models";
import { bakeBlock, lockedIndices } from "./block-mesh";
import {
  FrontSide,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector3,
} from "three";
import type { ResourcePack } from "../io/resources";

function pack(input: Record<string, unknown>, priority = 0): ResourcePack {
  return {
    id: String(priority),
    name: "fixture",
    gameVersion: "26.2",
    enabled: true,
    priority,
    files: Object.fromEntries(
      Object.entries(input).map(([k, v]) => [
        k,
        k.endsWith(".png") ? new Uint8Array([1]) : strToU8(JSON.stringify(v)),
      ]),
    ),
    counts: { textures: 1, models: 1, blockstates: 1, entityTextures: 0 },
  };
}
const root = {
  "assets/minecraft/models/block/cube.json": {
    textures: { all: "minecraft:block/stone" },
    elements: [
      {
        from: [0, 0, 0],
        to: [16, 16, 16],
        faces: Object.fromEntries(
          ["up", "down", "north", "south", "west", "east"].map((d) => [
            d,
            { texture: "#all" },
          ]),
        ),
      },
    ],
  },
  "assets/minecraft/textures/block/stone.png": true,
};
describe("model resource graph", () => {
  it("resolves parent elements and child texture overrides through aliases", () => {
    const resolver = new ModelResolver([
      pack({
        ...root,
        "assets/minecraft/models/block/child.json": {
          parent: "block/cube",
          textures: { all: "#top", top: "minecraft:block/oak" },
        },
        "assets/minecraft/textures/block/oak.png": true,
      }),
    ]);
    const m = resolver.model("block/child");
    expect(m.elements).toHaveLength(1);
    expect(resolver.texture(m, "#all")).toBe(
      "assets/minecraft/textures/block/oak.png",
    );
  });
  it("applies pack overrides across parent and texture lookup", () => {
    const resolver = new ModelResolver([
      pack(root),
      pack({ "assets/minecraft/models/block/cube.json": { elements: [] } }, 1),
    ]);
    expect(resolver.model("block/cube").elements).toEqual([]);
  });
  it("rejects parent cycles, alias cycles and traversal identifiers", () => {
    const resolver = new ModelResolver([
      pack({
        "assets/minecraft/models/block/a.json": { parent: "block/b" },
        "assets/minecraft/models/block/b.json": { parent: "block/a" },
      }),
    ]);
    expect(() => resolver.model("block/a")).toThrow("cycle");
    expect(() =>
      resolver.texture({ textures: { a: "#b", b: "#a" } }, "#a"),
    ).toThrow("cycle");
    expect(() => resolver.model("../secret")).toThrow();
  });
  it("resolves variant selectors and includes every matching multipart", () => {
    const resolver = new ModelResolver([
      pack({
        ...root,
        "assets/minecraft/blockstates/wall.json": {
          multipart: [
            { apply: { model: "block/cube" } },
            {
              when: { OR: [{ north: "low|tall" }, { east: "low" }] },
              apply: { model: "block/cube", y: 90 },
            },
          ],
        },
      }),
    ]);
    expect(
      resolver.resolve({
        name: "minecraft:wall",
        properties: { north: "none", east: "none" },
      }).parts,
    ).toHaveLength(1);
    expect(
      resolver.resolve({
        name: "minecraft:wall",
        properties: { north: "tall", east: "none" },
      }).parts,
    ).toHaveLength(2);
    expect(
      matches(
        { AND: [{ axis: "!x" }, { waterlogged: "false" }] },
        { axis: "y", waterlogged: "false" },
      ),
    ).toBe(true);
  });
  it("selects weighted models deterministically without sharing mutable state", () => {
    const values = [
      { model: "block/a", weight: 1 },
      { model: "block/b", weight: 3 },
    ];
    expect(choose(values, 0).model).toBe("block/a");
    expect(choose(values, 1).model).toBe("block/b");
    expect(positionHash([-16, 3, 22])).toBe(positionHash([-16, 3, 22]));
    expect(() => choose([{ model: "block/a", weight: 0 }], 0)).toThrow();
  });
});
describe("block mesh baking", () => {
  it("renders opposing zero-thickness faces once from each side, without changing standalone planes or solid faces", () => {
    const resolver = new ModelResolver([pack(root)]);
    for (const [axis, face, back] of [
      [0, "west", "east"],
      [1, "down", "up"],
      [2, "north", "south"],
    ] as const) {
      const from: [number, number, number] = [0, 0, 0],
        to: [number, number, number] = [16, 16, 16];
      from[axis] = to[axis] = 8;
      const baked = bakeBlock(
        {
          key: "paired-plane",
          warnings: [],
          parts: [
            {
              application: { model: "fixture" },
              model: {
                textures: { all: "block/stone" },
                elements: [
                  {
                    from,
                    to,
                    faces: {
                      [face]: { texture: "#all" },
                      [back]: { texture: "#all" },
                    },
                  },
                  {
                    from: [0, 0, 0],
                    to: [16, 16, 16],
                    faces: { [face]: { texture: "#all" } },
                  },
                ],
              },
            },
          ],
        },
        resolver,
      );
      expect(baked.surfaces.map((s) => s.singleSided)).toEqual([
        true,
        undefined,
      ]);
      const plane = baked.geometry.clone();
      plane.clearGroups();
      plane.setDrawRange(0, 12);
      const material = new MeshBasicMaterial({ side: FrontSide }),
        mesh = new Mesh(plane, material);
      for (const sign of [-1, 1]) {
        const origin = new Vector3(),
          direction = new Vector3();
        origin.setComponent(axis, sign * 2);
        direction.setComponent(axis, -sign);
        const hits = new Raycaster(origin, direction).intersectObject(mesh);
        expect(hits.length).toBeGreaterThan(0);
        // Both triangles may meet on the ray; every hit must come from the same face.
        expect(
          new Set(hits.map((hit) => Math.floor(hit.faceIndex! / 2))).size,
        ).toBe(1);
      }
      plane.dispose();
      material.dispose();
      baked.geometry.dispose();
      const single = bakeBlock(
        {
          key: "single-plane",
          warnings: [],
          parts: [
            {
              application: { model: "fixture" },
              model: {
                textures: { all: "block/stone" },
                elements: [
                  { from, to, faces: { [face]: { texture: "#all" } } },
                ],
              },
            },
          ],
        },
        resolver,
      );
      expect(single.surfaces[0].singleSided).toBeUndefined();
      single.geometry.dispose();
    }
  });
  it("builds six outward faces with normalized UV and bounds in one block", () => {
    const r = new ModelResolver([
      pack({
        ...root,
        "assets/minecraft/blockstates/stone.json": {
          variants: { "": { model: "block/cube" } },
        },
      }),
    ]);
    const baked = bakeBlock(
      r.resolve({ name: "minecraft:stone", properties: {} }),
      r,
    );
    expect(baked.geometry.getAttribute("position").count).toBe(36);
    expect(baked.geometry.boundingBox!.min.toArray()).toEqual([
      -0.5, -0.5, -0.5,
    ]);
    expect(baked.geometry.boundingBox!.max.toArray()).toEqual([0.5, 0.5, 0.5]);
    const p = baked.geometry.getAttribute("position"),
      n = baked.geometry.getAttribute("normal");
    for (let i = 0; i < p.count; i++)
      expect(
        p.getX(i) * n.getX(i) + p.getY(i) * n.getY(i) + p.getZ(i) * n.getZ(i),
      ).toBeCloseTo(0.5);
    expect(baked.surfaces).toHaveLength(1);
    baked.geometry.dispose();
  });
  it("uses cropped UV on half blocks instead of stretching the full texture", () => {
    const r = new ModelResolver([
      pack({
        ...root,
        "assets/minecraft/models/block/slab.json": {
          parent: "block/cube",
          elements: [
            {
              from: [0, 0, 0],
              to: [16, 8, 16],
              faces: { south: { texture: "#all" } },
            },
          ],
        },
        "assets/minecraft/blockstates/slab.json": {
          variants: { "": { model: "block/slab" } },
        },
      }),
    ]);
    const baked = bakeBlock(
        r.resolve({ name: "minecraft:slab", properties: {} }),
        r,
      ),
      uv = baked.geometry.getAttribute("uv");
    expect(
      Math.max(...Array.from({ length: uv.count }, (_, i) => uv.getY(i))),
    ).toBe(0.5);
    baked.geometry.dispose();
  });
  it("keeps uvlock indices a permutation across all quarter-turn axes", () => {
    for (const x of [0, 90, 180, 270])
      for (const y of [0, 90, 180, 270])
        for (const d of [
          "up",
          "down",
          "north",
          "south",
          "west",
          "east",
        ] as const) {
          const m = new Matrix4()
            .makeRotationY((-y * Math.PI) / 180)
            .multiply(new Matrix4().makeRotationX((-x * Math.PI) / 180));
          expect([...lockedIndices(d, m)].sort()).toEqual([0, 1, 2, 3]);
        }
  });
  it("rotates cropped UV coordinates around the sprite center after face rotation", () => {
    for (const faceRotation of [0, 90]) {
      const r = new ModelResolver([
        pack({
          ...root,
          "assets/minecraft/models/block/crop.json": {
            parent: "block/cube",
            elements: [
              {
                from: [0, 0, 0],
                to: [16, 16, 16],
                faces: {
                  up: {
                    texture: "#all",
                    uv: [2, 4, 6, 12],
                    rotation: faceRotation,
                  },
                },
              },
            ],
          },
          "assets/minecraft/blockstates/crop.json": {
            variants: { "": { model: "block/crop", y: 90, uvlock: true } },
          },
        }),
      ]);
      const baked = bakeBlock(
          r.resolve({ name: "minecraft:crop", properties: {} }),
          r,
        ),
        uv = baked.geometry.getAttribute("uv");
      // 26.2's inverse face transformation sends normalized (u,v) to (1-v,u).
      const expected =
        faceRotation === 0
          ? [
              [0.75, 0.875],
              [0.25, 0.875],
              [0.25, 0.625],
              [0.75, 0.875],
              [0.25, 0.625],
              [0.75, 0.625],
            ]
          : [
              [0.25, 0.875],
              [0.25, 0.625],
              [0.75, 0.625],
              [0.25, 0.875],
              [0.75, 0.625],
              [0.75, 0.875],
            ];
      for (let i = 0; i < uv.count; i++) {
        expect(uv.getX(i)).toBeCloseTo(expected[i][0]);
        expect(uv.getY(i)).toBeCloseTo(expected[i][1]);
      }
      baked.geometry.dispose();
    }
  });
  it("matches the 26.2 game UV oracle for every quarter-turn face orientation", () => {
    // Captured from BlockMath.getFaceTransformation(...).inverse, evaluating
    // normalized UV (.125,.25). Rows: x then y; columns: down/up/north/south/west/east.
    const turns = [
      "000000",
      "310000",
      "220000",
      "130000",
      "022031",
      "021131",
      "020231",
      "023331",
      "002222",
      "132222",
      "222222",
      "312222",
      "202013",
      "203313",
      "200213",
      "201113",
    ];
    const expected = [
      [0.125, 0.75],
      [0.75, 0.875],
      [0.875, 0.25],
      [0.25, 0.125],
    ];
    const resolver = new ModelResolver([pack(root)]);
    for (let x = 0; x < 4; x++)
      for (let y = 0; y < 4; y++)
        for (const [i, direction] of (
          ["down", "up", "north", "south", "west", "east"] as const
        ).entries()) {
          const baked = bakeBlock(
            {
              key: "fixture",
              warnings: [],
              parts: [
                {
                  application: {
                    model: "fixture",
                    x: x * 90,
                    y: y * 90,
                    uvlock: true,
                  },
                  model: {
                    textures: { all: "block/stone" },
                    elements: [
                      {
                        from: [0, 0, 0],
                        to: [16, 16, 16],
                        faces: {
                          [direction]: { texture: "#all", uv: [2, 4, 6, 12] },
                        },
                      },
                    ],
                  },
                },
              ],
            },
            resolver,
          );
          const uv = baked.geometry.getAttribute("uv"),
            point = expected[Number(turns[x * 4 + y][i])];
          expect(uv.getX(0)).toBeCloseTo(point[0]);
          expect(uv.getY(0)).toBeCloseTo(point[1]);
          baked.geometry.dispose();
        }
  });
  it("applies multi-axis element rotations in game X then Y then Z order", () => {
    const r = new ModelResolver([
      pack({
        ...root,
        "assets/minecraft/models/block/turn.json": {
          parent: "block/cube",
          elements: [
            {
              from: [8, 8, 8],
              to: [16, 16, 16],
              rotation: { origin: [8, 8, 8], x: 90, y: 90, z: 0 },
              faces: { south: { texture: "#all" } },
            },
          ],
        },
        "assets/minecraft/blockstates/turn.json": {
          variants: { "": { model: "block/turn" } },
        },
      }),
    ]);
    const baked = bakeBlock(
        r.resolve({ name: "minecraft:turn", properties: {} }),
        r,
      ),
      p = baked.geometry.getAttribute("position");
    // First south corner is (0,8,8) relative to the origin: X turns it
    // into (0,-8,8), then Y into (8,-8,0).
    expect(p.getX(0)).toBeCloseTo(0.5);
    expect(p.getY(0)).toBeCloseTo(-0.5);
    expect(p.getZ(0)).toBeCloseTo(0);
    baked.geometry.dispose();
  });
  it("rescales arbitrary element angles by the rotated basis, including quarter turns", () => {
    for (const angle of [60, 90]) {
      const r = new ModelResolver([
        pack({
          ...root,
          "assets/minecraft/models/block/rescaled.json": {
            parent: "block/cube",
            elements: [
              {
                from: [0, 0, 0],
                to: [16, 16, 16],
                rotation: {
                  origin: [8, 8, 8],
                  axis: "x",
                  angle,
                  rescale: true,
                },
                faces: { up: { texture: "#all" }, down: { texture: "#all" } },
              },
            ],
          },
          "assets/minecraft/blockstates/rescaled.json": {
            variants: { "": { model: "block/rescaled" } },
          },
        }),
      ]);
      const baked = bakeBlock(
        r.resolve({ name: "minecraft:rescaled", properties: {} }),
        r,
      );
      const extent = angle === 90 ? 0.5 : (1 + 1 / Math.sqrt(3)) * 0.5;
      expect(baked.geometry.boundingBox!.min.y).toBeCloseTo(-extent);
      expect(baked.geometry.boundingBox!.max.y).toBeCloseTo(extent);
      expect(baked.geometry.boundingBox!.min.z).toBeCloseTo(-extent);
      expect(baked.geometry.boundingBox!.max.z).toBeCloseTo(extent);
      baked.geometry.dispose();
    }
  });
});
