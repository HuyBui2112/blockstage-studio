import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import com.google.gson.GsonBuilder;
import net.minecraft.SharedConstants;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.gametest.framework.GameTestServer;
import net.minecraft.nbt.*;
import net.minecraft.server.Bootstrap;
import net.minecraft.server.commands.PlaceCommand;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.packs.repository.ServerPacksSource;
import net.minecraft.server.packs.repository.PackCompatibility;
import net.minecraft.server.packs.repository.PackRepository;
import net.minecraft.resources.Identifier;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.flag.FeatureFlags;
import net.minecraft.world.level.WorldDataConfiguration;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.Mirror;
import net.minecraft.world.level.block.Rotation;
import net.minecraft.world.level.levelgen.structure.templatesystem.StructureTemplate;
import net.minecraft.world.level.levelgen.structure.templatesystem.StructureTemplateManager;
import net.minecraft.world.level.storage.LevelStorageSource;
import net.minecraft.world.level.storage.LevelResource;

/** Actual offline 26.2 ServerLevel placement/readback, isolated from user worlds.
 * Uses the shipped GameTest bootstrap but never runs its unrelated test suite.
 * Does not start the dedicated server, bind a port, or create/accept an EULA file.
 */
public class ValidateExport {
  static final BlockPos ORIGIN = new BlockPos(0, 80, 0);

  static BlockPos position(ListTag pos) {
    if (pos.size() != 3) throw new IllegalArgumentException("Expected three integer coordinates");
    return new BlockPos(pos.getIntOr(0, Integer.MIN_VALUE), pos.getIntOr(1, Integer.MIN_VALUE), pos.getIntOr(2, Integer.MIN_VALUE));
  }

  static List<Map<String, Object>> blocks(ServerLevel level, CompoundTag input) {
    var result = new ArrayList<Map<String, Object>>();
    var palette = input.getListOrEmpty("palette");
    for (Tag tag : input.getListOrEmpty("blocks")) {
      var block = (CompoundTag) tag;
      var local = position(block.getListOrEmpty("pos"));
      var state = (CompoundTag) palette.get(block.getIntOr("state", -1));
      var actual = NbtUtils.writeBlockState(level.getBlockState(ORIGIN.offset(local)));
      result.add(Map.of("position", List.of(local.getX(), local.getY(), local.getZ()), "expected", state.toString(), "actual", actual.toString(), "state", stateData(actual), "matches", actual.equals(state)));
    }
    return result;
  }

  static Map<String, Object> stateData(CompoundTag tag) {
    var properties = new TreeMap<String, String>();
    var values = tag.getCompoundOrEmpty("Properties");
    for (String key : values.keySet()) properties.put(key, values.getStringOr(key, ""));
    return Map.of("name", tag.getStringOr("Name", ""), "properties", properties);
  }

  static List<Map<String, Object>> entities(ServerLevel level) {
    var result = new ArrayList<Map<String, Object>>();
    for (Entity entity : level.getAllEntities()) {
      var p = entity.position().subtract(ORIGIN.getX(), ORIGIN.getY(), ORIGIN.getZ());
      result.add(Map.of("id", BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()).toString(), "position", List.of(p.x, p.y, p.z), "yaw", entity.getYRot(), "pitch", entity.getXRot(), "uuid", entity.getUUID().toString(), "tickCount", entity.tickCount));
    }
    return result;
  }

  static void assertEntities(List<Map<String, Object>> actual, CompoundTag input) {
    var remaining = new ArrayList<>(actual);
    for (Tag tag : input.getListOrEmpty("entities")) {
      var entity = (CompoundTag) tag;
      var nbt = entity.getCompoundOrEmpty("nbt");
      var pos = entity.getListOrEmpty("pos");
      var rotation = nbt.getListOrEmpty("Rotation");
      java.util.function.Predicate<Map<String, Object>> matches = found -> {
        if (!found.get("id").equals(nbt.getStringOr("id", ""))) return false;
        var p = (List<?>) found.get("position");
        for (int axis = 0; axis < 3; axis++) if (Math.abs(((Number) p.get(axis)).doubleValue() - pos.getDoubleOr(axis, Double.NaN)) > 0.00001) return false;
        double yaw = ((Number) found.get("yaw")).doubleValue() - rotation.getFloatOr(0, Float.NaN);
        return Math.abs(Math.IEEEremainder(yaw, 360)) < 0.0001 && Math.abs(((Number) found.get("pitch")).doubleValue() - rotation.getFloatOr(1, Float.NaN)) < 0.0001;
      };
      boolean matched = false;
      for (var iterator = remaining.iterator(); iterator.hasNext();) if (matches.test(iterator.next())) { iterator.remove(); matched = true; break; }
      if (!matched) throw new IllegalStateException("World entity type/position/yaw/pitch differs from export: " + entity);
    }
    if (!remaining.isEmpty() || actual.size() != input.getListOrEmpty("entities").size()) throw new IllegalStateException("World entity count differs from export");
  }

  public static void main(String[] args) {
    int status = 0;
    try { validate(args); } catch (Throwable error) { error.printStackTrace(); status = 1; }
    System.exit(status); // Shut down shared game worker pools after clean world close, including failure.
  }

  static void validate(String[] args) throws Exception {
    SharedConstants.tryDetectVersion();
    Bootstrap.bootStrap();
    if (!SharedConstants.getCurrentVersion().name().equals("26.2") || SharedConstants.getCurrentVersion().dataVersion().version() != 4903) throw new IllegalStateException("Expected Minecraft Java 26.2 / DataVersion 4903");
    var input = NbtIo.readCompressed(Path.of(args[0]), NbtAccounter.create(16L * 1024 * 1024));
    if (input.getIntOr("DataVersion", -1) != 4903) throw new IllegalArgumentException("Structure must target DataVersion 4903");
    if (input.getListOrEmpty("blocks").size() > 8192 || input.getListOrEmpty("entities").size() > 128) throw new IllegalArgumentException("World oracle is bounded to 8192 blocks and 128 entities");
    var loaded = new StructureTemplate();
    loaded.load(BuiltInRegistries.BLOCK, input);
    var size = loaded.getSize();
    if (size.getX() < 1 || size.getY() < 1 || size.getZ() < 1 || size.getX() > 64 || size.getY() > 64 || size.getZ() > 64) throw new IllegalArgumentException("World oracle needs structure bounds within 1..64 on each axis");
    Path output = Path.of(args[1]).toAbsolutePath();
    var storage = LevelStorageSource.createDefault(output.resolve("saves"));
    var access = storage.createAccess("export-fixture");
    boolean datapackMode = args.length > 2;
    if (datapackMode) {
      Path datapacks = access.getLevelPath(LevelResource.DATAPACK_DIR);
      Files.createDirectories(datapacks);
      Files.copy(Path.of(args[2]), datapacks.resolve("export-fixture.zip"));
    }
    // GameTestServer.create selects every available pack. Expose only vanilla
    // and this fixture so built-in experimental packs cannot change the oracle.
    var discovered = ServerPacksSource.createPackRepository(access);
    var packs = new PackRepository(consumer -> {
      discovered.reload();
      for (String id : discovered.getAvailableIds()) if (id.equals("vanilla") || (datapackMode && id.equals("file/export-fixture.zip"))) consumer.accept(discovered.getPack(id));
    });
    GameTestServer server = null;
    try {
      server = GameTestServer.create(Thread.currentThread(), access, packs, Optional.empty(), false, 0);
      var configuration = server.getWorldData().getDataConfiguration();
      server.getWorldData().setDataConfiguration(new WorldDataConfiguration(configuration.dataPacks(), FeatureFlags.DEFAULT_FLAGS));
      var expectedPacks = datapackMode ? Set.of("vanilla", "file/export-fixture.zip") : Set.of("vanilla");
      if (!new HashSet<>(packs.getSelectedIds()).equals(expectedPacks)) throw new IllegalStateException("Unexpected packs selected in isolated world");
      if (datapackMode) {
        var pack = packs.getPack("file/export-fixture.zip");
        if (pack == null || pack.getCompatibility() != PackCompatibility.COMPATIBLE || !packs.getSelectedIds().contains(pack.getId())) throw new IllegalStateException("Exported datapack was not compatible and selected by vanilla");
      }
      var init = GameTestServer.class.getDeclaredMethod("initServer");
      init.setAccessible(true);
      if (!(boolean) init.invoke(server)) throw new IllegalStateException("GameTest initialization failed");
      var level = server.overworld();
      if (!level.enabledFeatures().equals(FeatureFlags.DEFAULT_FLAGS)) throw new IllegalStateException("Isolated world must use default vanilla feature flags");
      // A solid support plane is harness infrastructure, outside the template.
      for (int x = -1; x <= size.getX(); x++) for (int z = -1; z <= size.getZ(); z++) level.setBlock(ORIGIN.offset(x, -1, z), Blocks.STONE.defaultBlockState(), Block.UPDATE_CLIENTS);
      for (int x = Math.floorDiv(-1, 16); x <= Math.floorDiv(size.getX(), 16); x++) for (int z = Math.floorDiv(-1, 16); z <= Math.floorDiv(size.getZ(), 16); z++) {
        level.setChunkForced(x, z, true);
        level.getChunk(x, z);
      }
      // Make ticket/entity status active before taking the immediate spawn sample.
      for (int tick = 0; tick < 5; tick++) level.tick(() -> true);
      long chunkDeadline = System.nanoTime() + 30_000_000_000L;
      server.managedBlock(() -> level.isPositionEntityTicking(ORIGIN) || System.nanoTime() >= chunkDeadline);
      if (!level.isPositionEntityTicking(ORIGIN)) throw new IllegalStateException("Timed out waiting for entity-ticking fixture chunks");
      var occupied = new HashSet<BlockPos>();
      var airPositions = new ArrayList<BlockPos>();
      var palette = input.getListOrEmpty("palette");
      for (Tag tag : input.getListOrEmpty("blocks")) {
        var block = (CompoundTag) tag;
        var pos = position(block.getListOrEmpty("pos"));
        if (!occupied.add(pos) || pos.getX() < 0 || pos.getY() < 0 || pos.getZ() < 0 || pos.getX() >= size.getX() || pos.getY() >= size.getY() || pos.getZ() >= size.getZ()) throw new IllegalArgumentException("Duplicate or out-of-bounds template cell: " + pos);
        var state = (CompoundTag) palette.get(block.getIntOr("state", -1));
        if (state.getStringOr("Name", "").equals("minecraft:air")) {
          airPositions.add(pos);
          level.setBlock(ORIGIN.offset(pos), Blocks.DIAMOND_BLOCK.defaultBlockState(), Block.UPDATE_CLIENTS);
        }
      }
      BlockPos sparse = null;
      outer: for (int y = size.getY() - 1; y >= 0; y--) for (int z = size.getZ() - 1; z >= 0; z--) for (int x = size.getX() - 1; x >= 0; x--) {
        var candidate = new BlockPos(x, y, z);
        if (!occupied.contains(candidate)) { sparse = candidate; break outer; }
      }
      if (sparse != null) level.setBlock(ORIGIN.offset(sparse), Blocks.DIAMOND_BLOCK.defaultBlockState(), Block.UPDATE_CLIENTS);
      var id = Identifier.parse(datapackMode ? "blockstage:build" : "blockstage:export_fixture");
      Path templatePath = null;
      if (!datapackMode) {
        templatePath = level.getStructureManager().worldTemplates().createAndValidatePathToStructure(id, StructureTemplateManager.WORLD_STRUCTURE_LISTER);
        if (!templatePath.normalize().startsWith(output)) throw new IllegalStateException("Template path escaped the isolated world");
        Files.createDirectories(templatePath.getParent());
        Files.copy(Path.of(args[0]), templatePath);
      }
      // This is the game's actual implementation of /place template, including
      // its default neighbor/shape updates (strict=false, flags=2).
      if (PlaceCommand.placeTemplate(server.createCommandSourceStack(), id, ORIGIN, Rotation.NONE, Mirror.NONE, 1.0F, 0, false) != 1) throw new IllegalStateException("Vanilla /place template returned failure");
      var before = blocks(level, input);
      var entitiesBefore = entities(level);
      long startTime = level.getGameTime();
      for (int tick = 0; tick < 20; tick++) level.tick(() -> true);
      var after = blocks(level, input);
      var entitiesAfter = entities(level);
      var airCleared = airPositions.stream().allMatch(pos -> level.getBlockState(ORIGIN.offset(pos)).isAir());
      var sparsePreserved = sparse == null || level.getBlockState(ORIGIN.offset(sparse)).is(Blocks.DIAMOND_BLOCK);
      var report = new LinkedHashMap<String, Object>();
      report.put("gameVersion", "26.2"); report.put("dataVersion", 4903);
      report.put("worldType", "vanilla GameTestServer ServerLevel");
      report.put("placementPolicy", "Vanilla /place template default: knownShape=false, strict=false, flags=2 (UPDATE_CLIENTS), integrity=1, no rotation/mirror; external solid support plane at y=-1");
      report.put("templateSize", List.of(size.getX(), size.getY(), size.getZ()));
      report.put("templateSource", datapackMode ? "datapack ZIP: data/blockstage/structure/build.nbt" : "world generated-template NBT");
      report.put("selectedPacks", packs.getSelectedIds());
      report.put("enabledFeatures", FeatureFlags.REGISTRY.toNames(level.enabledFeatures()).stream().map(Object::toString).sorted().toList());
      report.put("rawTemplatePath", templatePath == null ? null : output.relativize(templatePath).toString());
      report.put("explicitAirSentinelCount", airPositions.size()); report.put("explicitAirCleared", airCleared);
      report.put("sparseSentinelPosition", sparse == null ? null : List.of(sparse.getX(), sparse.getY(), sparse.getZ())); report.put("sparseSentinelPreserved", sparsePreserved);
      report.put("ticksRequested", 20); report.put("worldTimeBefore", startTime); report.put("worldTimeAfter", level.getGameTime());
      report.put("originEntityTicking", level.isPositionEntityTicking(ORIGIN));
      report.put("beforeTicks", before); report.put("afterTicks", after);
      report.put("entitiesBeforeTicks", entitiesBefore); report.put("entitiesAfterTicks", entitiesAfter);
      Files.writeString(output.resolve("readback.json"), new GsonBuilder().setPrettyPrinting().create().toJson(report));
      if (before.stream().anyMatch(block -> !(boolean) block.get("matches"))) throw new IllegalStateException("Immediate world readback changed block positions/properties; see readback.json");
      if (after.stream().anyMatch(block -> !(boolean) block.get("matches"))) throw new IllegalStateException("World readback after 20 ticks changed block positions/properties; see readback.json");
      assertEntities(entitiesBefore, input);
      for (var beforeEntity : entitiesBefore) {
        boolean survivedAndTicked = entitiesAfter.stream().anyMatch(entity -> entity.get("uuid").equals(beforeEntity.get("uuid")) && ((Number) entity.get("tickCount")).intValue() - ((Number) beforeEntity.get("tickCount")).intValue() == 20);
        if (!survivedAndTicked) throw new IllegalStateException("Fixture entity did not survive and tick 20 times; see readback.json");
      }
      if (!airCleared || !sparsePreserved) throw new IllegalStateException("Explicit air/sparse-cell sentinel failed; see readback.json");
      if (level.getGameTime() - startTime != 20) throw new IllegalStateException("World did not advance the requested ticks");
      Bootstrap.realStdoutPrintln("Actual Minecraft Java 26.2 world readback passed: " + before.size() + " blocks, " + entitiesBefore.size() + " entities, before/after 20 ServerLevel ticks.");
    } finally {
      if (server != null) server.close(); else access.close();
    }
  }
}
