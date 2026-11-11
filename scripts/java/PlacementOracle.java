import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import com.google.gson.GsonBuilder;
import com.mojang.authlib.GameProfile;
import net.minecraft.SharedConstants;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.Identifier;
import net.minecraft.tags.BlockTags;
import net.minecraft.gametest.framework.GameTestServer;
import net.minecraft.nbt.NbtUtils;
import net.minecraft.server.Bootstrap;
import net.minecraft.server.level.ClientInformation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.packs.repository.PackRepository;
import net.minecraft.server.packs.repository.ServerPacksSource;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.context.BlockPlaceContext;
import net.minecraft.world.level.WorldDataConfiguration;
import net.minecraft.world.flag.FeatureFlags;
import net.minecraft.world.level.block.*;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.*;
import net.minecraft.world.level.storage.LevelStorageSource;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;

/** Bounded actual 26.2 placement contexts, independent of editor implementation. */
public class PlacementOracle {
  static final BlockPos BASE = new BlockPos(0, 80, 0);
  static Block bed() { return BuiltInRegistries.BLOCK.getValue(Identifier.parse("minecraft:red_bed")); }
  static Map<String, Object> state(BlockState state) {
    if (state == null) return Map.of("null", true);
    var tag = NbtUtils.writeBlockState(state);
    var properties = new TreeMap<String, String>();
    var values = tag.getCompoundOrEmpty("Properties");
    for (String key : values.keySet()) properties.put(key, values.getStringOr(key, ""));
    return Map.of("name", tag.getStringOr("Name", ""), "properties", properties);
  }
  static List<Integer> pos(BlockPos pos) { return List.of(pos.getX(), pos.getY(), pos.getZ()); }
  static List<Double> point(Vec3 point) { return List.of(point.x, point.y, point.z); }
  static Map<String, Object> placement(ServerLevel level, ServerPlayer player, Block block, Direction face, double height, float yaw, double localX, double localZ) {
    return placement(level, player, block, face, height, yaw, localX, localZ, Blocks.STONE.defaultBlockState());
  }
  static Map<String, Object> placement(ServerLevel level, ServerPlayer player, Block block, Direction face, double height, float yaw, double localX, double localZ, BlockState support) {
    // Every case starts dry, unpowered and away from neighboring special blocks.
    for (var pos : BlockPos.betweenClosed(BASE.offset(-2, -2, -2), BASE.offset(2, 3, 2))) level.setBlock(pos, Blocks.AIR.defaultBlockState(), Block.UPDATE_CLIENTS);
    var clicked = BASE.relative(face.getOpposite());
    level.setBlock(clicked, support, Block.UPDATE_CLIENTS);
    player.setYRot(yaw); player.setXRot(0);
    // Construct a point genuinely on the clicked stone face. Side-click height
    // is relative to the new cell, including its strict half-height boundary.
    var hit = new Vec3(BASE.getX() + (face == Direction.EAST ? 0 : face == Direction.WEST ? 1 : localX),
      BASE.getY() + (face == Direction.UP ? 0 : face == Direction.DOWN ? 1 : height),
      BASE.getZ() + (face == Direction.SOUTH ? 0 : face == Direction.NORTH ? 1 : localZ));
    var context = new BlockPlaceContext(player, InteractionHand.MAIN_HAND, new ItemStack(block.asItem()), new BlockHitResult(hit, face, clicked, false));
    if (!context.getClickedPos().equals(BASE)) throw new IllegalStateException("Context did not resolve adjacent target");
    var result = block.getStateForPlacement(context);
    var entry = new LinkedHashMap<String, Object>();
    entry.put("block", BuiltInRegistries.BLOCK.getKey(block).toString()); entry.put("face", face.getName());
    entry.put("target", pos(BASE)); entry.put("clicked", pos(clicked)); entry.put("point", point(hit));
    // Vanilla's trigonometric lookup table quantizes getLookAngle. Preserve it
    // as evidence, but send the editor the exact mathematical camera direction
    // represented by the player's yaw, rather than losing boundary information.
    double radians = Math.toRadians(yaw);
    double lookX = -Math.sin(radians), lookZ = Math.cos(radians);
    if ((yaw % 90) == 0) { lookX = Math.rint(lookX); lookZ = Math.rint(lookZ); }
    if (Math.abs(yaw % 90) == 45) { lookX = Math.copySign(1, lookX); lookZ = Math.copySign(1, lookZ); }
    entry.put("yaw", yaw); entry.put("look", List.of(lookX, 0.0, lookZ)); entry.put("gameLook", point(player.getLookAngle())); entry.put("horizontalDirection", context.getHorizontalDirection().getName());
    entry.put("state", state(result));
    entry.put("support", state(support));
    return entry;
  }
  static List<Map<String, Object>> lanternAttachments(ServerLevel level, ServerPlayer player) {
    var cases = new ArrayList<Map<String, Object>>();
    var supports = new ArrayList<BlockState>();
    supports.add(Blocks.STONE.defaultBlockState());
    for (Block block : BuiltInRegistries.BLOCK) if (block instanceof ChainBlock) {
      for (Direction.Axis axis : Direction.Axis.values()) supports.add(block.defaultBlockState().setValue(ChainBlock.AXIS, axis));
    }
    for (Block lantern : List.of(Blocks.LANTERN, Blocks.SOUL_LANTERN)) for (BlockState support : supports) {
      for (Direction face : Direction.values()) {
        var entry = placement(level, player, lantern, face, 0.5, 0, 0.5, 0.5, support);
        var clicked = BASE.relative(face.getOpposite());
        var hit = new Vec3(BASE.getX() + (face == Direction.EAST ? 0 : face == Direction.WEST ? 1 : 0.5), BASE.getY() + (face == Direction.UP ? 0 : face == Direction.DOWN ? 1 : 0.5), BASE.getZ() + (face == Direction.SOUTH ? 0 : face == Direction.NORTH ? 1 : 0.5));
        var context = new BlockPlaceContext(player, InteractionHand.MAIN_HAND, new ItemStack(lantern.asItem()), new BlockHitResult(hit, face, clicked, false));
        var expected = lantern.getStateForPlacement(context);
        boolean placed = ((BlockItem) lantern.asItem()).place(context).consumesAction();
        if (placed != (expected != null)) throw new IllegalStateException("Unexpected lantern item placement result");
        entry.put("itemPlaced", placed);
        entry.put("readback", state(level.getBlockState(BASE)));
        for (int tick = 0; tick < 20; tick++) level.tick(() -> true);
        entry.put("ticks", 20);
        entry.put("afterTicks", state(level.getBlockState(BASE)));
        if (placed && !level.getBlockState(BASE).equals(expected)) throw new IllegalStateException("Lantern changed while supported");
        if (!level.getBlockState(clicked).equals(support)) throw new IllegalStateException("Lantern overwrote its support");
        level.setBlockAndUpdate(clicked, Blocks.AIR.defaultBlockState());
        for (int tick = 0; tick < 20; tick++) level.tick(() -> true);
        entry.put("afterSupportRemoval", state(level.getBlockState(BASE)));
        if (!level.getBlockState(BASE).isAir()) throw new IllegalStateException("Lantern survived support removal");
        cases.add(entry);
      }
    }
    return cases;
  }
  static List<Map<String, Object>> support(ServerLevel level) {
    var result = new ArrayList<Map<String, Object>>();
    int i = 0;
    for (Block plant : List.of(Blocks.SUNFLOWER, Blocks.LILAC, Blocks.ROSE_BUSH, Blocks.PEONY, Blocks.TALL_GRASS, Blocks.LARGE_FERN, Blocks.PITCHER_PLANT)) {
      for (Block below : List.of(Blocks.AIR, Blocks.STONE, Blocks.DIRT, Blocks.GRASS_BLOCK, Blocks.COARSE_DIRT, Blocks.ROOTED_DIRT, Blocks.PODZOL, Blocks.MYCELIUM, Blocks.FARMLAND, Blocks.MOSS_BLOCK, Blocks.PALE_MOSS_BLOCK, Blocks.MUD, Blocks.MUDDY_MANGROVE_ROOTS, Blocks.CLAY)) {
        var p = BASE.offset(20 + (i % 10) * 3, 0, 20 + (i++ / 10) * 3);
        level.setBlock(p.below(), below.defaultBlockState(), Block.UPDATE_CLIENTS);
        var lower = plant.defaultBlockState().setValue(DoublePlantBlock.HALF, DoubleBlockHalf.LOWER);
        result.add(Map.of("name", BuiltInRegistries.BLOCK.getKey(plant) + "-on-" + BuiltInRegistries.BLOCK.getKey(below), "block", BuiltInRegistries.BLOCK.getKey(plant).toString(), "below", BuiltInRegistries.BLOCK.getKey(below).toString(), "canSurvive", lower.canSurvive(level, p)));
      }
    }
    var footPos = BASE.offset(5, 3, 5);
    var foot = bed().defaultBlockState().setValue(BedBlock.FACING, Direction.SOUTH).setValue(BedBlock.PART, BedPart.FOOT);
    var head = foot.setValue(BedBlock.PART, BedPart.HEAD);
    level.setBlock(footPos, foot, Block.UPDATE_CLIENTS);
    level.setBlock(footPos.south(), head, Block.UPDATE_CLIENTS);
    boolean canSurvive = foot.canSurvive(level, footPos) && head.canSurvive(level, footPos.south());
    // Neighbor updates, including removing both below cells, must reach the pair.
    level.setBlockAndUpdate(footPos.below(), Blocks.STONE.defaultBlockState());
    level.setBlockAndUpdate(footPos.south().below(), Blocks.STONE.defaultBlockState());
    level.setBlockAndUpdate(footPos.below(), Blocks.AIR.defaultBlockState());
    level.setBlockAndUpdate(footPos.south().below(), Blocks.AIR.defaultBlockState());
    for (int tick = 0; tick < 20; tick++) level.tick(() -> true);
    result.add(Map.of("name", "floating-bed-pair", "canSurvive", canSurvive, "ticks", 20, "survivesAfterTicks", level.getBlockState(footPos).equals(foot) && level.getBlockState(footPos.south()).equals(head), "foot", state(level.getBlockState(footPos)), "head", state(level.getBlockState(footPos.south()))));
    var doorPos = BASE.offset(8, 3, 5);
    for (Block below : List.of(Blocks.AIR, Blocks.STONE, Blocks.OAK_SLAB)) {
      level.setBlock(doorPos.below(), below.defaultBlockState(), Block.UPDATE_CLIENTS);
      result.add(Map.of("name", "oak-door-on-" + BuiltInRegistries.BLOCK.getKey(below), "canSurvive", Blocks.OAK_DOOR.defaultBlockState().canSurvive(level, doorPos)));
    }
    return result;
  }
  static List<Map<String,Object>> neighborCases(ServerLevel level) {
    var result=new ArrayList<Map<String,Object>>();
    var p=BASE.offset(40,0,40);
    var dirs=List.of(Direction.NORTH,Direction.EAST,Direction.SOUTH,Direction.WEST);
    var neighbors=new ArrayList<BlockState>();
    for(Block block:List.of(Blocks.AIR,Blocks.STONE,Blocks.GLASS,Blocks.OAK_LEAVES,Blocks.OAK_FENCE,Blocks.SPRUCE_FENCE,Blocks.NETHER_BRICK_FENCE,Blocks.COBBLESTONE_WALL,Blocks.IRON_BARS,Blocks.GLASS_PANE,Blocks.BARRIER,Blocks.FLOWER_POT,Blocks.IRON_CHAIN))neighbors.add(block.defaultBlockState());
    for(var state:Blocks.OAK_FENCE_GATE.getStateDefinition().getPossibleStates()) if(!state.getValue(FenceGateBlock.OPEN)&&!state.getValue(FenceGateBlock.POWERED)&&!state.getValue(FenceGateBlock.IN_WALL))neighbors.add(state);
    for(var state:Blocks.OAK_SLAB.getStateDefinition().getPossibleStates())if(!state.getValue(SlabBlock.WATERLOGGED))neighbors.add(state);
    for(var state:Blocks.OAK_STAIRS.getStateDefinition().getPossibleStates())if(!state.getValue(StairBlock.WATERLOGGED)&&state.getValue(StairBlock.SHAPE)==StairsShape.STRAIGHT)neighbors.add(state);
    for(Block center:List.of(Blocks.OAK_FENCE,Blocks.NETHER_BRICK_FENCE,Blocks.COBBLESTONE_WALL))for(var neighbor:neighbors)for(var dir:dirs){
      var input=new LinkedHashMap<BlockPos,BlockState>(); input.put(p,center.defaultBlockState());input.put(p.relative(dir),neighbor);
      result.add(neighborCase(level,p,input,"single-"+result.size()));
    }
    var above=new ArrayList<BlockState>();above.add(Blocks.AIR.defaultBlockState());above.add(Blocks.STONE.defaultBlockState());above.add(Blocks.FLOWER_POT.defaultBlockState());
    for(var state:Blocks.OAK_SLAB.getStateDefinition().getPossibleStates())if(!state.getValue(SlabBlock.WATERLOGGED))above.add(state);
    above.add(Blocks.COBBLESTONE_WALL.defaultBlockState());above.add(Blocks.COBBLESTONE_WALL.defaultBlockState().setValue(WallBlock.UP,false));
    for(int mask=0;mask<16;mask++)for(var cover:above){
      var input=new LinkedHashMap<BlockPos,BlockState>();input.put(p,Blocks.COBBLESTONE_WALL.defaultBlockState());input.put(p.above(),cover);
      for(int i=0;i<4;i++)if((mask&(1<<i))!=0)input.put(p.relative(dirs.get(i)),Blocks.COBBLESTONE_WALL.defaultBlockState());
      result.add(neighborCase(level,p,input,"wall-cover-"+mask+"-"+result.size()));
    }
    for(Block block:BuiltInRegistries.BLOCK)if(block instanceof FenceBlock || block instanceof WallBlock || block instanceof FenceGateBlock){
      var input=new LinkedHashMap<BlockPos,BlockState>();input.put(p,block.defaultBlockState());
      for(var dir:dirs)input.put(p.relative(dir),Blocks.COBBLESTONE_WALL.defaultBlockState());input.put(p.above(),Blocks.STONE.defaultBlockState());
      result.add(neighborCase(level,p,input,"family-"+BuiltInRegistries.BLOCK.getKey(block)));
    }
    return result;
  }
  static Map<String,Object> neighborCase(ServerLevel level,BlockPos p,Map<BlockPos,BlockState> input,String name){
    for(var q:BlockPos.betweenClosed(p.offset(-2,-1,-2),p.offset(2,3,2)))level.setBlock(q,Blocks.AIR.defaultBlockState(),Block.UPDATE_CLIENTS);
    for(var entry:input.entrySet())level.setBlock(entry.getKey(),entry.getValue(),Block.UPDATE_CLIENTS);
    for(int pass=0;pass<3;pass++)for(var q:BlockPos.betweenClosed(p.offset(-2,-1,-2),p.offset(2,3,2)))level.getBlockState(q).updateNeighbourShapes(level,q,Block.UPDATE_ALL,512);
    var immediate=new ArrayList<Map<String,Object>>();
    for(var entry:input.entrySet())if(entry.getValue().getBlock() instanceof FenceBlock || entry.getValue().getBlock() instanceof WallBlock || entry.getValue().getBlock() instanceof FenceGateBlock)immediate.add(Map.of("pos",pos(entry.getKey().subtract(p)),"state",state(level.getBlockState(entry.getKey()))));
    for(int tick=0;tick<20;tick++)level.tick(()->true);
    var after=new ArrayList<Map<String,Object>>();for(var entry:input.entrySet())if(entry.getValue().getBlock() instanceof FenceBlock || entry.getValue().getBlock() instanceof WallBlock || entry.getValue().getBlock() instanceof FenceGateBlock)after.add(Map.of("pos",pos(entry.getKey().subtract(p)),"state",state(level.getBlockState(entry.getKey()))));
    var cells=new ArrayList<Map<String,Object>>();for(var entry:input.entrySet())cells.add(Map.of("pos",pos(entry.getKey().subtract(p)),"state",state(entry.getValue())));
    return Map.of("name",name,"input",cells,"readback",immediate,"afterTicks",after,"ticks",20);
  }
  public static void main(String[] args) {
    int status = 0;
    try { run(Path.of(args[0])); } catch (Throwable error) { error.printStackTrace(); status = 1; }
    System.exit(status);
  }
  static void run(Path output) throws Exception {
    SharedConstants.tryDetectVersion(); Bootstrap.bootStrap();
    if (!SharedConstants.getCurrentVersion().name().equals("26.2") || SharedConstants.getCurrentVersion().dataVersion().version() != 4903) throw new IllegalStateException("Expected 26.2 / 4903");
    var storage = LevelStorageSource.createDefault(output.resolve("saves"));
    var access = storage.createAccess("placement-fixture");
    var discovered = ServerPacksSource.createPackRepository(access);
    var packs = new PackRepository(consumer -> { discovered.reload(); consumer.accept(discovered.getPack("vanilla")); });
    GameTestServer server = null;
    try {
      server = GameTestServer.create(Thread.currentThread(), access, packs, Optional.empty(), false, 0);
      var config = server.getWorldData().getDataConfiguration();
      server.getWorldData().setDataConfiguration(new WorldDataConfiguration(config.dataPacks(), FeatureFlags.DEFAULT_FLAGS));
      var init = GameTestServer.class.getDeclaredMethod("initServer"); init.setAccessible(true);
      if (!(boolean) init.invoke(server)) throw new IllegalStateException("GameTest initialization failed");
      var level = server.overworld();
      if (!level.enabledFeatures().equals(FeatureFlags.DEFAULT_FLAGS) || !new HashSet<>(packs.getSelectedIds()).equals(Set.of("vanilla"))) throw new IllegalStateException("Unexpected feature flags/packs");
      var player = new ServerPlayer(server, level, new GameProfile(UUID.fromString("353a52dd-921b-4690-85e6-4e50edbe6a39"), "PlacementOracle"), ClientInformation.createDefault());
      var cases = new ArrayList<Map<String, Object>>();
      for (Direction face : Direction.values()) cases.add(placement(level, player, Blocks.OAK_LOG, face, 0.5, 0, 0.5, 0.5));
      for (Block block : List.of(Blocks.STONE_BRICK_SLAB, Blocks.OAK_STAIRS)) {
        for (Direction face : Direction.values()) for (double height : List.of(0.499999, 0.5, 0.500001)) cases.add(placement(level, player, block, face, height, 0, 0.5, 0.5));
      }
      for (Block block : List.of(Blocks.OAK_STAIRS, bed(), Blocks.OAK_DOOR)) {
        for (float yaw : new float[] {-180, -135, -90, -45.001F, -45, -44.999F, 0, 44.999F, 45, 45.001F, 90, 134.999F, 135, 135.001F, 180, 225}) cases.add(placement(level, player, block, Direction.UP, 0, yaw, 0.5, 0.5));
      }
      for (float yaw : new float[] {0, 90, 180, 270}) for (double localX : List.of(0.25, 0.5, 0.75)) for (double localZ : List.of(0.25, 0.5, 0.75)) cases.add(placement(level, player, Blocks.OAK_DOOR, Direction.UP, 0, yaw, localX, localZ));
      for (Block block : BuiltInRegistries.BLOCK) {
        if (block instanceof ChainBlock) for (Direction face : Direction.values()) cases.add(placement(level, player, block, face, 0.5, 0, 0.5, 0.5));
        if (block instanceof LanternBlock) for (Direction face : List.of(Direction.UP, Direction.DOWN)) cases.add(placement(level, player, block, face, 0.5, 0, 0.5, 0.5));
      }
      var families = new TreeMap<String, List<String>>();
      for (String family : List.of("axis", "slab", "stairs", "bed", "door", "chain", "lantern")) families.put(family, new ArrayList<>());
      for (Block block : BuiltInRegistries.BLOCK) {
        String family = block instanceof ChainBlock ? "chain" : block instanceof LanternBlock ? "lantern" : block instanceof RotatedPillarBlock && block.getClass().getMethod("getStateForPlacement", BlockPlaceContext.class).getDeclaringClass() == RotatedPillarBlock.class ? "axis" : block instanceof SlabBlock ? "slab" : block instanceof StairBlock ? "stairs" : block instanceof BedBlock ? "bed" : block instanceof DoorBlock ? "door" : null;
        if (family != null) families.get(family).add(BuiltInRegistries.BLOCK.getKey(block).toString());
      }
      families.values().forEach(Collections::sort);
      var report = new LinkedHashMap<String, Object>();
      report.put("gameVersion", "26.2"); report.put("dataVersion", 4903);
      report.put("enabledFeatures", FeatureFlags.REGISTRY.toNames(level.enabledFeatures()).stream().map(Object::toString).sorted().toList());
      report.put("policy", "Actual getStateForPlacement using ServerPlayer BlockPlaceContext; dry empty unpowered neighborhood unless noted. Does not prove arbitrary neighbor updates or modded placement.");
      report.put("families", families); report.put("placementCases", cases); report.put("supportCases", support(level));
      report.put("lanternAttachmentCases", lanternAttachments(level, player));
      report.put("lanternSupportCases", LanternSupportCases.collect(level));
      report.put("doorHingeCases", DoorHingeCases.collect(level, player));
      report.put("doorCollisionCases", DoorHingeCases.collisions(level));
      report.put("neighborCases", neighborCases(level));
      var vegetationSupportIds = new ArrayList<String>();
      for (Block block : BuiltInRegistries.BLOCK) if (block.defaultBlockState().is(BlockTags.SUPPORTS_VEGETATION)) vegetationSupportIds.add(BuiltInRegistries.BLOCK.getKey(block).toString());
      Collections.sort(vegetationSupportIds); report.put("supportsVegetation", vegetationSupportIds);
      Files.writeString(output.resolve("placement-oracle.json"), new GsonBuilder().setPrettyPrinting().create().toJson(report));
      Bootstrap.realStdoutPrintln("Placement oracle completed: " + cases.size() + " contexts");
    } finally { if (server != null) server.close(); else access.close(); }
  }
}
