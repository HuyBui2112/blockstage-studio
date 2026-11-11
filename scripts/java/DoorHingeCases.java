import java.util.*;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.context.BlockPlaceContext;
import net.minecraft.world.level.block.*;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.DoubleBlockHalf;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;

/** Independent actual DoorBlock placement and collision queries, never editor predictions. */
public class DoorHingeCases {
  static List<Map<String,Object>> collect(ServerLevel level, ServerPlayer player) {
    var result = new ArrayList<Map<String,Object>>();
    var base = PlacementOracle.BASE;
    for (float yaw : new float[] {0,90,180,270}) {
      player.setYRot(yaw); player.setXRot(0);
      var forward = player.getDirection();
      var left = forward.getCounterClockWise();
      for (int scenario=0;scenario<23;scenario++) for (double local : new double[] {0.25,0.5,0.75}) {
        for (var p:BlockPos.betweenClosed(base.offset(-2,-2,-2),base.offset(2,3,2))) level.setBlock(p,Blocks.AIR.defaultBlockState(),Block.UPDATE_CLIENTS);
        var input = new LinkedHashMap<BlockPos,BlockState>();
        input.put(base.below(),Blocks.STONE.defaultBlockState());
        if(scenario<16) {
          for(int i=0;i<4;i++) if((scenario&(1<<i))!=0) input.put(base.relative(i<2?left:left.getOpposite()).above(i%2),Blocks.STONE.defaultBlockState());
        } else {
          if(scenario==16||scenario==18||scenario==19||scenario==21) addDoor(input,base.relative(left),Blocks.OAK_DOOR,forward);
          if(scenario==17||scenario==18||scenario==20||scenario==22) addDoor(input,base.relative(left.getOpposite()),Blocks.IRON_DOOR,forward.getOpposite());
          if(scenario==19) input.put(base.relative(left.getOpposite()).above(),Blocks.STONE.defaultBlockState());
          if(scenario==20) input.put(base.relative(left).above(),Blocks.STONE.defaultBlockState());
          if(scenario==21) input.put(base.relative(left.getOpposite()),Blocks.STONE_BRICK_SLAB.defaultBlockState());
          if(scenario==22) input.put(base.relative(left),Blocks.OAK_STAIRS.defaultBlockState());
        }
        for(var entry:input.entrySet()) level.setBlock(entry.getKey(),entry.getValue(),Block.UPDATE_CLIENTS);
        var hit=new Vec3(base.getX()+local,base.getY(),base.getZ()+local);
        var block=scenario%2==0?Blocks.OAK_DOOR:Blocks.IRON_DOOR;
        var context=new BlockPlaceContext(player,InteractionHand.MAIN_HAND,new ItemStack(block.asItem()),new BlockHitResult(hit,Direction.UP,base.below(),false));
        if(!context.getClickedPos().equals(base))throw new IllegalStateException("Wrong door target");
        var state=block.getStateForPlacement(context);
        if(state==null)throw new IllegalStateException("Door placement unexpectedly rejected");
        var cells=new ArrayList<Map<String,Object>>();
        for(var entry:input.entrySet()) cells.add(Map.of("pos",PlacementOracle.pos(entry.getKey()),"state",PlacementOracle.state(entry.getValue())));
        result.add(Map.of("block",BuiltInRegistries.BLOCK.getKey(block).toString(),"target",PlacementOracle.pos(base),"point",PlacementOracle.point(hit),"look",List.of(forward.getStepX(),0,forward.getStepZ()),"input",cells,"state",PlacementOracle.state(state),"scenario",scenario));
      }
    }
    return result;
  }
  static void addDoor(Map<BlockPos,BlockState> input,BlockPos pos,Block block,Direction facing) {
    var state=block.defaultBlockState().setValue(DoorBlock.FACING,facing);
    input.put(pos,state.setValue(DoorBlock.HALF,DoubleBlockHalf.LOWER));
    input.put(pos.above(),state.setValue(DoorBlock.HALF,DoubleBlockHalf.UPPER));
  }
  static List<Map<String,Object>> collisions(ServerLevel level) {
    var result=new ArrayList<Map<String,Object>>();
    var basic=Set.of("stone","stone_bricks","cobblestone","dirt","grass_block","coarse_dirt","podzol","rooted_dirt","mycelium","clay","glass","bricks","deepslate","cobbled_deepslate","polished_andesite","andesite","diorite","granite","sandstone","red_sandstone","blackstone","end_stone","obsidian","bamboo_block","stripped_bamboo_block","bamboo_mosaic","air","cave_air","void_air");
    for(Block block:BuiltInRegistries.BLOCK) {
      String id=BuiltInRegistries.BLOCK.getKey(block).getPath();
      if(!(basic.contains(id)||id.endsWith("_planks")||block instanceof RotatedPillarBlock||block instanceof SlabBlock||block instanceof StairBlock||block instanceof DoorBlock||block instanceof ChainBlock))continue;
      for(var state:block.getStateDefinition().getPossibleStates()) result.add(Map.of("state",PlacementOracle.state(state),"full",state.isCollisionShapeFullBlock(level,PlacementOracle.BASE)));
    }
    return result;
  }
}
