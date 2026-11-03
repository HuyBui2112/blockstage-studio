import {describe,it,expect} from 'vitest'
import {measurementOptions} from './measure-editor.mjs'
describe('bounded performance run configuration',()=>{
  it('preserves declared samples, sizes and rendering backend rather than silently reducing work',()=>{
    expect(measurementOptions(['--cells','1000,10000,100000','--kinds','dense,pairs','--samples','30'])).toMatchObject({cells:[1000,10000,100000],kinds:['dense','pairs'],samples:30,renderer:'hardware',selection:'root'})
    expect(measurementOptions(['--renderer','software','--selection','all']).renderer).toBe('software')
  })
  it.each([['--cells','0'],['--cells','100001'],['--samples','0'],['--samples','101'],['--cells','1e3'],['--kinds','unknown'],['--renderer','gpu'],['--warmup','-1'],['--seed','4294967296'],['--output','../../source.json']])('rejects invalid run %s %s before launching a browser',(...args)=>expect(()=>measurementOptions(args)).toThrow())
})
