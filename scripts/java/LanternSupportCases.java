import java.util.*;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.Identifier;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.*;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.BlockStateProperties;

/** Finite dry CENTER attachment predicates, independently read from the 26.2 runtime.
 * No assets or extracted shapes are published to the application.
 */
public class LanternSupportCases {
  static final String FULL = "stone stone_bricks cobblestone dirt grass_block coarse_dirt podzol rooted_dirt mycelium clay " +
    "andesite polished_andesite diorite polished_diorite granite polished_granite deepslate cobbled_deepslate polished_deepslate " +
    "deepslate_bricks deepslate_tiles bricks sandstone smooth_sandstone cut_sandstone red_sandstone smooth_red_sandstone " +
    "cut_red_sandstone quartz_block quartz_pillar smooth_quartz chiseled_quartz_block blackstone polished_blackstone " +
    "polished_blackstone_bricks obsidian crying_obsidian iron_block gold_block copper_block glass honey_block soul_sand";
  static final String WOODS = "oak spruce birch jungle acacia cherry dark_oak pale_oak mangrove bamboo crimson warped";
  static Block registered(String id) {
    var name = Identifier.parse("minecraft:" + id);
    if (!BuiltInRegistries.BLOCK.containsKey(name)) throw new IllegalStateException("Missing support block " + id);
    return BuiltInRegistries.BLOCK.getValue(name);
  }
  static List<Map<String, Object>> collect(ServerLevel level) throws Exception {
    var supports = new LinkedHashSet<BlockState>();
    for (String id : FULL.split(" ")) supports.add(registered(id).defaultBlockState());
    for (String wood : WOODS.split(" ")) supports.add(registered(wood + "_planks").defaultBlockState());
    // These exact classes provide the finite material-independent shape adapters.
    for (Block block : BuiltInRegistries.BLOCK) {
      if (block instanceof RotatedPillarBlock && block.getClass().getMethod("getStateForPlacement", net.minecraft.world.item.context.BlockPlaceContext.class).getDeclaringClass() == RotatedPillarBlock.class || block instanceof SlabBlock) {
        for (var state : block.getStateDefinition().getPossibleStates()) {
          if (state.hasProperty(BlockStateProperties.WATERLOGGED) && state.getValue(BlockStateProperties.WATERLOGGED)) continue;
          supports.add(state);
        }
      }
    }
    for (String id : List.of("oak_stairs", "spruce_stairs", "birch_stairs", "stone_brick_stairs", "oak_fence", "stone_brick_wall", "cobblestone_wall")) {
      for (var state : registered(id).getStateDefinition().getPossibleStates()) {
        if (state.hasProperty(BlockStateProperties.WATERLOGGED) && state.getValue(BlockStateProperties.WATERLOGGED)) continue;
        supports.add(state);
      }
    }
    var cases = new ArrayList<Map<String, Object>>();
    // Every state gets the real survival predicate. Tick representative class /
    // direction / outcome cases only, keeping this oracle finite and practical.
    var ticked = new HashSet<String>();
    var target = PlacementOracle.BASE;
    for (Block lantern : List.of(Blocks.LANTERN, Blocks.SOUL_LANTERN)) for (boolean hanging : List.of(false, true)) {
      for (var support : supports) {
        for (var pos : BlockPos.betweenClosed(target.offset(-1, -1, -1), target.offset(1, 1, 1)))
          level.setBlock(pos, Blocks.AIR.defaultBlockState(), Block.UPDATE_CLIENTS);
        var supportPos = target.above(hanging ? 1 : -1);
        level.setBlock(supportPos, support, Block.UPDATE_CLIENTS);
        var candidate = lantern.defaultBlockState().setValue(LanternBlock.HANGING, hanging).setValue(LanternBlock.WATERLOGGED, false);
        boolean survives = candidate.canSurvive(level, target);
        int ticks = ticked.add(lantern + ":" + support.getBlock().getClass().getName() + ":" + hanging + ":" + survives) ? 20 : 0;
        if (survives) level.setBlock(target, candidate, Block.UPDATE_CLIENTS);
        for (int tick = 0; tick < ticks; tick++) level.tick(() -> true);
        var afterTicks = level.getBlockState(target);
        if (survives && !afterTicks.equals(candidate)) throw new IllegalStateException("Supported lantern changed: " + support);
        level.setBlockAndUpdate(supportPos, Blocks.AIR.defaultBlockState());
        for (int tick = 0; tick < ticks; tick++) level.tick(() -> true);
        if (!level.getBlockState(target).isAir()) throw new IllegalStateException("Lantern survived removal: " + support);
        var fixture = new LinkedHashMap<String, Object>();
        fixture.put("block", BuiltInRegistries.BLOCK.getKey(lantern).toString());
        fixture.put("hanging", String.valueOf(hanging));
        fixture.put("support", PlacementOracle.state(support));
        fixture.put("canSurvive", survives);
        fixture.put("ticks", ticks);
        fixture.put("afterTicks", PlacementOracle.state(afterTicks));
        fixture.put("afterSupportRemoval", PlacementOracle.state(level.getBlockState(target)));
        cases.add(fixture);
      }
    }
    return cases;
  }
}
