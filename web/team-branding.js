(function attachTeamBranding(global) {
  'use strict';
  const THEMES = Object.freeze(['Ice Arena', 'Players', 'Sticks & Pucks', 'Locker Room', 'Game Day', 'Jets of Ice', 'Bench View', 'Puck Close-Up', 'Rink Top View']);
  const PAGES = Object.freeze({command:'Command Center',schedule:'Schedule',games:'Game Center',players:'Roster & Players',stats:'Team Pulse',film:'Film',scouting:'Scouting',reports:'Reports',development:'Development',admin:'Staff',settings:'Settings'});
  const DEFAULTS = {command:'Ice Arena',schedule:'Rink Top View',games:'Game Day',players:'Players',stats:'Jets of Ice',film:'Bench View',scouting:'Sticks & Pucks',reports:'Puck Close-Up',development:'Players',admin:'Locker Room',settings:'Locker Room'};
  const PRESETS = { 'Midnight Ice':['#38bdf8','#081320','#e0f2fe'], 'Classic Red':['#e32636','#10151e','#f2f3f4'], 'Forest & Gold':['#27765c','#101c19','#f5ce72'], 'Royal Blue':['#4361ee','#101426','#d5e2ff'] };
  let editorState = () => ({busy:false,dirty:false});
  function canLeave() {
    const state = editorState();
    if (state.busy) return false;
    return !state.dirty || global.confirm('You have unsaved branding changes. Leave without saving?');
  }
  global.addEventListener?.('beforeunload',event=>{const state=editorState();if(state.busy||state.dirty){event.preventDefault();event.returnValue='';}});
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const color = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;
  function safeImage(value) {
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; }
  }
  function ink(hex) {
    const rgb = hex.slice(1).match(/../g).map(v => parseInt(v,16)/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
    return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722 > .179 ? '#000000' : '#ffffff';
  }
  function themeUrl(theme) {
    if (theme === 'Ice Arena') return './assets/rink-atmosphere.png';
    if (!THEMES.includes(theme)) return './assets/rink-atmosphere.png';
    return './assets/themes/' + theme.toLowerCase().replace(/ & /g,'-').replace(/ /g,'-') + '.svg';
  }
  function appearance(branding, page) {
    const settings = object(branding?.settings), visual = object(settings.visual);
    const theme = object(visual.page_themes)[page] || DEFAULTS[page] || 'Ice Arena';
    const custom = safeImage(settings.hero_image_url);
    return { image: theme === 'Custom' && custom ? custom : themeUrl(theme), primary:color(branding?.primary_color,'#e32636'), secondary:color(branding?.secondary_color,'#10151e'), accent:color(branding?.accent_color,'#dcecf7'), tagline:String(visual.tagline || '').slice(0,140), bio:String(visual.bio || '').slice(0,600), visual };
  }
  function apply(branding, page = 'command') {
    const a = appearance(branding, page), root = global.document.documentElement;
    root.style.setProperty('--team-primary',a.primary);
    root.style.setProperty('--team-secondary',a.secondary);
    root.style.setProperty('--team-accent',a.accent);
    root.style.setProperty('--team-ink',ink(a.primary));
    root.style.setProperty('--red',a.primary);
    root.style.setProperty('--team-background',`url(${JSON.stringify(a.image)})`);
    root.dataset.teamBackdrop = a.visual.backgrounds === false ? 'off' : 'on';
    let icon = global.document.querySelector('#teamFavicon');
    const iconUrl = a.visual.use_logo_icon ? safeImage(branding?.logo_url) : '';
    if (iconUrl) {
      if (!icon) { icon = global.document.createElement('link'); icon.id = 'teamFavicon'; icon.rel = 'icon'; global.document.head.append(icon); }
      icon.href = iconUrl;
    } else { icon?.remove(); }
    return a;
  }
  function canEdit(membership, capabilities = []) {
    // Platform identity alone is deliberately never a team edit grant.
    return membership?.status === 'active' && Boolean(membership.team_id) && capabilities.includes('admin.permissions');
  }
  function buildPatch(row, draft, userId) {
    if (!String(draft.display_name || '').trim()) throw new Error('Enter a team display name.');
    for (const key of ['primary_color','secondary_color','accent_color']) if (!/^#[0-9a-f]{6}$/i.test(draft[key])) throw new Error('Choose valid six-digit colors.');
    const settings = object(row.settings), visual = object(settings.visual);
    const pageThemes = Object.fromEntries(Object.keys(PAGES).map(page => [page, THEMES.includes(draft.page_themes?.[page]) || (draft.page_themes?.[page] === 'Custom' && safeImage(settings.hero_image_url)) ? draft.page_themes[page] : DEFAULTS[page]]));
    return { display_name:String(draft.display_name).trim().slice(0,100), primary_color:draft.primary_color,secondary_color:draft.secondary_color,accent_color:draft.accent_color,
      settings:{...settings,visual:{...visual,tagline:String(draft.tagline || '').slice(0,140),bio:String(draft.bio || '').slice(0,600),page_themes:pageThemes,backgrounds:draft.backgrounds !== false,use_logo_icon:!!draft.use_logo_icon}},updated_by:userId,updated_at:new Date().toISOString() };
  }
  async function save(client, context, row, draft) {
    if (!canEdit(context.membership,context.capabilities) || row.team_id !== context.membership.team_id || !context.userId) throw new Error('Team owner access is required.');
    const patch = buildPatch(row,draft,context.userId);
    let query = client.from('team_branding').update(patch).eq('team_id',row.team_id);
    query = row.updated_at ? query.eq('updated_at',row.updated_at) : query.is('updated_at',null);
    const {data,error} = await query.select('*').maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Branding changed or access was removed. Reload Team Settings before saving again.');
    return data;
  }
  async function upload(client, context, file, key) {
    if (!canEdit(context.membership,context.capabilities)) throw new Error('Team owner access is required.');
    if (!['logo','wordmark','secondary','hero'].includes(key)) throw new Error('Unsupported artwork.');
    if (!file || !['image/png','image/jpeg','image/webp'].includes(file.type) || file.size < 1 || file.size > 10485760) throw new Error('Choose a PNG, JPEG or WebP image up to 10 MB.');
    const {data,error} = await client.rpc('prepare_organization_branding_asset',{target_organization_id:context.organizationId,target_team_id:context.membership.team_id,requested_asset_key:key,requested_mime_type:file.type,requested_size_bytes:file.size});
    if (error) throw new Error(error.message);
    const asset = Array.isArray(data) ? data[0] : data;
    if (!asset?.asset_id || !asset?.bucket_name || !asset?.object_path) throw new Error('The image upload could not be prepared.');
    try {
      const result = await client.storage.from(asset.bucket_name).upload(asset.object_path,file,{upsert:false,contentType:file.type});
      if (result.error) throw new Error(result.error.message);
      const done = await client.rpc('finalize_organization_branding_asset',{target_asset_id:asset.asset_id});
      if (done.error || done.data !== true) throw new Error(done.error?.message || 'Image finalization was not confirmed.');
    } catch (error) {
      await client.rpc('abort_organization_branding_asset',{target_asset_id:asset.asset_id}).catch(() => {});
      throw error;
    }
  }
  function markup() {
    return `<section class="brand-studio" id="brandStudio" aria-label="Team customization"><div class="brand-studio-heading"><div><span class="eyebrow">YOUR TEAM. YOUR IDENTITY.</span><h2>Make this home ice.</h2><p>Colors, artwork and atmosphere for every part of your workspace.</p></div><span class="tag">Team Settings</span></div><div id="brandEditor"><p role="status">Loading team branding and permissions…</p></div></section>`;
  }
  async function mount(host, {client,getContext,onSaved}) {
    if (!host) return;
    const context = getContext(), teamId = context.membership?.team_id;
    if (!teamId) { host.textContent = 'Sign in to an active team to customize its workspace.'; return; }
    let row, busy = false, dirty = false, device = 'desktop';
    const current = () => host.isConnected && getContext().membership?.team_id === teamId && getContext().userId === context.userId;
    editorState = () => current() ? {busy,dirty} : {busy:false,dirty:false};
    try {
      const result = await client.from('team_branding').select('*').eq('team_id',teamId).maybeSingle();
      if (result.error) throw new Error(result.error.message);
      if (!result.data) throw new Error('This team has no branding record. Contact your organization owner.');
      row = result.data;
    } catch (error) { if (current()) host.innerHTML = `<p role="alert">${esc(error.message)}</p>`; return; }
    if (!current()) return;
    const editable = canEdit(context.membership,context.capabilities);
    function draft() {
      const form = host.querySelector('#brandForm'), data = new FormData(form);
      return {...Object.fromEntries(data), backgrounds:form.elements.backgrounds.checked,use_logo_icon:form.elements.use_logo_icon.checked,page_themes:Object.fromEntries(Object.keys(PAGES).map(p => [p,data.get('theme_'+p)]))};
    }
    function preview() {
      const selectedPage=host.querySelector('#previewPage').value;
      host.querySelector('#backgroundPage').value=selectedPage;
      host.querySelectorAll('[data-theme]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.theme===host.querySelector('[name="theme_'+selectedPage+'"]').value)));
      const d = draft(), page = host.querySelector('#previewPage').value, a = appearance({...row,...d,settings:{...row.settings,visual:{...d}}},page);
      const panel = host.querySelector('#brandPreview'); panel.dataset.device = device;
      panel.style.setProperty('--preview-primary',a.primary); panel.style.setProperty('--preview-ink',ink(a.primary)); panel.style.setProperty('--preview-secondary',a.secondary);
      panel.style.setProperty('--preview-image',d.backgrounds ? `url(${JSON.stringify(a.image)})` : 'none');
      const logo = safeImage(row.logo_url), wordmark = safeImage(row.settings?.wordmark_url);
      panel.innerHTML = `<div class="preview-chrome"><span>PUCKNEXUS</span><small>THE BEST PUCKING ANALYTICS</small></div><div class="preview-team">${logo ? `<img src="${esc(logo)}" alt="Team logo" />` : '<span class="preview-crest" aria-hidden="true">✦</span>'}<div>${wordmark ? `<img class="preview-wordmark" src="${esc(wordmark)}" alt="Team wordmark" />` : ''}<h3>${esc(d.display_name)}</h3><p>${esc(d.tagline || 'One team. Every possibility.')}</p></div></div><div class="preview-body"><small>WORKSPACE PREVIEW · EXAMPLE CONTENT</small><h3>${esc(PAGES[page])}</h3><p>${esc(d.bio || 'The people, preparation and progress behind your game.')}</p><div class="preview-cards"><article><small>YOUR TEAM</small><strong>Ready for what’s next.</strong></article><article><small>YOUR SEASON</small><strong>One connected workspace.</strong></article></div><span class="preview-button">View team</span></div>`;
    }
    function paint(notice = '') {
      const a = appearance(row,'command'), v = a.visual;
      host.innerHTML = `<p class="brand-access">${editable ? 'Changes publish to this team only when you save. Artwork uploads publish separately.' : 'You can explore a preview. Saving requires this team’s owner permission.'}</p><div class="brand-studio-grid"><form id="brandForm"><details class="brand-section"><summary>Team Info <span>Name, tagline &amp; story</span></summary><fieldset><legend>Team identity</legend><label>Display name<input name="display_name" maxlength="100" required value="${esc(row.display_name)}" /></label><label>Team tagline<input name="tagline" maxlength="140" value="${esc(v.tagline)}" placeholder="Together on every shift." /></label><label>Team bio<textarea name="bio" rows="3" maxlength="600">${esc(v.bio)}</textarea></label></fieldset></details><details class="brand-section" open><summary>Colors <span>Your palette, protected readability</span></summary><fieldset><legend>Team colors</legend><div class="brand-presets">${Object.entries(PRESETS).map(([name,colors])=>`<button type="button" data-preset="${esc(name)}">${colors.map(c=>`<i style="background:${c}"></i>`).join('')}<span>${esc(name)}</span></button>`).join('')}</div><button type="button" class="btn brand-default" data-preset="Midnight Ice">Reset to Default</button><div class="brand-colors">${['primary','secondary','accent'].map((key,i)=>`<div class="brand-color-control"><label>${key} color<input name="${key}_color" type="color" value="${[a.primary,a.secondary,a.accent][i]}" /></label><label class="brand-hex-label">${key} hex<input data-hex="${key}_color" aria-label="${key} hex" value="${[a.primary,a.secondary,a.accent][i]}" pattern="#[0-9a-fA-F]{6}" maxlength="7" spellcheck="false" /></label></div>`).join('')}</div><p class="brand-hint">Content panels stay dark. Button text adjusts to your primary color for readability.</p></fieldset></details><details class="brand-section" open><summary>Backgrounds <span>Choose the atmosphere for each page</span></summary><fieldset><legend>Hockey atmosphere</legend><p class="brand-hint">Each page keeps its own look. Choose a page, then pick its atmosphere.</p><label>Background for<select id="backgroundPage">${Object.entries(PAGES).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label><div class="brand-backgrounds">${[...THEMES,...(safeImage(row.settings?.hero_image_url)?['Custom']:[])].map(theme=>`<button type="button" class="brand-theme-card" data-theme="${esc(theme)}" aria-pressed="false"><img src="${esc(theme==='Custom'?safeImage(row.settings.hero_image_url):themeUrl(theme))}" alt="" loading="lazy" /><span>${esc(theme)}</span><small aria-hidden="true">✓ Selected</small></button>`).join('')}</div><label class="brand-check"><input type="checkbox" name="backgrounds" ${v.backgrounds !== false ? 'checked' : ''} /> Show page backgrounds</label><details class="brand-assignments"><summary>All page assignments</summary><div class="brand-theme-grid">${Object.entries(PAGES).map(([key,label])=>`<label>${label}<select name="theme_${key}">${[...THEMES,...(safeImage(row.settings?.hero_image_url) ? ['Custom'] : [])].map(t=>`<option ${t===(v.page_themes?.[key] || DEFAULTS[key])?'selected':''}>${esc(t)}</option>`).join('')}</select></label>`).join('')}</div></details></fieldset></details><details class="brand-section"><summary>Browser Identity <span>Optional team icon</span></summary><fieldset><legend>Browser identity</legend><label class="brand-check"><input name="use_logo_icon" type="checkbox" ${v.use_logo_icon?'checked':''} /> Use primary logo as this team’s browser icon</label><p class="brand-hint">Applies while this team is open. Installed app icons are not supported yet.</p></fieldset></details><div class="brand-save"><button class="btn primary" type="submit" ${editable?'':'disabled'}>Save team branding</button><button type="button" class="btn" id="resetBranding">Reset preview</button><span id="brandStatus" role="status" aria-live="polite">${esc(notice || 'Preview matches saved branding.')}</span></div></form><aside class="brand-preview-column"><div class="brand-preview-toolbar"><strong>Live preview</strong><div role="group" aria-label="Preview size">${['desktop','tablet','mobile'].map(d=>`<button type="button" data-device="${d}" aria-pressed="${d===device}">${d}</button>`).join('')}</div></div><label class="brand-preview-page">Preview page<select id="previewPage">${Object.entries(PAGES).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label><div class="brand-preview-stage"><div id="brandPreview" class="brand-preview"></div></div><section class="brand-artwork"><span class="eyebrow">BRANDING</span><h3>Wear your identity.</h3><p>PNG, JPEG or WebP · up to 10 MB. Uploaded artwork is public. Upload saves immediately.</p>${[['logo','Primary logo'],['wordmark','Wordmark'],['secondary','Secondary logo'],['hero','Custom background']].map(([key,label])=>{const url=safeImage(key==='logo'?row.logo_url:key==='wordmark'?row.settings?.wordmark_url:row.settings?.[key+'_image_url']);return `<form data-upload="${key}" class="brand-artwork-card"><label><strong>${label}</strong><span class="brand-artwork-image">${url?`<img src="${esc(url)}" alt="Current ${label.toLowerCase()}" loading="lazy" />`:`<span class="brand-artwork-fallback" aria-hidden="true">${key==='hero'?'⌁':'✦'}</span><span>No artwork yet</span>`}</span><span class="brand-hint">${key==='hero'?'Recommended 1920 × 1080 px':key==='wordmark'?'Recommended 1200 × 400 px':'Recommended 512 × 512 px'}</span><input type="file" accept="image/png,image/jpeg,image/webp" ${editable?'':'disabled'} required /></label><button class="btn" ${editable?'':'disabled'}>${url?'Replace':'Upload'} ${label.toLowerCase()}</button></form>`;}).join('')}</section></aside></div>`;
      host.querySelector('#brandForm').addEventListener('input',event=>{const input=event?.target;if(input?.id==='backgroundPage')return;if(input?.dataset.hex && /^#[0-9a-f]{6}$/i.test(input.value))host.querySelector('[name="'+input.dataset.hex+'"]').value=input.value;if(input?.type==='color')host.querySelectorAll('[data-hex]').forEach(hex=>{if(hex.dataset.hex===input.name)hex.value=input.value.toUpperCase();});dirty=true;host.querySelector('#brandStatus').textContent='Unsaved preview';preview();});
      host.querySelectorAll('input,select,textarea').forEach(input=>input.addEventListener('invalid',()=>{const section=input.closest('.brand-section');if(section)section.open=true;}));
      host.querySelector('#previewPage').addEventListener('change',preview);
      host.querySelector('#backgroundPage').addEventListener('change',()=>{host.querySelector('#previewPage').value=host.querySelector('#backgroundPage').value;preview();});
      host.querySelectorAll('[data-theme]').forEach(button=>button.onclick=()=>{host.querySelector('[name="theme_'+host.querySelector('#previewPage').value+'"]').value=button.dataset.theme;dirty=true;host.querySelector('#brandStatus').textContent='Unsaved preview';preview();});
      host.querySelectorAll('[data-device]').forEach(b=>b.onclick=()=>{device=b.dataset.device;host.querySelectorAll('[data-device]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));preview();});
      host.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>{PRESETS[b.dataset.preset].forEach((c,i)=>host.querySelector(`[name="${['primary','secondary','accent'][i]}_color"]`).value=c);host.querySelectorAll('[data-hex]').forEach(input=>input.value=host.querySelector('[name="'+input.dataset.hex+'"]').value.toUpperCase());dirty=true;host.querySelector('#brandStatus').textContent='Unsaved preview';preview();});
      host.querySelector('#resetBranding').onclick=()=>{dirty=false;paint();};
      host.querySelector('#brandForm').onsubmit=async e=>{
        e.preventDefault();if(busy || !current() || !editable)return; const d=draft(); setBusy(true,'Saving team branding…');
        try { const saved=await save(client,getContext(),row,d); if(!current())return;row=saved;dirty=false;await onSaved(saved);if(current())paint('Team branding saved.'); }
        catch(error){if(current())host.querySelector('#brandStatus').textContent=error.message;}
        finally{if(current())setBusy(false);}
      };
      host.querySelectorAll('[data-upload]').forEach(form=>form.onsubmit=async e=>{
        e.preventDefault();if(busy || !current() || !editable)return;
        if(dirty){host.querySelector('#brandStatus').textContent='Save or reset your preview before uploading artwork.';return;}
        const file=form.querySelector('input').files[0];setBusy(true,'Uploading artwork…');let published=false;
        try{await upload(client,getContext(),file,form.dataset.upload);published=true;if(!current())return;const result=await client.from('team_branding').select('*').eq('team_id',teamId).single();if(result.error)throw new Error(result.error.message);if(!current())return;row=result.data;await onSaved(row);if(current())paint('Artwork uploaded and saved.');}
        catch(error){if(current())host.querySelector('#brandStatus').textContent=(published?'Artwork saved, but refresh failed. Reload before further edits. ':'')+error.message;}
        finally{if(current())setBusy(false);}
      });
      preview();
    }
    function setBusy(value,message){busy=value;host.querySelectorAll('input,select,textarea,button').forEach(el=>el.disabled=value);if(message)host.querySelector('#brandStatus').textContent=message;}
    paint();
  }
  global.PuckTeamBranding = {THEMES,PAGES,DEFAULTS,PRESETS,safeImage,ink,themeUrl,appearance,apply,canEdit,buildPatch,save,upload,markup,mount,canLeave};
}(window));
