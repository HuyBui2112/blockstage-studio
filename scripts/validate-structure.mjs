import {readFile} from 'node:fs/promises'
import {resolve,join,delimiter} from 'node:path'
import {spawnSync} from 'node:child_process'
const file=process.argv[2]
if(!file)throw new Error('Usage: node scripts/validate-structure.mjs <structure.nbt>; run prepare:game first')
const cache=resolve('node_modules/.cache/game-profile/26.2'),classpath=await readFile(join(cache,'classpath.txt'),'utf8')
const located=spawnSync('mise',['where','java@temurin-25.0.4+7.0.LTS'],{encoding:'utf8',windowsHide:true})
const javaHome=process.env.BLOCKSTAGE_JAVA_HOME??(located.status===0?located.stdout.trim():undefined)
if(!javaHome)throw new Error('An existing Java 25 JDK is required; set BLOCKSTAGE_JAVA_HOME')
for(const [name,args]of [
 ['javac',['-cp',classpath,'-d',cache,resolve('scripts/java/ValidateStructure.java')]],
 ['java',['-Djava.awt.headless=true','-cp',[cache,classpath].join(delimiter),'ValidateStructure',resolve(file)]],
]){
 const result=spawnSync(join(javaHome,'bin',name+(process.platform==='win32'?'.exe':'')),args,{cwd:cache,stdio:'inherit',windowsHide:true})
 if(result.status!==0)throw new Error(name+' failed: '+result.status)
}
