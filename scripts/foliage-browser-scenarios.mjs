import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {strToU8,zipSync,zlibSync} from 'fflate'

// Synthetic, redistributable pixels only. No game assets are copied into fixtures.
function png(width,height,[r,g,b,a=255]) {
  const chunk=(type,data)=>{
    const tag=Buffer.from(type),payload=Buffer.concat([tag,data]);let crc=0xffffffff
    for(const byte of payload){crc^=byte;for(let i=0;i<8;i++)crc=crc>>>1^(crc&1?0xedb88320:0)}
    const length=Buffer.alloc(4),sum=Buffer.alloc(4);length.writeUInt32BE(data.length);sum.writeUInt32BE((crc^0xffffffff)>>>0)
    return Buffer.concat([length,payload,sum])
  }
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6
  const data=new Uint8Array(height*(width*4+1))
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set([r,g,b,a],y*(width*4+1)+1+x*4)
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlibSync(data)),chunk('IEND',Buffer.alloc(0))])
}

/** Effective colormap pixels, failure recovery and read-only resource changes in native Chrome. */
export async function runFoliageScenarios({command,evaluate,until,click,aria,input,upload,screenshot,directory,profilePath}) {
  const canvas='.editor-workspace canvas[data-editor-camera]'
  const profile=JSON.parse(await readFile(profilePath,'utf8'))
  const cell=(id,pos,properties={})=>({pos,state:{name:`minecraft:${id}`,properties:{...profile.blocks.find(block=>block.id===`minecraft:${id}`).defaults,...properties}}})
  const root=(id,entry)=>({id,name:id,kind:'block',cells:[entry],children:[],pivot2:entry.pos.map(value=>2*value+1),orientation:0})
  const document={schemaVersion:2,id:'foliage-preview-fixture',name:'Foliage resource preview',workspace:'architecture',target:{gameVersion:'26.2',dataVersion:4903},objects:[
    root('oak-leaf',cell('oak_leaves',[0,0,0],{persistent:'true',distance:'7',waterlogged:'false'})),
    root('reference-stone',cell('stone',[2,0,0])),
  ],entities:[]}
  const faces=Object.fromEntries(['down','up','north','south','west','east'].map(face=>[face,{texture:'#all',tintindex:0}]))
  const assets={
    'assets/minecraft/blockstates/oak_leaves.json':strToU8(JSON.stringify({variants:{'':{model:'minecraft:block/foliage_browser_leaf'}}})),
    'assets/minecraft/models/block/foliage_browser_leaf.json':strToU8(JSON.stringify({textures:{all:'minecraft:block/oak_leaves'},elements:[{from:[0,0,0],to:[16,16,16],shade:false,faces}]})),
    'assets/minecraft/textures/block/oak_leaves.png':png(1,1,[255,255,255]),
  }
  const mapPath='assets/minecraft/textures/colormap/foliage.png'
  const names={red:'foliage-red.zip',green:'foliage-green.zip',missing:'foliage-model-only.zip',invalid:'foliage-invalid-map.zip'}
  const paths={}
  for(const [kind,files] of Object.entries({
    red:{...assets,[mapPath]:png(256,256,[255,8,8])},
    green:{[mapPath]:png(256,256,[8,255,8])},
    missing:assets,
    // A complete IHDR with no pixel stream: valid dimensions, native decode failure.
    invalid:{[mapPath]:png(256,256,[8,8,255]).subarray(0,33)},
  })) {
    paths[kind]=join(directory,names[kind])
    await writeFile(paths[kind],zipSync({'pack.mcmeta':strToU8(JSON.stringify({pack:{description:names[kind],min_format:[88,0],max_format:[88,0]}})),...files}))
  }
  const committed=()=>evaluate(`(()=>{const d=document.querySelector('.editor-diagnostics').dataset;return {snapshot:d.snapshot,entities:d.entities,history:d.history,revision:d.revision}})()`)
  async function manager(){await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim().startsWith('Resources')).click()`);await until(`!!document.querySelector('[aria-label="Import resource pack"]')`)}
  const closeManager=()=>click(aria('Close Resources'))
  async function toggle(label,checked){
    if(await evaluate(`document.querySelector(${JSON.stringify(aria(label))})?.checked`)!==checked)await click(aria(label))
    await until(`(()=>{const control=document.querySelector(${JSON.stringify(aria(label))});return control&&!control.disabled&&control.checked===${checked}})()`)
  }
  async function importPack(kind){await upload(aria('Import resource pack'),paths[kind]);await until(`Array.from(document.querySelectorAll('.pack-card strong')).some(item=>item.textContent===${JSON.stringify(names[kind])})&&!document.querySelector('[aria-label="Import resource pack"]').disabled`)}
  async function ready(color){
    await until(`(()=>{const c=document.querySelector('${canvas}');return c?.dataset.foliageStatus==='ready'&&c.dataset.foliageTint===${JSON.stringify(color)}})()`)
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  }
  async function pixel(){
    const point=await evaluate(`(()=>{const c=document.querySelector('${canvas}'),m=JSON.parse(c.dataset.editorCamera).projection,p=[.5,.5,.5],q=[0,0,0,0];for(let r=0;r<4;r++)q[r]=m[r]*p[0]+m[4+r]*p[1]+m[8+r]*p[2]+m[12+r];const b=c.getBoundingClientRect();return {x:Math.floor(b.x+(q[0]/q[3]+1)*b.width/2)-2,y:Math.floor(b.y+(1-q[1]/q[3])*b.height/2)-2}})()`)
    const image=await command('Page.captureScreenshot',{format:'png',clip:{...point,width:4,height:4,scale:1}})
    return evaluate(`(async()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(image.data)}),v=>v.charCodeAt(0)),image=await createImageBitmap(new Blob([bytes],{type:'image/png'}));try{const c=document.createElement('canvas');c.width=c.height=4;const context=c.getContext('2d');context.drawImage(image,0,0);const data=context.getImageData(0,0,4,4).data,sum=[0,0,0];for(let i=0;i<data.length;i+=4)for(let k=0;k<3;k++)sum[k]+=data[i+k];return sum.map(v=>v/16)}finally{image.close()}})()`)
  }
  async function assertColor(color,channel){
    await ready(color)
    let rgb
    for(let attempt=0;attempt<20;attempt++){
      rgb=await pixel()
      if(rgb[channel]>80&&rgb[channel]>rgb[(channel+1)%3]*2&&rgb[channel]>rgb[(channel+2)%3]*2)return rgb
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    }
    assert.fail(`Expected rendered ${color} foliage pixels; got ${rgb}`)
  }
  const thumbnailPixels=`(()=>{const image=document.querySelector('.component-thumbnail img');if(!image?.complete||image.naturalWidth!==192||image.naturalHeight!==144)return null;const canvas=document.createElement('canvas');canvas.width=192;canvas.height=144;const context=canvas.getContext('2d');context.drawImage(image,0,0);const data=context.getImageData(88,64,16,16).data,sum=[0,0,0];for(let i=0;i<data.length;i+=4)for(let k=0;k<3;k++)sum[k]+=data[i+k];return sum.map(value=>value/256)})()`
  async function assertThumbnailColor(channel){
    await until(`(()=>{const rgb=${thumbnailPixels};return rgb&&rgb[${channel}]>80&&rgb[${channel}]>rgb[${(channel+1)%3}]*2&&rgb[${channel}]>rgb[${(channel+2)%3}]*2})()`)
    return evaluate(thumbnailPixels)
  }
  await command('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})
  await click(aria('Architecture workspace'));await until(`document.querySelector('.editor-workspace')?.dataset.editorReady==='true'`)
  const source=join(directory,'foliage-preview.json');await writeFile(source,JSON.stringify(document));await upload(aria('Import editor document'),source)
  await until(`document.querySelector('[aria-label="Document name"]').value==='Foliage resource preview'`)
  await click(aria('Select tool'));await click(aria('Frame editor scene'));await click(aria('Editor Z view'))
  await until(`!!document.querySelector('${canvas}')?.dataset.editorCamera`)
  const before=await committed()
  await manager()
  const original=await evaluate(`Array.from(document.querySelectorAll('.pack-toggle input')).map(input=>({label:input.getAttribute('aria-label'),checked:input.checked}))`)
  try {
    await importPack('red');await closeManager();const red=await assertColor('#ff0808',0)
    assert.ok(await evaluate(`Array.from(document.querySelectorAll('.viewport-environment')).some(item=>item.textContent.includes('Plains')&&item.textContent.includes('studio light'))`))
    await screenshot('foliage-red-colormap')
    if(!await evaluate(`!!document.querySelector('.editor-library')`))await click(aria('Toggle editor library'))
    await click('.editor-library-tabs button:nth-child(2)')
    const thumbnailName='Foliage thumbnail probe',thumbnailPath=join(directory,'foliage-thumbnail.component.json')
    await writeFile(thumbnailPath,JSON.stringify({schemaVersion:1,id:'foliage-thumbnail-source',name:thumbnailName,objects:[document.objects[0]],size:[1,1,1],pivot2:[1,1,1],orientation:0}))
    await upload(aria('Import component JSON'),thumbnailPath)
    await input(aria('Search components'),thumbnailName)
    const redThumbnail=await assertThumbnailColor(0)
    assert.deepEqual(await committed(),before,'Creating a foliage thumbnail must not edit the working document/history')
    await manager();await importPack('green');await closeManager();const green=await assertColor('#08ff08',1)
    assert.notDeepEqual(green,red,'Effective colormap must change actual framebuffer pixels')
    const greenThumbnail=await assertThumbnailColor(1)
    assert.notDeepEqual(greenThumbnail,redThumbnail,'Changed colormap must regenerate the actual component thumbnail pixels')
    await screenshot('foliage-green-colormap')
    await manager();await click(aria(`Move ${names.green} down`));await until(`document.querySelector('.pack-card strong')?.textContent===${JSON.stringify(names.red)}`);await closeManager();await assertColor('#ff0808',0)
    await manager();await toggle(`Enable ${names.red}`,false);await closeManager();await assertColor('#08ff08',1)
    assert.deepEqual(await committed(),before,'Colormap precedence/toggle must not edit document/history')

    await manager();await importPack('missing')
    for(const entry of original)await toggle(entry.label,false)
    await toggle(`Enable ${names.green}`,false)
    await closeManager()
    await until(`document.querySelector('${canvas}')?.dataset.foliageStatus==='unavailable'`)
    assert.equal(await evaluate(`document.querySelector('${canvas}').dataset.foliageTint`),'#ffffff')
    await screenshot('foliage-missing-colormap')
    await manager();await importPack('invalid');await closeManager()
    await until(`document.querySelector('${canvas}')?.dataset.foliageStatus==='unavailable'`)
    assert.equal(await evaluate(`document.querySelector('${canvas}').dataset.foliageTint`),'#ffffff')
    await until(`Array.from(document.querySelectorAll('.viewport-diagnostics')).some(item=>item.textContent.includes('Could not decode the foliage colormap PNG.'))`)
    await screenshot('foliage-invalid-colormap')
    await manager();await toggle(`Enable ${names.invalid}`,false);await toggle(`Enable ${names.red}`,true);await closeManager();await assertColor('#ff0808',0)
    await until(`!Array.from(document.querySelectorAll('.viewport-diagnostics')).some(item=>item.textContent.includes('Could not decode the foliage colormap PNG.'))`)
    assert.deepEqual(await committed(),before,'Failed/missing colormap and recovery must preserve complete document/history')
    console.log(JSON.stringify({foliageResult:'passed',checks:['native red/green colormap framebuffer pixels','192x144 thumbnail waits for colormap and regenerates with changed resources','effective priority reorder and toggle','fixed Plains studio label','missing colormap has untinted fallback','visible native image decode failure and recovery clears diagnostics','document/history unchanged'],limits:['fixed preview environment; no biome/world lighting parity']}))
  } finally {
    if(!await evaluate(`!!document.querySelector('[aria-label="Import resource pack"]')`))await manager()
    for(const name of Object.values(names))if(await evaluate(`!!document.querySelector(${JSON.stringify(aria(`Remove ${name}`))})`)){await click(aria(`Remove ${name}`));await until(`!document.querySelector(${JSON.stringify(aria(`Remove ${name}`))})`)}
    for(const entry of original)await toggle(entry.label,entry.checked)
    await closeManager()
  }
}
