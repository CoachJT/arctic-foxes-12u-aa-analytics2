/* Test-server only: exercise the real video pipeline without touching installed data. */
const fixtureButton=document.createElement('button');fixtureButton.textContent='Create 12-second synthetic test video';
fixtureButton.style.cssText='position:fixed;top:4px;right:4px;z-index:99999';document.body.appendChild(fixtureButton);
fixtureButton.onclick=()=>{
 fixtureButton.disabled=true;fixtureButton.textContent='Recording synthetic moving rectangle…';
 const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
 const context=canvas.getContext('2d'),stream=canvas.captureStream(20),recorder=new MediaRecorder(stream,{mimeType:'video/webm'}),parts=[];
 recorder.ondataavailable=e=>{if(e.data.size)parts.push(e.data);};
 recorder.onstop=()=>{stream.getTracks().forEach(t=>t.stop());addFilmClipRecords([{name:'Synthetic crossing fixture (not hockey)',path:'synthetic-fixture.webm',url:URL.createObjectURL(new Blob(parts,{type:'video/webm'}))}]);fixtureButton.textContent='Synthetic test clip loaded';};
 const start=performance.now();function draw(){const t=(performance.now()-start)/1000;context.fillStyle='#080808';context.fillRect(0,0,320,180);context.fillStyle='white';context.fillRect(25+230*(1-Math.abs(t/6-1)),65,20,40);context.font='12px sans-serif';context.fillText('SYNTHETIC TEST — NOT HOCKEY',10,20);if(t<12)requestAnimationFrame(draw);else recorder.stop();}
 recorder.start();draw();
};
