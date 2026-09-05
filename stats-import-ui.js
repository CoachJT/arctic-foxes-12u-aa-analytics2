/* Runs after the main app has initialized its shared state and render helpers. */
let statsImportPlan=null,statsWorkbook=null,statsReadToken=0;
const SI=FoxesStatsImport;
function clearStatsPreview(){statsImportPlan=null;$('#statsPreview').hidden=true;}
function previewStatsRows(rows,source){
 clearStatsPreview();
 statsImportPlan=SI.preview(rows,state.players,state.officialStats,state.currentGameId,source);
 const plan=statsImportPlan,ready=plan.rows.filter(r=>r.ready).length;
 $('#statsPreview').hidden=false;
 $('#statsPreviewSummary').textContent=`${state.gameDate||''} vs ${state.opponent||'opponent'} — ${ready} rows ready; ${plan.rows.length-ready} skipped. Only shown values replace existing stats. Blank cells and other players stay unchanged. ${plan.warnings.join(' ')}`;
 $('#statsPreviewBody').innerHTML=plan.rows.map(r=>`<tr><td>${r.line}</td><td>${escapeHtml(r.label)}</td><td>${r.player?escapeHtml('#'+r.player.number+' '+r.player.name+' ('+r.method+')'):r.group==='team'?'Team / periods':'Unmatched'}</td><td>${escapeHtml(Object.entries(r.values).map(([k,v])=>k+': '+(typeof v==='object'?JSON.stringify(v):v)).join(' | '))}</td><td>${escapeHtml((r.ready?'Ready. ':'Skipped. ')+r.warnings.join(' '))}</td></tr>`).join('');
 $('#confirmStatsImport').disabled=!ready;
}
function importOfficialStatsText(text,sourceName='pasted spreadsheet'){previewStatsRows(SI.parse(text),sourceName);return statsImportPlan;}
function downloadOfficialStatsTemplate(){
 const rows=SI.template(state.players),format=$('#statsTemplateFormat').value;
 if(format==='xlsx'){const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'Game Stats');XLSX.writeFile(wb,'Foxes_Stats_Template.xlsx');return;}
 const url=URL.createObjectURL(new Blob([SI.csv(rows)],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='Foxes_Stats_Template.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('#statsImportFile').onchange=async e=>{
 const file=e.target.files?.[0];if(!file)return;
 const token=++statsReadToken,gameId=state.currentGameId;clearStatsPreview();statsWorkbook=null;$('#statsSheetChoice').hidden=true;
 try{
  if(!gameId)throw Error('Create or open a saved game in My Games first.');
  if(file.size>10*1024*1024)throw Error('Use a spreadsheet smaller than 10 MB.');
  const excel=/\.xlsx$/i.test(file.name),data=excel?await file.arrayBuffer():await file.text();
  if(token!==statsReadToken||gameId!==state.currentGameId)return;
  if(excel){
   statsWorkbook=XLSX.read(data,{type:'array',sheetRows:10001});
   $('#statsSheet').innerHTML='<option value="__all31">All game sections</option>'+statsWorkbook.SheetNames.map(n=>`<option>${escapeHtml(n)}</option>`).join('');
   $('#statsSheetChoice').hidden=false;$('#statsSheet').dataset.source=file.name;$('#statsSheet').onchange();
  }else importOfficialStatsText(data,file.name);
 }catch(err){clearStatsPreview();alert(err.message||'Could not read spreadsheet.');}finally{e.target.value='';}
};
$('#statsSheet').onchange=()=>{try{if(statsWorkbook){const choice=$('#statsSheet').value,names=choice==='__all31'?statsWorkbook.SheetNames.filter(n=>!/^notes?$/i.test(n)):[choice];const rows=names.flatMap(n=>XLSX.utils.sheet_to_json(statsWorkbook.Sheets[n],{header:1,defval:'',raw:true}));previewStatsRows(rows,$('#statsSheet').dataset.source+' / '+(choice==='__all31'?'All game sections':choice));}}catch(err){clearStatsPreview();alert(err.message);}};
$('#importPastedStats').onclick=()=>{++statsReadToken;try{importOfficialStatsText($('#importPaste').value);}catch(err){clearStatsPreview();alert(err.message);}};
$('#cancelStatsImport').onclick=()=>{++statsReadToken;clearStatsPreview();};
$('#confirmStatsImport').onclick=()=>{try{const next=SI.apply(statsImportPlan,state.officialStats,state.players,state.currentGameId);snapshot();state.officialStats=next;save();clearStatsPreview();render();if(typeof render312==='function')render312();}catch(err){clearStatsPreview();alert(err.message);}};
$('#downloadStatsTemplate').onclick=downloadOfficialStatsTemplate;

function exportGameStats(){
 if(!state.currentGameId){alert('Create or open a saved game in My Games first.');return;}
 const rows=SI.template(state.players),records=A312.records({players:state.players,officialStats:state.officialStats,events:state.events,goalieEvents:state.goalieEvents});
 const fields=['','','','gp','g','a','pts','shots','pim','plusMinus','blocks','fow','fol','ppg','ppa','ppp','shg','sha','shp','gwg','gtg','min','saves','sa','ga','w','l','t','so','chances','takeaways','giveaways'];
 rows.slice(1).forEach((row,i)=>{const r=records[i];fields.forEach((k,j)=>{if(!k)return;const goalie=r.type==='goalie';if(goalie&&['shots','blocks','fow','fol','chances','takeaways','giveaways'].includes(k)||!goalie&&['min','saves','sa','ga','w','l','t','so'].includes(k))return;row[j]=r[k]??'';});});
 const url=URL.createObjectURL(new Blob([SI.csv(rows)],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='Foxes_Game_Stats.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('#exportGameStats').onclick=exportGameStats;
