'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
function storage(dir){
 const file=path.join(dir,'foxes-private-scouting.enc.json');
 const digest=raw=>raw?crypto.createHash('sha256').update(raw).digest('hex'):null;
 function read(){if(!fs.existsSync(file))return {blob:null,revision:null};const raw=fs.readFileSync(file,'utf8');return {blob:JSON.parse(raw),revision:digest(raw)};}
 function write(blob,revision){
  if(!blob||Object.keys(blob).sort().join(',')!=='ciphertext,iterations,iv,kdf,salt,version'||blob.version!==1||blob.iterations!==600000||blob.kdf!=='PBKDF2-SHA256')throw Error('Invalid encrypted scouting file.');
  for(const key of ['salt','iv','ciphertext'])if(typeof blob[key]!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(blob[key]))throw Error('Invalid encrypted content.');
  if(Buffer.from(blob.salt,'base64').length!==16||Buffer.from(blob.iv,'base64').length!==12||blob.ciphertext.length>20000000)throw Error('Invalid encrypted content size.');
  if(read().revision!==revision)throw Error('Scouting data changed in another window. Lock and unlock to reload it.');
  fs.mkdirSync(dir,{recursive:true});const raw=JSON.stringify(blob),tmp=file+'.tmp';
  if(fs.existsSync(file))fs.copyFileSync(file,file+'.previous');
  fs.writeFileSync(tmp,raw);fs.renameSync(tmp,file);return {revision:digest(raw)};
 }
 return {read,write,file};
}
module.exports={storage};
