(async()=>{
 document.querySelector('#createGameDate').value='2026-09-05';document.querySelector('#createOpponent').value='Learning preview';createSimpleGame();openWorkspace('film');
 const c=document.createElement('canvas');c.width=640;c.height=360;const ctx=c.getContext('2d');
 const draw=()=>{ctx.fillStyle='#dae8f0';ctx.fillRect(0,0,640,360);ctx.fillStyle='#193b62';ctx.fillRect(120,50,100,230);ctx.fillStyle='#d02c45';ctx.fillRect(120,180,100,25);ctx.fillStyle='white';ctx.font='bold 55px Arial';ctx.fillText('78',137,155);ctx.fillStyle='#163957';ctx.fillRect(380,50,100,230);ctx.fillStyle='#e0e8f0';ctx.fillRect(380,210,100,20);ctx.fillStyle='white';ctx.fillText('84',395,155);};draw();
 const stream=c.captureStream(10),rec=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'}),parts=[];rec.ondataavailable=e=>parts.push(e.data);const stopped=new Promise(r=>rec.onstop=r);rec.start(100);const timer=setInterval(draw,80);await new Promise(r=>setTimeout(r,1200));rec.stop();await stopped;clearInterval(timer);stream.getTracks().forEach(t=>t.stop());
 const url=URL.createObjectURL(new Blob(parts,{type:'video/webm'}));state.filmClips=[{id:'learning-test',name:'Synthetic test clip',url}];state.activeClipId='learning-test';
 await new Promise((resolve,reject)=>{v314.onloadeddata=resolve;v314.onerror=reject;v314.src=url;v314.load();});
 if(!Number.isFinite(v314.duration)){await new Promise(r=>{v314.addEventListener('seeked',r,{once:true});v314.currentTime=1e9;});}
 await new Promise(r=>{v314.addEventListener('seeked',r,{once:true});v314.currentTime=0;});
 const before=JSON.stringify(state.toi314);$('#openLearning4').click();if(!learningDialog4.open)throw Error('Learning dialog failed: '+$('#filmStatus31').textContent);
 const teach=(number,x)=>{learningBox4={x,y:.12,width:.17,height:.7};paintLearning4();compareLearning4();$('#learningPlayer4').value=state.players.find(p=>String(p.number)===number).id;$('#learningPlayer4').dispatchEvent(new Event('change'));$('#saveLearning4').click();};
 teach('78',.185);teach('84',.59);if(examples4().length!==2)throw Error('Examples not saved');if(JSON.stringify(state.toi314)!==before)throw Error('TOI changed');
 learningBox4={x:.185,y:.12,width:.17,height:.7};paintLearning4();compareLearning4();if(!$('#learningMatches4').textContent.includes('78'))throw Error('Missing player match');
 if(!game31().command31.identity4.examples.length)throw Error('Examples missing from game snapshot');
 return $('#learningStatus4').textContent;
})();
