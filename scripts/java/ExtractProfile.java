import com.google.gson.*;
import java.nio.file.*;
import java.util.*;
import java.lang.reflect.Field;
import java.util.jar.JarFile;
import net.minecraft.resources.Identifier;
import net.minecraft.tags.TagKey;
import net.minecraft.core.HolderLookup;
import net.minecraft.core.HolderSet;
import net.minecraft.SharedConstants;
import net.minecraft.server.Bootstrap;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.RegistryAccess;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.level.EmptyBlockGetter;
import net.minecraft.world.phys.shapes.VoxelShape;
import net.minecraft.world.flag.FeatureFlags;
import net.minecraft.world.item.*;
import net.minecraft.world.level.block.*;
import net.minecraft.world.level.block.state.*;
import net.minecraft.world.level.block.state.properties.Property;
import net.minecraft.client.model.geom.*;
import net.minecraft.data.registries.VanillaRegistries;

/** Version-specific headless extractor, compiled against the verified local Java 26.2 JAR. */
public class ExtractProfile {
  static final Gson GSON = new Gson();
  static final Map<String, JsonObject> TAGS = new HashMap<>();
  static final Map<String, Set<String>> TAG_CACHE = new HashMap<>();
  static Set<String> tagValues(String registry, String id, Set<String> visiting) {
    String name = id.contains(":") ? id : "minecraft:" + id;
    String[] parts = name.split(":", 2); String key = parts[0] + ":" + registry + "/" + parts[1];
    if (TAG_CACHE.containsKey(key)) return TAG_CACHE.get(key);
    if (!visiting.add(key)) throw new IllegalStateException("Tag cycle: " + key);
    Set<String> values = new LinkedHashSet<>();
    JsonObject tag = TAGS.get(key);
    if (tag != null) for (var entry : tag.getAsJsonArray("values")) {
      String value = entry.isJsonPrimitive() ? entry.getAsString() : entry.getAsJsonObject().get("id").getAsString();
      if (value.startsWith("#")) values.addAll(tagValues(registry, value.substring(1), visiting));
      else values.add(value.contains(":") ? value : "minecraft:" + value);
    }
    visiting.remove(key); TAG_CACHE.put(key, values); return values;
  }
  static JsonArray array(float... values) { JsonArray out = new JsonArray(); for (float v : values) out.add(v); return out; }
  @SuppressWarnings({"rawtypes", "unchecked"})
  static JsonObject properties(BlockState state) {
    JsonObject out = new JsonObject();
    for (Property property : state.getProperties()) out.addProperty(property.getName(), property.getName(state.getValue(property)));
    return out;
  }
  static Field field(String name) throws Exception { Field f = ModelPart.class.getDeclaredField(name); f.setAccessible(true); return f; }
  static <T> HolderLookup.RegistryLookup<T> withTags(HolderLookup.RegistryLookup<T> source) {
    return new HolderLookup.RegistryLookup.Delegate<T>() {
      public HolderLookup.RegistryLookup<T> parent() { return source; }
      public Optional<HolderSet.Named<T>> get(TagKey<T> tag) {
        try {
          var ctor = HolderSet.Named.class.getDeclaredConstructor(net.minecraft.core.HolderOwner.class, TagKey.class); ctor.setAccessible(true);
          @SuppressWarnings("unchecked") HolderSet.Named<T> named = (HolderSet.Named<T>)ctor.newInstance(source, tag);
          Set<String> values = tagValues(source.key().identifier().getPath(), tag.location().toString(), new HashSet<>());
          var bind = HolderSet.Named.class.getDeclaredMethod("bind", List.class); bind.setAccessible(true);
          bind.invoke(named, source.listElements().filter(h -> values.contains(h.key().identifier().toString())).toList());
          return Optional.of(named);
        } catch (Exception e) { throw new RuntimeException(e); }
      }
    };
  }
  @SuppressWarnings("unchecked")
  static JsonObject part(ModelPart part) throws Exception {
    JsonObject out = new JsonObject();
    out.add("position", array(part.x, part.y, part.z));
    out.add("rotation", array(part.xRot, part.yRot, part.zRot));
    out.add("scale", array(part.xScale, part.yScale, part.zScale));
    JsonArray polygons = new JsonArray(); int omitted = 0;
    for (ModelPart.Cube cube : (List<ModelPart.Cube>)field("cubes").get(part)) for (ModelPart.Polygon polygon : cube.polygons) {
      boolean valid = true; for (ModelPart.Vertex v : polygon.vertices()) if (!Float.isFinite(v.u()) || !Float.isFinite(v.v()) || !Float.isFinite(v.x()) || !Float.isFinite(v.y()) || !Float.isFinite(v.z())) valid = false;
      if (!valid) { omitted++; continue; }
      JsonArray vertices = new JsonArray();
      for (ModelPart.Vertex v : polygon.vertices()) vertices.add(array(v.x(), v.y(), v.z(), v.u(), v.v()));
      polygons.add(vertices);
    }
    out.add("polygons", polygons); out.addProperty("omittedPolygons", omitted);
    JsonObject children = new JsonObject();
    for (var child : ((Map<String, ModelPart>)field("children").get(part)).entrySet()) children.add(child.getKey(), part(child.getValue()));
    out.add("children", children);
    return out;
  }
  @SuppressWarnings({"rawtypes", "unchecked"})
  static JsonObject neighborRules() throws Exception {
    var postField = WallBlock.class.getDeclaredField("TEST_SHAPE_POST"); postField.setAccessible(true);
    var sidesField = WallBlock.class.getDeclaredField("TEST_SHAPES_WALL"); sidesField.setAccessible(true);
    var covered = WallBlock.class.getDeclaredMethod("isCovered", VoxelShape.class, VoxelShape.class); covered.setAccessible(true);
    var post = (VoxelShape)postField.get(null);
    var sides = (Map<Direction,VoxelShape>)sidesField.get(null);
    var directions = List.of(Direction.NORTH, Direction.EAST, Direction.SOUTH, Direction.WEST);
    var result = new JsonObject();
    for (Block block : BuiltInRegistries.BLOCK) {
      String id = BuiltInRegistries.BLOCK.getKey(block).toString();
      var rule = new JsonObject();
      rule.addProperty("kind", block instanceof FenceBlock ? "fence" : block instanceof WallBlock ? "wall" : block instanceof FenceGateBlock ? "gate" : block instanceof IronBarsBlock ? "pane" : "other");
      rule.addProperty("fence", tagValues("block","minecraft:fences",new HashSet<>()).contains(id));
      rule.addProperty("wooden", tagValues("block","minecraft:wooden_fences",new HashSet<>()).contains(id));
      rule.addProperty("wall", tagValues("block","minecraft:walls",new HashSet<>()).contains(id));
      rule.addProperty("forcePost", tagValues("block","minecraft:wall_post_override",new HashSet<>()).contains(id));
      rule.addProperty("exception", Block.isExceptionForConnection(block.defaultBlockState()));
      var shapes = new JsonObject();
      var properties = new ArrayList<Property<?>>();
      properties.addAll(block.getStateDefinition().getProperties()); properties.sort(Comparator.comparing(Property::getName));
      if (!block.hasDynamicShape()) for (var state : block.getStateDefinition().getPossibleStates()) {
        int sturdy = 0, mask = 0;
        for (int i=0;i<4;i++) if(state.isFaceSturdy(EmptyBlockGetter.INSTANCE,BlockPos.ZERO,directions.get(i))) sturdy |= 1 << i;
        var shape = state.getCollisionShape(EmptyBlockGetter.INSTANCE,BlockPos.ZERO).getFaceShape(Direction.DOWN);
        for(int i=0;i<4;i++) if((boolean)covered.invoke(null,shape,sides.get(directions.get(i)))) mask |= 1 << i;
        if((boolean)covered.invoke(null,shape,post)) mask |= 16;
        var key = new ArrayList<String>();
        for(var property : properties) key.add(property.getName()+"="+((Property)property).getName(state.getValue((Property)property)));
        var tuple = new JsonArray(); tuple.add(sturdy); tuple.add(mask); shapes.add(String.join(",",key),tuple);
      }
      // Uniform shapes need no property lookup. Dynamic shapes remain unknown.
      if(shapes.size()>0 && new HashSet<>(shapes.asMap().values()).size()==1){
        var uniform = shapes.asMap().values().iterator().next(); shapes=new JsonObject(); shapes.add("",uniform); properties.clear();
      }
      var names=new JsonArray(); for(var property:properties)names.add(property.getName());
      rule.add("properties",names); rule.add("shapes",shapes); result.add(id,rule);
    }
    return result;
  }
  @SuppressWarnings({"rawtypes", "unchecked"})
  public static void main(String[] args) throws Exception {
    SharedConstants.tryDetectVersion(); Bootstrap.bootStrap();
    try (JarFile jar = new JarFile(args[1])) {
      for (var entry : Collections.list(jar.entries())) {
        String path = entry.getName();
        if (path.startsWith("data/minecraft/tags/") && path.endsWith(".json")) {
          String name = "minecraft:" + path.substring("data/minecraft/tags/".length(), path.length()-5);
          TAGS.put(name, JsonParser.parseString(new String(jar.getInputStream(entry).readAllBytes(), java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject());
        }
      }
    }
    JsonObject root = new JsonObject(); root.addProperty("schemaVersion", 1); root.addProperty("gameVersion", "26.2"); root.addProperty("dataVersion", 4903);
    JsonArray blocks = new JsonArray();
    for (Block block : BuiltInRegistries.BLOCK) {
      JsonObject out = new JsonObject(); out.addProperty("id", BuiltInRegistries.BLOCK.getKey(block).toString());
      out.addProperty("translationKey", block.getName().getString());
      out.add("defaults", properties(block.defaultBlockState()));
      JsonObject props = new JsonObject();
      for (Property property : block.getStateDefinition().getProperties()) {
        JsonArray values = new JsonArray(); for (Object v : property.getPossibleValues()) values.add(property.getName((Comparable)v)); props.add(property.getName(), values);
      }
      out.add("properties", props); out.addProperty("stateCount", block.getStateDefinition().getPossibleStates().size());
      out.addProperty("hasBlockEntity", block.defaultBlockState().hasBlockEntity());
      out.addProperty("gravity", block instanceof FallingBlock);
      out.addProperty("friction", block.getFriction()); out.addProperty("blastResistance", block.getExplosionResistance());
      out.addProperty("item", BuiltInRegistries.ITEM.getKey(block.asItem()).toString());
      out.addProperty("renderShape", block.defaultBlockState().getRenderShape().name());
      out.addProperty("lightEmission", block.defaultBlockState().getLightEmission());
      JsonArray tags = new JsonArray();
      String id = BuiltInRegistries.BLOCK.getKey(block).toString();
      for (String tag : new TreeSet<>(TAGS.keySet())) if (tag.startsWith("minecraft:block/")) {
        String tagId = "minecraft:" + tag.substring("minecraft:block/".length());
        if (tagValues("block", tagId, new HashSet<>()).contains(id)) tags.add(tagId);
      }
      out.add("tags", tags);
      blocks.add(out);
    }
    root.add("blocks", blocks);
    JsonArray entities = new JsonArray();
    for (var type : BuiltInRegistries.ENTITY_TYPE) {
      JsonObject out = new JsonObject(); out.addProperty("id", BuiltInRegistries.ENTITY_TYPE.getKey(type).toString());
      out.addProperty("width", type.getWidth()); out.addProperty("height", type.getHeight()); out.addProperty("category", type.getCategory().getName()); out.addProperty("summonable", type.canSummon()); entities.add(out);
    }
    root.add("entities", entities);
    JsonArray tabs = new JsonArray();
    try {
      var lookup = VanillaRegistries.createLookup();
      for (var pending : BuiltInRegistries.DATA_COMPONENT_INITIALIZERS.build(lookup)) pending.forEach((holder, components) -> holder.bindComponents(components));
      var bind = net.minecraft.core.Holder.Reference.class.getDeclaredMethod("bindTags", Collection.class); bind.setAccessible(true);
      lookup.listRegistries().forEach(registry -> {
        String registryPath = registry.key().identifier().getPath();
        registry.listElements().forEach(holder -> {
          List<TagKey> tags = new ArrayList<>();
          for (String tag : TAGS.keySet()) if (tag.startsWith("minecraft:" + registryPath + "/")) {
            String id = "minecraft:" + tag.substring(("minecraft:" + registryPath + "/").length());
            if (tagValues(registryPath, id, new HashSet<>()).contains(holder.key().identifier().toString())) tags.add(TagKey.create((net.minecraft.resources.ResourceKey)registry.key(), Identifier.parse(id)));
          }
          try { bind.invoke(holder, tags); } catch (Exception error) { throw new RuntimeException(error); }
        });
      });
      var tabsLookup = HolderLookup.Provider.create(lookup.listRegistries().map(ExtractProfile::withTags));
      CreativeModeTabs.tryRebuildTabContents(FeatureFlags.DEFAULT_FLAGS, true, tabsLookup);
      for (var tab : CreativeModeTabs.allTabs()) {
        JsonObject out = new JsonObject(); out.addProperty("id", BuiltInRegistries.CREATIVE_MODE_TAB.getKey(tab).toString()); out.addProperty("label", tab.getDisplayName().getString());
        JsonArray items = new JsonArray(); for (var item : tab.getDisplayItems()) items.add(BuiltInRegistries.ITEM.getKey(item.getItem()).toString()); out.add("items", items); tabs.add(out);
      }
    } catch (Exception error) { error.printStackTrace(System.err); root.addProperty("creativeTabsError", error.toString()); }
    root.add("creativeTabs", tabs);
    JsonObject models = new JsonObject();
    for (var entry : LayerDefinitions.createRoots().entrySet()) models.add(entry.getKey().toString(), part(entry.getValue().bakeRoot()));
    root.add("entityModels", models);
    var dyes=new JsonObject(); for(var dye:DyeColor.values())dyes.addProperty(dye.getName(),dye.getTextureDiffuseColor() & 0xffffff); root.add("dyeColors",dyes);
    root.add("neighborRules", neighborRules());
    Files.writeString(Path.of(args[0]), GSON.toJson(root));
    Bootstrap.realStdoutPrintln("Extracted " + blocks.size() + " blocks, " + entities.size() + " entity types, " + models.size() + " model layers");
  }
}
