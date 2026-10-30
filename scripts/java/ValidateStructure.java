import java.nio.file.Path;
import net.minecraft.SharedConstants;
import net.minecraft.server.Bootstrap;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.nbt.*;
import net.minecraft.world.level.levelgen.structure.templatesystem.StructureTemplate;

/** Reads and saves an editor NBT with the actual game's template implementation. No world is opened. */
public class ValidateStructure {
  static java.util.Map<String,Tag> states(CompoundTag root){
    var result=new java.util.HashMap<String,Tag>();var palette=root.getListOrEmpty("palette");
    for(Tag tag:root.getListOrEmpty("blocks"))if(tag instanceof CompoundTag block)result.put(block.getListOrEmpty("pos").toString(),palette.get(block.getIntOr("state",-1)));
    return result;
  }
  public static void main(String[] args) throws Exception {
    SharedConstants.tryDetectVersion(); Bootstrap.bootStrap();
    CompoundTag input=NbtIo.readCompressed(Path.of(args[0]),NbtAccounter.unlimitedHeap());
    StructureTemplate template=new StructureTemplate();template.load(BuiltInRegistries.BLOCK,input);
    CompoundTag saved=template.save(new CompoundTag());
    int blocks=input.getListOrEmpty("blocks").size(),entities=input.getListOrEmpty("entities").size();
    if(saved.getListOrEmpty("blocks").size()!=blocks||saved.getListOrEmpty("entities").size()!=entities)throw new IllegalStateException("Game round trip changed entry counts");
    if(!saved.getListOrEmpty("entities").equals(input.getListOrEmpty("entities")))throw new IllegalStateException("Game round trip changed entity coordinates/NBT");
    if(!states(saved).equals(states(input)))throw new IllegalStateException("Game round trip changed block positions/properties");
    for(Tag block : saved.getListOrEmpty("palette")){
      if(block instanceof CompoundTag state && state.getStringOr("Name","").equals("minecraft:air"))throw new IllegalStateException("Unknown block resolved to air");
    }
    Bootstrap.realStdoutPrintln("Game StructureTemplate round trip passed: "+blocks+" blocks, "+entities+" entities, size "+template.getSize());
  }
}
