/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { Box3, Vector3 } from "three";
import type { ResourcePack } from "../io/resources";
import { gameProfileSchema, profileMaterials } from "../core/profile";
import { createPlacedObject } from "../editor/placement";
import { bakeBlock } from "./block-mesh";
import { ModelResolver } from "./models";

// Optional developer gate: reads user-supplied assets only. No game data is
// copied into fixtures or production output, and CI without the JAR skips it.
const jar = "public/26.2.jar",
  profileFile = "public/generated/26.2.profile.json";
describe.skipIf(!existsSync(jar) || !existsSync(profileFile))(
  "actual Java 26.2 paired assets",
  () => {
    let resolver: ModelResolver;
    let catalog: ReturnType<typeof profileMaterials>;
    beforeAll(() => {
      const files = unzipSync(readFileSync(jar), {
        filter: (entry) =>
          /assets\/minecraft\/(blockstates\/red_bed\.json|models\/block\/(red_bed_(head|foot)|template_bed(_head|_foot)?|block)\.json|textures\/block\/(red_bed_.*|bed_.*)\.png)$/.test(
            entry.name,
          ),
      });
      const pack: ResourcePack = {
        id: "local26.2",
        name: "Local verified client",
        enabled: true,
        gameVersion: "26.2",
        priority: 0,
        files,
        counts: { textures: 0, blockstates: 1, models: 0, entityTextures: 0 },
      };
      resolver = new ModelResolver([pack]);
      catalog = profileMaterials(
        gameProfileSchema.parse(JSON.parse(readFileSync(profileFile, "utf8"))),
      );
    });

    it.each(["north", "east", "south", "west"])(
      "renders %s bed as two real JSON meshes 9/16 blocks high",
      (facing) => {
        const material = catalog.find((m) => m.id === "minecraft:red_bed")!;
        expect(material.hasBlockEntity).toBe(false);
        const object = createPlacedObject(
          { name: material.id, properties: { ...material.defaults, facing } },
          [0, 0, 0],
          catalog,
        );
        const bounds = new Box3(),
          meshes = object.cells.map((cell) => ({
            cell,
            mesh: bakeBlock(resolver.resolve(cell.state, cell.pos), resolver),
          }));
        try {
          for (const { cell, mesh } of meshes) {
            expect(mesh.geometry.getAttribute("position").count).toBe(90);
            expect(
              mesh.surfaces.every((surface) =>
                resolver.files.has(surface.texture),
              ),
            ).toBe(true);
            expect(
              mesh.surfaces.some((surface) =>
                surface.texture.includes("red_bed"),
              ),
            ).toBe(true);
            bounds.union(
              mesh.geometry
                .boundingBox!.clone()
                .translate(new Vector3(...cell.pos).addScalar(0.5)),
            );
          }
          const size = bounds.getSize(new Vector3());
          expect(bounds.min.y).toBeCloseTo(0);
          expect(size.y).toBeCloseTo(9 / 16);
          expect(size.x).toBeCloseTo(
            facing === "east" || facing === "west" ? 2 : 1,
          );
          expect(size.z).toBeCloseTo(
            facing === "north" || facing === "south" ? 2 : 1,
          );
        } finally {
          for (const { mesh } of meshes) mesh.geometry.dispose();
        }
      },
    );

    it("accepts complete footprints using the actual registry for every verified static paired family", () => {
      const ids = [
        "red_bed",
        "oak_door",
        "waxed_oxidized_copper_door",
        "sunflower",
        "small_dripleaf",
        "tall_seagrass",
        "pitcher_plant",
      ];
      for (const id of ids) {
        const material = catalog.find((m) => m.id === `minecraft:${id}`)!;
        const object = createPlacedObject(
          { name: material.id, properties: { ...material.defaults } },
          [0, 0, 0],
          catalog,
        );
        expect(object.cells, id).toHaveLength(2);
      }
    });
  },
);
