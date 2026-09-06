'use strict';
const path=require('node:path'),{pathToFileURL}=require('node:url');
function createBackend(root=__dirname){
 let sessionPromise=null,busy=false;
 const ready=()=>{if(!sessionPromise)sessionPromise=(async()=>{const ort=require('onnxruntime-node');return {ort,session:await ort.InferenceSession.create(path.join(root.replace(/app\.asar(?=[\\/]|$)/,'app.asar.unpacked'),'vendor','player-detector','yolox_tiny.onnx'),{executionProviders:['cpu'],intraOpNumThreads:2,interOpNumThreads:1,graphOptimizationLevel:'all'})};})().catch(e=>{sessionPromise=null;throw e;});return sessionPromise;};
 return {ready:async()=>{await ready();return true;},infer:async inputs=>{
  if(!Array.isArray(inputs)||inputs.length<1||inputs.length>4||inputs.some(a=>!(a instanceof Float32Array)||a.length!==3*416*416))throw Error('Invalid detector frame.');
  if(busy)throw Error('Player detector is busy.');busy=true;
  try{const {ort,session}=await ready(),out=[];for(const input of inputs){const result=await session.run({[session.inputNames[0]]:new ort.Tensor('float32',input,[1,3,416,416])});out.push(result[session.outputNames[0]].data);}return out;}finally{busy=false;}
 }};
}
function install({ipcMain},root=__dirname){const backend=createBackend(root),url=pathToFileURL(path.join(root,'index.html')).href;
 const guard=e=>{if(e.senderFrame!==e.sender.mainFrame||e.senderFrame.url.split('#')[0]!==url)throw Error('Player detection is available only in the film app.');};
 ipcMain.handle('foxes-vision-ready',async e=>{guard(e);return backend.ready();});
 ipcMain.handle('foxes-vision-infer',async(e,inputs)=>{guard(e);return backend.infer(inputs);});
}
module.exports={createBackend,install};
