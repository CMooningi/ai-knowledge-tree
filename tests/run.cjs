const {spawnSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function run(args){const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);}
for(const dir of ['.','preview','popup','options']){
  for(const name of fs.readdirSync(path.join(root,dir)))if(name.endsWith('.js'))run(['--check',path.join(dir,name)]);
}
for(const name of fs.readdirSync(__dirname).filter(n=>n.endsWith('-verify.cjs')).sort())run([path.join('tests',name)]);
console.log('All syntax checks and regression suites passed.');
