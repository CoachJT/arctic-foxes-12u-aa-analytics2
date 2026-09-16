const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const window = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../web/team-branding.js'),'utf8'),{window,URL});
const B = window.PuckTeamBranding;
const context = {membership:{status:'active',team_id:'team-a'},capabilities:['admin.permissions'],userId:'coach-a',organizationId:'org-a'};
const row = {team_id:'team-a',updated_at:'2026-09-15T00:00:00Z',settings:{wordmark_url:'https://example.com/wordmark.png',feature_images:{film:'keep'},visual:{unknown:'preserve'}}};
const draft = {display_name:'Ice Club',primary_color:'#ffffff',secondary_color:'#081320',accent_color:'#dceaf8',tagline:'Every shift',bio:'Our team',page_themes:{command:'Players'},backgrounds:true};
test('branding requires active team membership and database permission, never platform identity',()=>{
 assert.equal(B.canEdit(context.membership,context.capabilities),true);
 assert.equal(B.canEdit({...context.membership,status:'invited'},context.capabilities),false);
 assert.equal(B.canEdit({isPlatformAdmin:true},context.capabilities),false);
 assert.equal(B.canEdit(context.membership,[]),false);
});
test('branding rejects script, data and credentialed URLs',()=>{
 for(const url of ['javascript:alert(1)','data:image/svg+xml,a','http://example.com/a','https://u:p@example.com/a'])assert.equal(B.safeImage(url),'');
 assert.equal(B.safeImage('https://example.com/a.png'),'https://example.com/a.png');
});
test('colors are validated; button foreground chooses contrasting ink',()=>{
 assert.throws(()=>B.buildPatch(row,{...draft,primary_color:'red;display:none'},'u'));
 assert.equal(B.ink('#ffffff'),'#000000');assert.equal(B.ink('#000000'),'#ffffff');
});
test('patch preserves other settings and restricts page themes to supported assets',()=>{
 const patch=B.buildPatch(row,{...draft,page_themes:{command:'Custom',film:'../../secret'}},'u');
 assert.equal(patch.settings.wordmark_url,row.settings.wordmark_url);
 assert.equal(patch.settings.feature_images.film,'keep');assert.equal(patch.settings.visual.unknown,'preserve');
 assert.equal(patch.settings.visual.page_themes.command,'Ice Arena');assert.equal(patch.settings.visual.page_themes.film,'Bench View');
 assert.equal(patch.updated_by,'u');assert.equal(patch.logo_url,undefined);
});
test('all nine built-in illustrations exist and cannot become arbitrary URLs',()=>{
 assert.equal(B.THEMES.length,9);
 for(const theme of B.THEMES)assert.ok(fs.existsSync(path.join(__dirname,'../web',B.themeUrl(theme))));
 assert.equal(B.themeUrl('https://example.com/x'),B.themeUrl('Ice Arena'));
});
test('save scopes by team and original revision; zero-row denial/conflict is not success',async()=>{
 const calls=[];const q={update(p){calls.push(['update',p]);return this;},eq(k,v){calls.push([k,v]);return this;},select(){return this;},async maybeSingle(){return {data:null,error:null};}};
 await assert.rejects(B.save({from(){return q;}},context,row,draft),/changed or access/);
 assert.ok(calls.some(c=>c[0]==='team_id'&&c[1]==='team-a'));
 assert.ok(calls.some(c=>c[0]==='updated_at'&&c[1]===row.updated_at));
});
test('cross-team save fails before any request',async()=>{
 await assert.rejects(B.save({from(){throw Error('must not request');}},context,{...row,team_id:'team-b'},draft),/owner access/);
});
test('successful save returns confirmed server row, errors are surfaced',async()=>{
 const q={update(){return this;},eq(){return this;},select(){return this;},async maybeSingle(){return {data:{...row,display_name:'Saved'}};}};
 assert.equal((await B.save({from:()=>q},context,row,draft)).display_name,'Saved');
 q.maybeSingle=async()=>({error:{message:'denied'}});
 await assert.rejects(B.save({from:()=>q},context,row,draft),/denied/);
});
test('upload uses prepared path without overwrite and aborts on failure',async()=>{
 const calls=[];
 const client={async rpc(name,args){calls.push([name,args]);return {data:name.startsWith('prepare')?{asset_id:'a',bucket_name:'organization-branding',object_path:'server/path.png'}:true};},storage:{from(bucket){assert.equal(bucket,'organization-branding');return {async upload(path,file,options){assert.equal(path,'server/path.png');assert.equal(options.upsert,false);return {error:{message:'Upload failed'}};}};}}};
 await assert.rejects(B.upload(client,context,{type:'image/png',size:100},'logo'),/Upload failed/);
 assert.equal(calls.at(-1)[0],'abort_organization_branding_asset');
 assert.equal(calls.some(c=>c[0].startsWith('finalize')),false);
});
test('successful upload requires server finalization; unsupported inputs never prepare',async()=>{
 const calls=[];const client={async rpc(name){calls.push(name);return {data:name.startsWith('prepare')?{asset_id:'a',bucket_name:'organization-branding',object_path:'p'}:true};},storage:{from(){return {upload:async()=>({error:null})};}}};
 await B.upload(client,context,{type:'image/webp',size:100},'hero');
 assert.equal(calls.at(-1),'finalize_organization_branding_asset');
 const count=calls.length;
 await assert.rejects(B.upload(client,context,{type:'image/svg+xml',size:100},'logo'),/PNG/);
 await assert.rejects(B.upload(client,context,{type:'image/png',size:10485761},'logo'),/PNG/);
 await assert.rejects(B.upload(client,context,{type:'image/png',size:100},'favicon'),/Unsupported/);
 assert.equal(calls.length,count);
});
