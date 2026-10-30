import com.google.gson.*;
import java.nio.file.*;
import net.minecraft.SharedConstants;
import net.minecraft.server.Bootstrap;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.Identifier;
import net.minecraft.world.level.block.*;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.Property;

/** Read-only 26.2 class oracle. Does not construct a world or claim survival placement. */
public class EditorOracle {
  @SuppressWarnings({"rawtypes", "unchecked"})
  static JsonObject state(BlockState state) {
    JsonObject result = new JsonObject();
    result.addProperty("name", BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString());
    JsonObject properties = new JsonObject();
    for (Property property : state.getProperties()) properties.addProperty(property.getName(), property.getName(state.getValue(property)));
    result.add("properties", properties); return result;
  }
  public static void main(String[] args) throws Exception {
    SharedConstants.tryDetectVersion(); Bootstrap.bootStrap();
    JsonObject output = new JsonObject(); output.addProperty("gameVersion", SharedConstants.getCurrentVersion().name());
    JsonArray families = new JsonArray();
    for (Block block : BuiltInRegistries.BLOCK) {
      String family = block instanceof BedBlock ? "bed" : block instanceof DoorBlock ? "door" : block instanceof DoublePlantBlock ? "plant" : null;
      if (family == null) continue;
      JsonObject entry = state(block.defaultBlockState()); entry.addProperty("family", family); entry.addProperty("class", block.getClass().getSimpleName());
      entry.addProperty("hasBlockEntity", block.defaultBlockState().hasBlockEntity());
      entry.add("clockwise90", state(block.defaultBlockState().rotate(Rotation.CLOCKWISE_90))); families.add(entry);
    }
    output.add("families", families);
    JsonArray beds = new JsonArray();
    for (Direction direction : Direction.Plane.HORIZONTAL) {
      BlockState foot = BuiltInRegistries.BLOCK.getValue(Identifier.parse("minecraft:red_bed")).defaultBlockState().setValue(BedBlock.FACING, direction);
      JsonObject entry = state(foot); Direction connected = BedBlock.getConnectedDirection(foot);
      JsonArray offset = new JsonArray(); offset.add(connected.getStepX()); offset.add(connected.getStepY()); offset.add(connected.getStepZ()); entry.add("headOffset", offset);
      entry.add("clockwise90", state(foot.rotate(Rotation.CLOCKWISE_90))); beds.add(entry);
    }
    output.add("beds", beds);
    var isDouble = PitcherCropBlock.class.getDeclaredMethod("isDouble", int.class); isDouble.setAccessible(true);
    JsonArray pitcher = new JsonArray(); for (int age = 0; age <= 4; age++) pitcher.add((Boolean)isDouble.invoke(null, age)); output.add("pitcherDoubleByAge", pitcher);
    Files.writeString(Path.of(args[0]), new GsonBuilder().setPrettyPrinting().create().toJson(output));
    Bootstrap.realStdoutPrintln("Editor class oracle written; no world placement was performed.");
  }
}
