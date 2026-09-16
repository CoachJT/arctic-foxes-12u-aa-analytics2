'use strict';

// Film Web 1.0 keeps the source video in private Supabase storage. Clips and
// playlist entries are timestamp references; they never create another video.
(function () {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const stamp = seconds => {
    const value = Math.max(0, Number(seconds) || 0);
    return `${Math.floor(value / 60).toString().padStart(2, '0')}:${Math.floor(value % 60).toString().padStart(2, '0')}`;
  };
  const formatSize = bytes => bytes ? `${(Number(bytes) / 1073741824).toFixed(2)} GB` : 'Size unavailable';

  function createFilmRoom({ client, getContext, onChanged }) {
    const state = {
      films: [], clips: [], playlists: [], playlistClips: [], staff: [],
      loading: false, error: '', selectedFilm: null, signedUrl: '', inPoint: null,
      outPoint: null, playbackClip: null, uploading: false, uploadError: ''
    };

    const context = () => getContext() || {};
    const canView = () => Boolean(context().capabilities?.includes('film.view'));
    const canEdit = () => Boolean(context().capabilities?.includes('film.edit'));
    const canShare = () => Boolean(context().capabilities?.includes('film.share'));
    const teamId = () => context().teamId;
    const seasonId = () => context().seasonId || null;
    const currentUser = () => context().userId;
    const game = id => (context().games || []).find(item => item.id === id || item.source_game_id === id);

    async function load() {
      if (!canView() || !teamId()) return;
      state.loading = true; state.error = '';
      try {
        const [filmResult, clipResult, playlistResult] = await Promise.all([
          client.from('team_film').select('id,team_id,season_id,game_id,title,opponent,game_date,storage_path,media_asset_id,upload_state,duration_seconds,mime_type,file_size_bytes,created_by,created_at,uploaded_at').eq('team_id', teamId()).order('created_at', { ascending: false }),
          client.from('team_film_clips').select('id,film_id,title,notes,tags,start_seconds,end_seconds,created_by,created_at').order('created_at', { ascending: false }),
          client.from('team_film_playlists').select('id,team_id,title,topic,sharing,created_by,created_at').eq('team_id', teamId()).order('created_at', { ascending: false })
        ]);
        for (const result of [filmResult, clipResult, playlistResult]) if (result.error) throw result.error;
        state.films = filmResult.data || []; state.clips = clipResult.data || []; state.playlists = playlistResult.data || [];
        const playlistIds = state.playlists.map(item => item.id);
        if (playlistIds.length) {
          const result = await client.from('team_film_playlist_clips').select('playlist_id,clip_id,position').in('playlist_id', playlistIds).order('position');
          if (result.error) throw result.error;
          state.playlistClips = result.data || [];
        } else state.playlistClips = [];
      } catch (error) {
        state.error = error.message || 'Film could not be loaded.';
      } finally { state.loading = false; }
    }

    async function openFilm(id) {
      const film = state.films.find(item => item.id === id);
      if (!film) return;
      state.selectedFilm = film; state.signedUrl = ''; state.inPoint = null; state.outPoint = null;
      if (film.storage_path) {
        const result = await client.storage.from('game-film').createSignedUrl(film.storage_path, 3600);
        if (result.error) state.error = `Playback access failed: ${result.error.message}`;
        else state.signedUrl = result.data.signedUrl;
      }
      render();
    }

    async function deleteFilm(id) {
      const filmClips = state.clips.filter(clip => clip.film_id === id);
      const used = state.playlistClips.filter(entry => filmClips.some(clip => clip.id === entry.clip_id));
      if (filmClips.length || used.length) {
        window.alert(`This film has ${filmClips.length} clip${filmClips.length === 1 ? '' : 's'}${used.length ? ` in ${used.length} playlist item${used.length === 1 ? '' : 's'}` : ''}. Remove those references first.`);
        return;
      }
      if (!window.confirm('Delete this film from the team library? The stored video will no longer be available.')) return;
      const result = await client.from('team_film').update({ upload_state: 'deleted' }).eq('id', id).eq('team_id', teamId());
      if (result.error) window.alert(result.error.message);
      else { await load(); render(); }
    }

    async function createPlaylist() {
      const title = window.prompt('Playlist name');
      if (!title?.trim()) return;
      const result = await client.from('team_film_playlists').insert({
        team_id: teamId(), title: title.trim(), sharing: 'team_private', created_by: currentUser()
      });
      if (result.error) window.alert(result.error.message);
      else { await load(); render(); }
    }

    async function addClipToPlaylist(clipId) {
      const available = state.playlists.filter(playlist =>
        !state.playlistClips.some(entry => entry.playlist_id === playlist.id && entry.clip_id === clipId)
      );
      if (!available.length) return window.alert('Create a playlist first, or this clip is already in every playlist.');
      const choice = window.prompt(`Add to playlist:\n${available.map((item, index) => `${index + 1}. ${item.title}`).join('\n')}`);
      const playlist = available[Number(choice) - 1];
      if (!playlist) return;
      const position = state.playlistClips.filter(entry => entry.playlist_id === playlist.id).length;
      const result = await client.from('team_film_playlist_clips').insert({ playlist_id: playlist.id, clip_id: clipId, position });
      if (result.error) window.alert(result.error.message);
      else { await load(); render(); }
    }

    function renderLibrary() {
      if (!canView()) return '<section class="card empty-view"><h2>Film access is not enabled</h2><p>Your team role does not have film.view.</p></section>';
      if (state.loading) return '<section class="card empty-view"><h2>Loading Film Library</h2><p>Reading private team video metadata…</p></section>';
      const counts = filmId => state.clips.filter(clip => clip.film_id === filmId).length;
      const playlistCount = filmId => {
        const ids = state.clips.filter(clip => clip.film_id === filmId).map(clip => clip.id);
        return state.playlistClips.filter(entry => ids.includes(entry.clip_id)).length;
      };
      const cards = state.films.filter(film => film.upload_state !== 'deleted').map(film => `
        <article class="film-card card">
          <div class="film-card-art"><span>▶</span><small>${esc(film.upload_state)}</small></div>
          <div class="film-card-body"><div class="film-card-top"><div><span class="eyebrow">FILM</span><h2>${esc(film.title)}</h2><p>${esc(game(film.game_id)?.opponent || film.opponent || 'Practice / unassociated')}</p></div><span class="tag">${esc(film.mime_type || 'video')}</span></div>
          <div class="film-meta"><span>${film.duration_seconds ? stamp(film.duration_seconds) : 'Duration pending'}</span><span>${formatSize(film.file_size_bytes)}</span><span>${counts(film.id)} clips</span><span>${playlistCount(film.id)} playlist items</span></div>
          <div class="film-actions"><button class="btn primary" data-film-open="${esc(film.id)}">Open Film</button><button class="btn" data-film-clips="${esc(film.id)}">View Clips</button>${canEdit() ? `<button class="btn danger" data-film-delete="${esc(film.id)}">Delete</button>` : ''}</div></div>
        </article>`).join('');
      return `<div class="film-library-head"><div><span class="eyebrow">VIDEO WORKSPACE</span><h2>Film Library</h2><p>Private video for ${esc(context().teamName || 'your selected team')} · ${esc(context().seasonName || 'selected season')}</p></div>${canEdit() ? '<button class="btn primary" data-film-upload>Upload Film</button>' : ''}</div>
        ${state.error ? `<div class="callout">${esc(state.error)}</div>` : ''}<div class="film-grid">${cards || '<section class="card empty-view"><div class="empty-icon">▶</div><h2>Your Film Library is empty</h2><p>Upload an MP4 or supported video file to start building coach-controlled clips.</p></section>'}</div>`;
    }

    function renderPlayer() {
      if (!state.selectedFilm) return '';
      const film = state.selectedFilm;
      const clips = state.clips.filter(clip => clip.film_id === film.id);
      return `<section class="film-player card"><div class="film-player-head"><div><span class="eyebrow">NOW PLAYING</span><h2>${esc(film.title)}</h2><p>${esc(game(film.game_id)?.opponent || film.opponent || 'Practice film')}</p></div><button class="btn" data-film-close>Back to Library</button></div>
        ${state.signedUrl ? `<video id="filmVideo" controls playsinline preload="metadata" src="${esc(state.signedUrl)}"></video>` : '<div class="film-video-empty">Private playback URL unavailable.</div>'}
        <div class="film-markers"><div><small>IN</small><strong>${state.inPoint === null ? '—' : stamp(state.inPoint)}</strong></div><div><small>OUT</small><strong>${state.outPoint === null ? '—' : stamp(state.outPoint)}</strong></div><div><small>DURATION</small><strong>${state.inPoint !== null && state.outPoint !== null ? stamp(state.outPoint - state.inPoint) : '—'}</strong></div><button class="btn" data-film-mark-in>MARK IN</button><button class="btn" data-film-mark-out>MARK OUT</button>${canEdit() ? '<button class="btn primary" data-film-save-clip>SAVE CLIP</button>' : ''}</div>
        <div class="clip-list"><div class="card-title"><h2>Saved Clips</h2><span class="card-note">${clips.length} reference${clips.length === 1 ? '' : 's'} to this source video</span></div>${clips.map(clip => `<article class="clip-row"><div><strong>${esc(clip.title)}</strong><small>${stamp(clip.start_seconds)}–${stamp(clip.end_seconds)} · ${stamp(Number(clip.end_seconds) - Number(clip.start_seconds))}</small><p>${esc(clip.notes || (clip.tags || []).join(', '))}</p></div><div class="clip-actions"><button class="btn" data-film-play-clip="${esc(clip.id)}">Play Clip</button>${canEdit() ? `<button class="btn" data-film-add-playlist="${esc(clip.id)}">Add to Playlist</button>` : ''}</div></article>`).join('') || '<p class="sub">Mark an in and out point to save the first clip.</p>'}</div>
        <div class="clip-list"><div class="card-title"><h2>Playlists</h2>${canEdit() ? '<button class="btn primary" data-film-create-playlist>Create Playlist</button>' : ''}</div>${state.playlists.map(playlist => `<article class="clip-row"><div><strong>${esc(playlist.title)}</strong><small>${esc(playlist.sharing === 'selected_staff' ? 'Selected staff' : 'Team private')} · ${state.playlistClips.filter(entry => entry.playlist_id === playlist.id).length} clips</small></div><span class="tag">Timestamp playback</span></article>`).join('') || '<p class="sub">Create a playlist to arrange saved clips without duplicating video files.</p>'}</div></section>`;
    }

    async function upload(form) {
      const file = form.file.files[0];
      if (!file || !/^video\/(mp4|quicktime|webm|x-matroska)$/.test(file.type)) throw new Error('Choose an MP4 or supported video file.');
      if (!seasonId()) throw new Error('Select a season before uploading film.');
      state.uploading = true; state.uploadError = ''; render();
      const asset = await client.rpc('create_media_asset', { target_organization_id: context().organizationId, target_team_id: teamId(), target_season_id: seasonId(), requested_asset_type: 'game_film', requested_filename: file.name, requested_mime_type: file.type || 'video/mp4', requested_size_bytes: file.size, target_game_id: form.game_id.value || null });
      if (asset.error || !asset.data?.[0]) throw asset.error || new Error('The private media asset could not be created.');
      const meta = asset.data[0];
      const uploadResult = await client.storage.from(meta.bucket_name).upload(meta.object_path, file, { contentType: file.type || 'video/mp4', upsert: false });
      if (uploadResult.error) { await client.rpc('set_media_asset_status', { target_asset_id: meta.asset_id, next_status: 'failed' }); throw uploadResult.error; }
      const filmResult = await client.from('team_film').insert({ team_id: teamId(), season_id: seasonId(), game_id: form.game_id.value || null, title: form.title.value.trim() || file.name, storage_path: meta.object_path, media_asset_id: meta.asset_id, mime_type: file.type || 'video/mp4', file_size_bytes: file.size, upload_state: 'uploaded', uploaded_at: new Date().toISOString(), created_by: currentUser() }).select('id').single();
      if (filmResult.error) throw filmResult.error;
      await client.rpc('set_media_asset_status', { target_asset_id: meta.asset_id, next_status: 'uploaded' });
      state.uploading = false; await load(); render();
    }

    function uploadDialog() {
      const games = (context().games || []).filter(item => !seasonId() || item.season_id === seasonId());
      return `<dialog id="filmUploadDialog" class="film-dialog"><form method="dialog" id="filmUploadForm"><div class="card-title"><h2>Upload Film</h2><button class="btn" value="cancel">Close</button></div><label>Title<input name="title" required maxlength="160" placeholder="vs. opponent · 2026-09-15"></label><label>Associate with game (optional)<select name="game_id"><option value="">Practice / no game</option>${games.map(item => `<option value="${esc(item.id)}">${esc(item.opponent)} · ${esc(item.date)}</option>`).join('')}</select></label><label>Video file<input name="file" type="file" accept="video/mp4,video/quicktime,video/webm,video/x-matroska" required></label><p class="sub">The original file is uploaded once to private PuckNexus storage. Large uploads are not buffered into page memory.</p><progress id="filmUploadProgress" max="1" value="0" hidden></progress><p id="filmUploadStatus" role="status"></p><div class="actions"><button class="btn primary" type="submit">Upload Film</button></div></form></dialog>`;
    }

    function render() {
      const host = document.querySelector('#app');
      if (!host) return;
      host.innerHTML = `<div class="page-head"><div><div class="eyebrow">PUCKNEXUS · ${esc(context().teamName || 'TEAM')} WORKSPACE</div><h1>Film Room</h1><p>Manual video breakdown with timestamp clips and private team sharing.</p></div></div>${state.selectedFilm ? renderPlayer() : renderLibrary()}${uploadDialog()}`;
      bind();
    }

    function bind() {
      document.querySelector('[data-film-upload]')?.addEventListener('click', () => document.querySelector('#filmUploadDialog').showModal());
      document.querySelector('#filmUploadForm')?.addEventListener('submit', async event => {
        event.preventDefault(); const status = document.querySelector('#filmUploadStatus'); status.textContent = 'Uploading to private storage…';
        try { await upload(event.currentTarget); } catch (error) { state.uploading = false; status.textContent = error.message || 'Upload failed — retry.'; }
      });
      document.querySelectorAll('[data-film-open], [data-film-clips]').forEach(button => button.addEventListener('click', () => openFilm(button.dataset.filmOpen || button.dataset.filmClips)));
      document.querySelectorAll('[data-film-delete]').forEach(button => button.addEventListener('click', () => deleteFilm(button.dataset.filmDelete)));
      document.querySelector('[data-film-create-playlist]')?.addEventListener('click', createPlaylist);
      document.querySelectorAll('[data-film-add-playlist]').forEach(button => button.addEventListener('click', () => addClipToPlaylist(button.dataset.filmAddPlaylist)));
      document.querySelector('[data-film-close]')?.addEventListener('click', () => { state.selectedFilm = null; state.signedUrl = ''; render(); });
      document.querySelector('[data-film-mark-in]')?.addEventListener('click', () => { const video = document.querySelector('#filmVideo'); if (video) { state.inPoint = video.currentTime; render(); } });
      document.querySelector('[data-film-mark-out]')?.addEventListener('click', () => { const video = document.querySelector('#filmVideo'); if (video) { state.outPoint = video.currentTime; render(); } });
      document.querySelector('[data-film-save-clip]')?.addEventListener('click', async () => {
        if (state.inPoint === null || state.outPoint === null || state.outPoint <= state.inPoint) return window.alert('MARK IN must be before MARK OUT.');
        const title = window.prompt('Clip name'); if (!title?.trim()) return;
        const result = await client.from('team_film_clips').insert({ film_id: state.selectedFilm.id, title: title.trim(), start_seconds: state.inPoint, end_seconds: state.outPoint, created_by: currentUser() });
        if (result.error) window.alert(result.error.message); else { state.inPoint = null; state.outPoint = null; await load(); render(); }
      });
      document.querySelectorAll('[data-film-play-clip]').forEach(button => button.addEventListener('click', () => {
        const clip = state.clips.find(item => item.id === button.dataset.filmPlayClip); const video = document.querySelector('#filmVideo');
        if (!clip || !video) return; video.currentTime = Number(clip.start_seconds); state.playbackClip = clip.id; video.play().catch(() => {}); video.ontimeupdate = () => { if (video.currentTime >= Number(clip.end_seconds)) { video.pause(); video.ontimeupdate = null; } };
      }));
    }

    return { load, render, setContext: () => {}, capabilities: { canView, canEdit, canShare } };
  }
  window.FoxesFilmRoom = Object.freeze({ createFilmRoom });
})();
