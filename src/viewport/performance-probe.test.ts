import {afterEach,describe,expect,it,vi} from 'vitest'
import type { WebGLRenderer } from 'three'
import {PerformanceProbe} from './performance-probe'

afterEach(()=>vi.restoreAllMocks())
describe('opt-in CPU frame submission acknowledgement',()=>{
  it('records the actual rendered preview cell, revision and resource counts without touching renderer state',()=>{
    const canvas={dataset:{}} as HTMLCanvasElement
    const info={render:{calls:7,triangles:128},memory:{geometries:3,textures:4}}
    const renderer={info} as WebGLRenderer
    const before=structuredClone(info)
    vi.spyOn(performance,'now').mockReturnValue(110)
    const probe=new PerformanceProbe(canvas)
    probe.frame(renderer,105,'architecture:doc:epoch:8',true,1,'owner',[1,256,3])
    expect(JSON.parse(canvas.dataset.editorMeasurement!)).toMatchObject({frame:1,submittedAt:110,cpuSubmissionMs:5,revision:'architecture:doc:epoch:8',preview:true,previewFirst:[1,256,3],active:'owner',drawCalls:7,geometries:3,textures:4})
    const sceneUpdate={chunks:30,changedChunks:2,removedChunks:0,createdBatches:2,retainedBatches:28,resolvedCells:1024}
    probe.frame(renderer,108,'architecture:doc:epoch:9',false,1,'owner',null,sceneUpdate)
    expect(JSON.parse(canvas.dataset.editorMeasurement!)).toMatchObject({frame:2,revision:'architecture:doc:epoch:9',preview:false,previewFirst:null,sceneUpdate})
    expect(info).toEqual(before)
  })
})
