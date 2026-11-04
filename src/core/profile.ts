import { z } from "zod";
import { idSchema } from "./schema";
import { DEMO_MATERIALS, family, type Material } from "./catalog";

const triple = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
export type EntityModelPart = {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  polygons: [number, number, number, number, number][][];
  omittedPolygons: number;
  children: Record<string, EntityModelPart>;
};
const partSchema: z.ZodType<EntityModelPart> = z.lazy(() =>
  z.object({
    position: triple,
    rotation: triple,
    scale: triple,
    polygons: z
      .array(
        z
          .array(
            z.tuple([
              z.number().finite(),
              z.number().finite(),
              z.number().finite(),
              z.number().finite(),
              z.number().finite(),
            ]),
          )
          .length(4),
      )
      .max(8192),
    omittedPolygons: z.number().int().nonnegative().default(0),
    children: z.record(z.string(), partSchema),
  }),
);
const blockProfileSchema = z.object({
  id: idSchema,
  translationKey: z.string(),
  defaults: z.record(z.string(), z.string()),
  properties: z.record(z.string(), z.array(z.string()).min(1)),
  stateCount: z.number().int().positive(),
  hasBlockEntity: z.boolean(),
  gravity: z.boolean(),
  friction: z.number().finite(),
  blastResistance: z.number().finite(),
  item: idSchema,
  tags: z.array(idSchema).default([]),
  renderShape: z.string().default("MODEL"),
  lightEmission: z.number().int().default(0),
});
const neighborRuleSchema = z
  .object({
    kind: z.enum(["fence", "wall", "gate", "pane", "other"]),
    fence: z.boolean(),
    wooden: z.boolean(),
    wall: z.boolean(),
    forcePost: z.boolean(),
    exception: z.boolean(),
    properties: z.array(z.string().min(1).max(100)).max(32),
    shapes: z.record(
      z.string().max(2048),
      z.tuple([
        z.number().int().min(0).max(15),
        z.number().int().min(0).max(31),
      ]),
    ),
  })
  .strict();
export type NeighborRule = z.infer<typeof neighborRuleSchema>;
export type NeighborRules = Record<string, NeighborRule>;
export const gameProfileSchema = z
  .object({
    schemaVersion: z.literal(1),
    gameVersion: z.literal("26.2"),
    dataVersion: z.literal(4903),
    sourceSha1: z.string().regex(/^[a-f0-9]{40}$/),
    blocks: z.array(blockProfileSchema).min(1).max(10000),
    entities: z
      .array(
        z.object({
          id: idSchema,
          width: z.number().finite().nonnegative(),
          height: z.number().finite().nonnegative(),
          category: z.string(),
          summonable: z.boolean(),
        }),
      )
      .max(10000),
    creativeTabs: z
      .array(
        z.object({ id: idSchema, label: z.string(), items: z.array(idSchema) }),
      )
      .max(100),
    entityModels: z.record(z.string(), partSchema),
    creativeTabsError: z.string().optional(),
    neighborRules: z.record(idSchema, neighborRuleSchema).optional(),
    dyeColors: z
      .record(
        z.string().regex(/^[a-z_]+$/),
        z.number().int().min(0).max(0xffffff),
      )
      .optional(),
  })
  .superRefine((p, ctx) => {
    if (new Set(p.blocks.map((b) => b.id)).size !== p.blocks.length)
      ctx.addIssue({ code: "custom", message: "Trùng block trong profile" });
    for (const b of p.blocks)
      for (const [prop, values] of Object.entries(b.properties))
        if (!values.includes(b.defaults[prop]))
          ctx.addIssue({
            code: "custom",
            message: `Default không hợp lệ: ${b.id}.${prop}`,
          });
    if (p.neighborRules) {
      const entries = Object.entries(p.neighborRules),
        ids = new Set(p.blocks.map((block) => block.id));
      if (
        entries.length > 10000 ||
        entries.reduce(
          (n, [, rule]) => n + Object.keys(rule.shapes).length,
          0,
        ) > 200000
      )
        ctx.addIssue({
          code: "custom",
          message: "Neighbor rules exceed profile limits",
        });
      for (const [id, rule] of entries)
        if (
          !ids.has(id) ||
          new Set(rule.properties).size !== rule.properties.length
        )
          ctx.addIssue({
            code: "custom",
            message: `Invalid neighbor rule: ${id}`,
          });
    }
  });
export type GameProfile = z.infer<typeof gameProfileSchema>;
export function profileMaterials(profile: GameProfile): Material[] {
  return profile.blocks.map((b) => ({
    id: b.id,
    label: b.translationKey,
    family: family(b.id),
    color: DEMO_MATERIALS.find((m) => m.id === b.id)?.color ?? "#a18bad",
    defaults: b.defaults,
    properties: b.properties,
    tags: b.tags,
    creativeTabs: profile.creativeTabs
      .filter((t) => t.items.includes(b.item))
      .map((t) => t.id),
    source: "game-profile",
    hasBlockEntity: b.hasBlockEntity,
    gravity: b.gravity,
    renderShape: b.renderShape,
    lightEmission: b.lightEmission,
  }));
}
