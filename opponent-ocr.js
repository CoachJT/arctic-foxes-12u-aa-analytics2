'use strict';
const {nativeImage}=require('electron');const fs=require('fs');const os=require('os');const path=require('path');const {execFile}=require('child_process');
let busy=false;
async function recognize(bytes){
 if(process.platform!=='win32')throw Error('Photo text recognition currently requires Windows. You can still enter player stats manually.');
 if(busy)throw Error('Another scoresheet is being read. Please wait.');
 if(!bytes||!Number.isInteger(bytes.byteLength)||bytes.byteLength>12*1024*1024)throw Error('Choose an image smaller than 12 MB.');
 const image=nativeImage.createFromBuffer(Buffer.from(bytes));if(image.isEmpty())throw Error('Choose a PNG or JPEG screenshot.');
 const size=image.getSize(),scale=Math.min(1,2500/Math.max(size.width,size.height));
 const resized=scale<1?image.resize({width:Math.round(size.width*scale),height:Math.round(size.height*scale)}):image;
 const png=resized.toPNG();if(png.length>6*1024*1024)throw Error('Crop the image to the opponent player table and try again.');
 busy=true;const temp=fs.mkdtempSync(path.join(os.tmpdir(),'foxes-score-'));const imagePath=path.join(temp,'sheet.png');
 try{fs.writeFileSync(imagePath,png);const script=path.join(__dirname.replace('app.asar','app.asar.unpacked'),'scoresheet-ocr.ps1');
  const result=await new Promise((resolve,reject)=>execFile(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-ImagePath',imagePath],{windowsHide:true,timeout:60000,maxBuffer:4*1024*1024,encoding:'utf8'},(err,stdout,stderr)=>err?reject(Error(stderr.trim()||'Could not read the image. Try a clearer crop or enter stats manually.')):resolve(JSON.parse(stdout.replace(/^\uFEFF/,'')))));
  return {...result,image:'data:image/png;base64,'+png.toString('base64')};
 }finally{busy=false;if(fs.existsSync(imagePath))fs.unlinkSync(imagePath);fs.rmdirSync(temp);}
}
module.exports={recognize};
