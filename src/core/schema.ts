import { z } from "zod";

export const idSchema = z.string().regex(/^[a-z0-9_.-]+:[a-z0-9_./-]+$/);
export const vecSchema = z.tuple([
  z.number().int().min(-30000000).max(30000000),
  z.number().int().min(-2048).max(2048),
  z.number().int().min(-30000000).max(30000000),
]);
export const stateSchema = z
  .object({
    name: idSchema,
    properties: z
      .record(
        z.string().regex(/^[a-z0-9_]+$/),
        z.string().regex(/^[a-z0-9_-]+$/),
      )
      .default({}),
  })
  .strict();
export const blockSchema = z
  .object({ pos: vecSchema, state: stateSchema })
  .strict();
export const componentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  category: z.enum(["column", "wall", "gate", "floor", "decoration", "custom"]),
  blocks: z.array(blockSchema).min(1).max(100000),
});
export const instanceSchema = z.object({
  id: z.string(),
  componentId: z.string(),
  position: vecSchema,
  rotation: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  substitutions: z.record(z.string(), idSchema).default({}),
});
export const entitySchema = z
  .object({
    id: z.string().min(1),
    type: idSchema,
    position: z.tuple([
      z.number().finite().min(-30000000).max(30000000),
      z.number().finite().min(-2048).max(2048),
      z.number().finite().min(-30000000).max(30000000),
    ]),
    yaw: z.number().finite().min(-360).max(360).default(0),
  })
  .strict();
export const projectSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string(),
    name: z.string().min(1).max(120),
    target: z.object({
      gameVersion: z.literal("26.2"),
      dataVersion: z.literal(4903),
    }),
    components: z.array(componentSchema).max(1000),
    instances: z.array(instanceSchema).max(10000),
    blocks: z.array(blockSchema).max(100000),
    entities: z.array(entitySchema).max(1000).default([]),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (new Set(p.components.map((c) => c.id)).size !== p.components.length)
      ctx.addIssue({ code: "custom", message: "ID thành phần bị trùng" });
    if (new Set(p.instances.map((i) => i.id)).size !== p.instances.length)
      ctx.addIssue({ code: "custom", message: "ID instance bị trùng" });
    if (new Set(p.entities.map((i) => i.id)).size !== p.entities.length)
      ctx.addIssue({ code: "custom", message: "ID entity bị trùng" });
    if (
      p.instances.some((i) => !p.components.some((c) => c.id === i.componentId))
    )
      ctx.addIssue({
        code: "custom",
        message: "Instance tham chiếu thành phần không tồn tại",
      });
    if (
      p.blocks.length +
        p.instances.reduce(
          (n, i) =>
            n +
            (p.components.find((c) => c.id === i.componentId)?.blocks.length ??
              0),
          0,
        ) >
      100000
    )
      ctx.addIssue({
        code: "custom",
        message: "Bản nền giới hạn 100.000 block/công trình",
      });
  });
export type Vec3 = z.infer<typeof vecSchema>;
export type BlockState = z.infer<typeof stateSchema>;
export type Block = z.infer<typeof blockSchema>;
export type Component = z.infer<typeof componentSchema>;
export type Instance = z.infer<typeof instanceSchema>;
export type Project = z.infer<typeof projectSchema>;
export type SceneEntity = z.infer<typeof entitySchema>;
export type SceneBlock = Block & { owner: string };
export const key = (p: Vec3) => p.join(",");
export const stateKey = (s: BlockState) =>
  s.name +
  JSON.stringify(
    Object.entries(s.properties).sort(([a], [b]) => a.localeCompare(b)),
  );

export function uniqueBlocks(blocks: Block[]): Block[] {
  const seen = new Set<string>();
  for (const block of blocks) {
    if (seen.has(key(block.pos)))
      throw new Error(`Trùng block tại ${key(block.pos)}`);
    seen.add(key(block.pos));
  }
  return blocks;
}
