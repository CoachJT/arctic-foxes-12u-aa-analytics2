'use strict';

// Film Web 1.0 keeps the original source video in private Supabase storage.
// Clips and playlist items are timestamp references; no duplicate videos are generated.
(function () {
  const VIDEO_TYPES = Object.freeze(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska']);
  const LARGE_FILE_AUDIT = Object.freeze({
    protocol: 'Supabase Storage resumable uploads use the TUS protocol through tus-js-client.',
    endpoint: 'Use the direct storage hostname: https://<project-ref>.storage.supabase.co/storage/v1/upload/resumable.',
    chunkSize: 'Supabase requires 6 MiB TUS chunks.',
    recovery: 'tus-js-client can find previous uploads for the same File fingerprint and resume after transient interruption.',
    caveat: 'Upload URLs expire after roughly 24 hours; after that the coach must restart the upload.'
  });
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const stamp = seconds => {
    const value = Math.max(0, Number(seconds) || 0);
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60).toString().padStart(hours ? 2 : 1, '0');
    const secs = Math.floor(value % 60).toString().padStart(2, '0');
    return hours ? `${hours}:${minutes}:${secs}` : `${minutes}:${secs}`;
  };
  const parseTags = value => String(value || '').split(',').map(tag => tag.trim()).filter(Boolean);
  const formatDate = value => value ? new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' }) : 'Date unavailable';
  const formatSize = bytes => bytes ? `${(Number(bytes) / 1073741824).toFixed(2)} GB` : 'Size unavailable';
  const sortByPosition = (a, b) => Number(a.position) - Number(b.position);

  function createFilmRoom({ client, supabaseUrl, publishableKey, projectRef, getContext }) {
    const state = {
      films: [], clips: [], playlists: [], playlistClips: [], shares: [], staff: [],
      loading: false, error: '', success: '', selectedFilmId: '', signedUrls: new Map(),
      inPoint: null, outPoint: null, scopedGameId: '', uploadOpen: false, uploading: false,
      upload: { status: 'idle', message: '', filename: '', size: 0, progress: 0, bytesUploaded: 0, bytesTotal: 0, filmId: '', assetId: '', canResume: false, canCancel: false },
      currentUpload: null, lastUploadRequest: null,
      playback: { playlistId: '', index: 0, playing: false }
    };

    const context = () => getContext() || {};
    const teamId = () => context().teamId || '';
    const seasonId = () => context().seasonId || null;
    const currentUser = () => context().userId || '';
    const capabilities = () => context().capabilities || [];
    const canView = () => capabilities().includes('film.view');
    const canEdit = () => capabilities().includes('film.edit');
    const canShare = () => capabilities().includes('film.share');
    const games = () => context().games || [];
    const findGame = id => games().find(game => game.id === id || game.source_game_id === id);
    const selectedFilm = () => state.films.find(film => film.id === state.selectedFilmId) || null;
    const filmClips = filmId => state.clips.filter(clip => clip.film_id === filmId).sort((a, b) => Number(a.start_seconds) - Number(b.start_seconds));
    const playlistItems = playlistId => state.playlistClips.filter(item => item.playlist_id === playlistId).sort(sortByPosition);
    const clipById = id => state.clips.find(clip => clip.id === id);
    const filmById = id => state.films.find(film => film.id === id);
    const scopedGame = () => findGame(state.scopedGameId);
    const tusEndpoint = () => `https://${projectRef || new URL(supabaseUrl).hostname.split('.')[0]}.storage.supabase.co/storage/v1/upload/resumable`;

    function visibleFilms() {
      const active = state.films.filter(film => film.upload_state !== 'deleted');
      const scoped = state.scopedGameId ? active.filter(film => film.game_id === state.scopedGameId) : active;
      const rest = state.scopedGameId ? active.filter(film => film.game_id !== state.scopedGameId) : [];
      return [...scoped, ...rest];
    }

    async function load() {
      if (!canView() || !teamId()) return;
      state.loading = true; state.error = '';
      try {
        const filmQuery = client.from('team_film').select('id,team_id,season_id,game_id,title,opponent,game_date,storage_path,media_asset_id,upload_state,duration_seconds,mime_type,file_size_bytes,created_by,created_at,uploaded_at').eq('team_id', teamId()).order('created_at', { ascending: false });
        const playlistQuery = client.from('team_film_playlists').select('id,team_id,title,topic,sharing,created_by,created_at').eq('team_id', teamId()).order('created_at', { ascending: false });
        const [filmResult, playlistResult] = await Promise.all([filmQuery, playlistQuery]);
        for (const result of [filmResult, playlistResult]) if (result.error) throw result.error;
        state.films = filmResult.data || [];
        state.playlists = playlistResult.data || [];

        const filmIds = state.films.map(film => film.id);
        state.clips = [];
        if (filmIds.length) {
          const clipResult = await client.from('team_film_clips').select('id,film_id,title,notes,tags,start_seconds,end_seconds,created_by,created_at').in('film_id', filmIds).order('created_at', { ascending: false });
          if (clipResult.error) throw clipResult.error;
          state.clips = clipResult.data || [];
        }

        const playlistIds = state.playlists.map(playlist => playlist.id);
        state.playlistClips = []; state.shares = [];
        if (playlistIds.length) {
          const [itemsResult, sharesResult] = await Promise.all([
            client.from('team_film_playlist_clips').select('playlist_id,clip_id,position').in('playlist_id', playlistIds).order('position'),
            client.from('team_film_playlist_shares').select('playlist_id,user_id').in('playlist_id', playlistIds)
          ]);
          if (itemsResult.error) throw itemsResult.error;
          if (sharesResult.error) throw sharesResult.error;
          state.playlistClips = itemsResult.data || [];
          state.shares = sharesResult.data || [];
        }
        if (canShare()) await loadStaff();
      } catch (error) {
        state.error = error.message || 'Film could not be loaded.';
      } finally {
        state.loading = false;
      }
    }

    async function loadStaff() {
      const result = await client.from('team_memberships').select('user_id,status,roles(label)').eq('team_id', teamId()).eq('status', 'active').order('user_id');
      if (result.error) throw result.error;
      state.staff = (result.data || []).filter(member => member.status === 'active');
    }

    async function signFilm(film) {
      if (!film?.storage_path || film.upload_state !== 'uploaded') return '';
      if (state.signedUrls.has(film.id)) return state.signedUrls.get(film.id);
      const result = await client.storage.from('game-film').createSignedUrl(film.storage_path, 3600);
      if (result.error) throw new Error(`Playback access failed: ${result.error.message}`);
      state.signedUrls.set(film.id, result.data.signedUrl);
      return result.data.signedUrl;
    }

    async function openFilm(id) {
      const film = filmById(id);
      if (!film) return;
      state.selectedFilmId = film.id; state.inPoint = null; state.outPoint = null; state.error = '';
      try { await signFilm(film); } catch (error) { state.error = error.message; }
      render();
    }

    function openForGame(gameId) {
      state.scopedGameId = gameId || '';
      state.selectedFilmId = '';
      render();
      load().then(() => {
        const first = visibleFilms().find(film => film.game_id === state.scopedGameId);
        if (first) openFilm(first.id);
        else render();
      });
    }

    function resetScope() {
      state.scopedGameId = '';
      state.selectedFilmId = '';
      render();
    }

    function validateClip(start, end, duration) {
      if (!Number.isFinite(start) || start < 0) throw new Error('Clip start must be 0 seconds or later.');
      if (!Number.isFinite(end) || end <= start) throw new Error('Clip end must be after clip start.');
      if (Number.isFinite(duration) && duration > 0 && end > duration + 0.05) throw new Error('Clip end cannot exceed the known video duration.');
    }

    async function saveClipFromMarkers() {
      const film = selectedFilm();
      const video = document.querySelector('#filmVideo');
      validateClip(Number(state.inPoint), Number(state.outPoint), video?.duration);
      const title = window.prompt('Clip name');
      if (!title?.trim()) return;
      const notes = window.prompt('Notes (optional)') || '';
      const tags = parseTags(window.prompt('Tags, comma-separated (optional)') || '');
      const result = await client.from('team_film_clips').insert({
        film_id: film.id, title: title.trim(), notes, tags,
        start_seconds: state.inPoint, end_seconds: state.outPoint, created_by: currentUser()
      });
      if (result.error) throw result.error;
      state.inPoint = null; state.outPoint = null; state.success = 'Clip saved.';
      await load(); render();
    }

    async function editClip(id) {
      const clip = clipById(id);
      if (!clip) return;
      const title = window.prompt('Clip name', clip.title);
      if (!title?.trim()) return;
      const start = Number(window.prompt('IN seconds', clip.start_seconds));
      const end = Number(window.prompt('OUT seconds', clip.end_seconds));
      const notes = window.prompt('Notes', clip.notes || '') || '';
      const tags = parseTags(window.prompt('Tags, comma-separated', (clip.tags || []).join(', ')) || '');
      validateClip(start, end, filmById(clip.film_id)?.duration_seconds);
      const result = await client.from('team_film_clips').update({ title: title.trim(), notes, tags, start_seconds: start, end_seconds: end }).eq('id', id);
      if (result.error) throw result.error;
      state.success = 'Clip updated.';
      await load(); render();
    }

    async function deleteClip(id) {
      const memberships = state.playlistClips.filter(item => item.clip_id === id).length;
      if (!window.confirm(`Delete this clip? ${memberships ? `It will be removed from ${memberships} playlist position${memberships === 1 ? '' : 's'}. ` : ''}The original video will not be deleted.`)) return;
      const result = await client.from('team_film_clips').delete().eq('id', id);
      if (result.error) throw result.error;
      state.success = 'Clip deleted. Original film preserved.';
      await load(); render();
    }

    async function createPlaylist() {
      const title = window.prompt('Playlist name');
      if (!title?.trim()) return;
      const result = await client.from('team_film_playlists').insert({ team_id: teamId(), title: title.trim(), sharing: 'team_private', created_by: currentUser() });
      if (result.error) throw result.error;
      state.success = 'Playlist created.';
      await load(); render();
    }

    async function deletePlaylist(id) {
      const itemCount = playlistItems(id).length;
      if (!window.confirm(`Delete this playlist and its ${itemCount} clip reference${itemCount === 1 ? '' : 's'}? Source videos and saved clips remain available.`)) return;
      const result = await client.from('team_film_playlists').delete().eq('id', id);
      if (result.error) throw result.error;
      state.success = 'Playlist deleted. Source clips preserved.';
      await load(); render();
    }

    async function addClipToPlaylist(clipId) {
      const available = state.playlists.filter(playlist => !state.playlistClips.some(item => item.playlist_id === playlist.id && item.clip_id === clipId));
      if (!available.length) return window.alert('Create a playlist first, or this clip is already in every playlist.');
      const choice = window.prompt(`Add to playlist:\n${available.map((item, index) => `${index + 1}. ${item.title}`).join('\n')}`);
      const playlist = available[Number(choice) - 1];
      if (!playlist) return;
      const position = playlistItems(playlist.id).length;
      const result = await client.from('team_film_playlist_clips').insert({ playlist_id: playlist.id, clip_id: clipId, position });
      if (result.error) throw result.error;
      state.success = 'Clip added to playlist.';
      await load(); render();
    }

    async function removePlaylistClip(playlistId, clipId) {
      const result = await client.from('team_film_playlist_clips').delete().eq('playlist_id', playlistId).eq('clip_id', clipId);
      if (result.error) throw result.error;
      await renumberPlaylist(playlistId);
      state.success = 'Clip removed from playlist.';
      await load(); render();
    }

    async function movePlaylistClip(playlistId, clipId, delta) {
      const items = playlistItems(playlistId);
      const index = items.findIndex(item => item.clip_id === clipId);
      const next = index + delta;
      if (index < 0 || next < 0 || next >= items.length) return;
      [items[index], items[next]] = [items[next], items[index]];
      await savePlaylistOrder(playlistId, items.map(item => item.clip_id));
    }

    async function savePlaylistOrder(playlistId, clipIds) {
      const updates = clipIds.map((clipId, position) => client.from('team_film_playlist_clips').update({ position }).eq('playlist_id', playlistId).eq('clip_id', clipId));
      const results = await Promise.all(updates);
      const failed = results.find(result => result.error);
      if (failed) throw failed.error;
      state.success = 'Playlist order saved.';
      await load(); render();
    }

    async function renumberPlaylist(playlistId) {
      const ids = playlistItems(playlistId).map(item => item.clip_id);
      if (ids.length) await savePlaylistOrder(playlistId, ids);
    }

    async function saveSharing(form) {
      const playlistId = form.playlist_id.value;
      if (!canShare()) throw new Error('film.share is required to modify playlist sharing.');
      const sharing = form.sharing.value;
      const selected = Array.from(form.querySelectorAll('[name="staff"]:checked')).map(input => input.value);
      const playlistResult = await client.from('team_film_playlists').update({ sharing }).eq('id', playlistId).eq('team_id', teamId());
      if (playlistResult.error) throw playlistResult.error;
      const deleteResult = await client.from('team_film_playlist_shares').delete().eq('playlist_id', playlistId);
      if (deleteResult.error) throw deleteResult.error;
      if (sharing === 'selected_staff' && selected.length) {
        const rows = selected.map(userId => ({ playlist_id: playlistId, user_id: userId }));
        const insertResult = await client.from('team_film_playlist_shares').insert(rows);
        if (insertResult.error) throw insertResult.error;
      }
      state.success = 'Sharing updated.';
      await load(); render();
    }

    async function deleteFilm(id) {
      const clips = filmClips(id);
      const playlistRefs = state.playlistClips.filter(item => clips.some(clip => clip.id === item.clip_id)).length;
      const film = filmById(id);
      if (!window.confirm(`Delete "${film?.title || 'this film'}"?\n\nClips: ${clips.length}\nPlaylist references: ${playlistRefs}\n\nFilm deletion is blocked while clips exist. Remove clips first so no coach work is silently destroyed.`)) return;
      if (clips.length || playlistRefs) return;
      const result = await client.from('team_film').update({ upload_state: 'deleted' }).eq('id', id).eq('team_id', teamId());
      if (result.error) throw result.error;
      state.success = 'Film marked deleted.';
      await load(); render();
    }

    function setUploadStatus(next) {
      state.upload = { ...state.upload, ...next };
      const status = document.querySelector('#filmUploadStatus');
      const bar = document.querySelector('#filmUploadProgress');
      if (status) status.textContent = state.upload.message || state.upload.status;
      if (bar) {
        bar.hidden = state.upload.status === 'idle' || state.upload.status === 'preparing';
        bar.max = state.upload.bytesTotal || 1;
        bar.value = state.upload.bytesUploaded || 0;
      }
    }

    function validateUploadFile(file) {
      if (!file) throw new Error('Choose a video file.');
      if (!VIDEO_TYPES.includes(file.type)) throw new Error('Choose MP4, MOV, WebM, or MKV video.');
      return {
        supported: true,
        warning: file.type === 'video/mp4'
          ? ''
          : 'MP4 is preferred. This file type may depend on browser playback support after upload.',
        large: file.size >= 2 * 1024 * 1024 * 1024
      };
    }

    async function createUploadRecords(form, file) {
      const targetGameId = form.game_id.value || state.scopedGameId || null;
      const asset = await client.rpc('create_media_asset', {
        target_organization_id: context().organizationId, target_team_id: teamId(), target_season_id: seasonId(),
        requested_asset_type: 'game_film', requested_filename: file.name, requested_mime_type: file.type,
        requested_size_bytes: file.size, target_game_id: targetGameId
      });
      if (asset.error || !asset.data?.[0]) throw asset.error || new Error('The private media asset could not be created.');
      const meta = asset.data[0];
      const filmResult = await client.from('team_film').insert({
        team_id: teamId(), season_id: seasonId(), game_id: targetGameId,
        title: form.title.value.trim() || file.name, storage_path: meta.object_path, media_asset_id: meta.asset_id,
        mime_type: file.type, file_size_bytes: file.size, upload_state: 'uploading',
        created_by: currentUser()
      }).select('id').single();
      if (filmResult.error) {
        await client.rpc('set_media_asset_status', { target_asset_id: meta.asset_id, next_status: 'failed' });
        throw filmResult.error;
      }
      return { ...meta, filmId: filmResult.data.id, targetGameId };
    }

    async function markUploadFailed(meta, message) {
      if (meta?.asset_id) await client.rpc('set_media_asset_status', { target_asset_id: meta.asset_id, next_status: 'failed' });
      if (meta?.filmId) await client.from('team_film').update({ upload_state: 'failed' }).eq('id', meta.filmId).eq('team_id', teamId());
      setUploadStatus({ status: 'failed', message, canResume: Boolean(state.lastUploadRequest), canCancel: false });
      await load();
    }

    async function finalizeUpload(meta) {
      setUploadStatus({ status: 'processing', progress: 100, message: 'Processing/finalizing private film…', canResume: false, canCancel: false });
      const filmResult = await client.from('team_film').update({ upload_state: 'uploaded', uploaded_at: new Date().toISOString() }).eq('id', meta.filmId).eq('team_id', teamId());
      if (filmResult.error) throw filmResult.error;
      const mediaResult = await client.rpc('set_media_asset_status', { target_asset_id: meta.asset_id, next_status: 'uploaded' });
      if (mediaResult.error) throw mediaResult.error;
      state.success = 'Film upload complete.';
      setUploadStatus({ status: 'complete', progress: 100, message: 'Complete', filmId: meta.filmId, assetId: meta.asset_id });
      state.uploadOpen = false;
      state.lastUploadRequest = null;
      await load();
    }

    async function runTusUpload({ file, meta }) {
      if (!window.tus?.Upload) throw new Error('Resumable upload support did not load. Refresh and try again.');
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      const token = data?.session?.access_token;
      if (!token) throw new Error('Sign in again before uploading film.');
      setUploadStatus({ status: 'uploading', message: 'Uploading with resumable private storage…', canCancel: true });
      await new Promise((resolve, reject) => {
        const upload = new window.tus.Upload(file, {
          endpoint: tusEndpoint(),
          retryDelays: [0, 3000, 5000, 10000, 20000],
          headers: {
            authorization: `Bearer ${token}`,
            apikey: publishableKey,
            'x-upsert': 'false'
          },
          uploadDataDuringCreation: true,
          removeFingerprintOnSuccess: true,
          chunkSize: 6 * 1024 * 1024,
          metadata: {
            bucketName: meta.bucket_name,
            objectName: meta.object_path,
            contentType: file.type,
            cacheControl: '3600',
            metadata: JSON.stringify({ asset_id: meta.asset_id, film_id: meta.filmId, team_id: teamId(), season_id: seasonId(), game_id: meta.targetGameId })
          },
          onError(error) {
            setUploadStatus({ status: 'interrupted', message: 'Paused/interrupted. Retry resumes where supported.', canResume: true, canCancel: false });
            reject(error);
          },
          onProgress(bytesUploaded, bytesTotal) {
            const progress = bytesTotal ? Math.floor((bytesUploaded / bytesTotal) * 100) : 0;
            setUploadStatus({
              status: 'uploading', bytesUploaded, bytesTotal, progress,
              message: `Uploading ${progress}% (${formatSize(bytesUploaded)} of ${formatSize(bytesTotal)})`,
              canCancel: true
            });
          },
          onSuccess() { resolve(); }
        });
        state.currentUpload = upload;
        upload.findPreviousUploads().then(previousUploads => {
          if (previousUploads.length) {
            setUploadStatus({ status: 'resuming', message: 'Retrying/resuming previous upload…', canCancel: true });
            upload.resumeFromPreviousUpload(previousUploads[0]);
          }
          upload.start();
        }).catch(reject);
      });
    }

    async function resumeUpload() {
      if (!state.lastUploadRequest || state.uploading) return;
      state.uploading = true;
      try {
        await runTusUpload(state.lastUploadRequest);
        await finalizeUpload(state.lastUploadRequest.meta);
      } catch (error) {
        await markUploadFailed(state.lastUploadRequest.meta, error.message || 'Upload failed. Retry can resume while the TUS upload URL is valid.');
      } finally {
        state.currentUpload = null;
        state.uploading = false;
        render();
      }
    }

    async function cancelUpload() {
      if (!state.currentUpload) return;
      const request = state.lastUploadRequest;
      await state.currentUpload.abort(false);
      if (request?.meta) await markUploadFailed(request.meta, 'Upload cancelled. The incomplete film is marked failed and is not playable.');
      state.currentUpload = null;
      state.uploading = false;
      render();
    }

    async function cleanFailedFilm(id) {
      if (!window.confirm('Remove this failed upload entry? The source video was never made playable.')) return;
      const result = await client.from('team_film').update({ upload_state: 'deleted' }).eq('id', id).eq('team_id', teamId());
      if (result.error) throw result.error;
      state.success = 'Failed upload entry removed.';
      await load(); render();
    }

    async function upload(form) {
      const submit = form.querySelector('[type="submit"]');
      if (state.uploading) return;
      const file = form.file.files[0];
      const validation = validateUploadFile(file);
      if (!seasonId()) throw new Error('Select a season before uploading film.');
      state.uploading = true; state.error = ''; state.success = '';
      setUploadStatus({
        status: 'preparing', filename: file.name, size: file.size, progress: 0, bytesUploaded: 0, bytesTotal: file.size,
        message: `Preparing ${file.name} (${formatSize(file.size)})${validation.large ? ' · Very large file: keep this tab open.' : ''}`,
        canResume: false, canCancel: false
      });
      if (submit) submit.disabled = true;
      try {
        const meta = await createUploadRecords(form, file);
        state.lastUploadRequest = { file, meta };
        await runTusUpload(state.lastUploadRequest);
        await finalizeUpload(meta);
        await load();
      } catch (error) {
        await markUploadFailed(state.lastUploadRequest?.meta, error.message || 'Upload failed. Retry can resume while the TUS upload URL is valid.');
        throw error;
      } finally {
        state.currentUpload = null;
        state.uploading = false;
      }
      render();
    }

    async function playClip(clipId) {
      const clip = clipById(clipId);
      const film = filmById(clip?.film_id);
      if (!clip || !film) return;
      if (state.selectedFilmId !== film.id) {
        state.selectedFilmId = film.id;
        await signFilm(film);
        render();
      }
      const video = document.querySelector('#filmVideo');
      if (!video) return;
      video.currentTime = Number(clip.start_seconds);
      video.play().catch(() => {});
      video.ontimeupdate = () => {
        if (video.currentTime >= Number(clip.end_seconds)) {
          video.pause();
          video.ontimeupdate = null;
          if (state.playback.playing) nextPlaylistClip();
        }
      };
    }

    async function openPlaylist(playlistId) {
      state.playback = { playlistId, index: 0, playing: false };
      render();
    }

    async function startPlaylist(playlistId, index = 0) {
      const items = playlistItems(playlistId);
      if (!items.length) return;
      state.playback = { playlistId, index: Math.max(0, Math.min(index, items.length - 1)), playing: true };
      await playClip(items[state.playback.index].clip_id);
      renderPlaylistStatus();
    }

    async function nextPlaylistClip() {
      const items = playlistItems(state.playback.playlistId);
      if (state.playback.index + 1 >= items.length) {
        state.playback.playing = false;
        renderPlaylistStatus();
        return;
      }
      await startPlaylist(state.playback.playlistId, state.playback.index + 1);
    }

    async function previousPlaylistClip() {
      if (!state.playback.playlistId) return;
      await startPlaylist(state.playback.playlistId, Math.max(0, state.playback.index - 1));
    }

    function renderScopedHeader() {
      const game = scopedGame();
      if (!game) return '';
      return `<section class="card film-game-scope"><div><span class="eyebrow">GAME FILM</span><h2>${esc(game.opponent || 'Opponent unavailable')}</h2><p>${esc(formatDate(game.date))} · Film opened from Game Center</p></div><button class="btn" data-film-clear-scope>Show All Film</button></section>`;
    }

    function renderLibrary() {
      if (!canView()) return '<section class="card empty-view"><h2>Film access is not enabled</h2><p>Your team role does not have film.view.</p></section>';
      if (state.loading) return '<section class="card empty-view"><h2>Loading Film Library</h2><p>Reading private team video metadata…</p></section>';
      const cards = visibleFilms().map(film => {
        const game = findGame(film.game_id);
        const clips = filmClips(film.id);
        const refs = state.playlistClips.filter(item => clips.some(clip => clip.id === item.clip_id)).length;
        const scoped = state.scopedGameId && film.game_id === state.scopedGameId;
        const ready = film.upload_state === 'uploaded';
        const failed = film.upload_state === 'failed';
        const uploading = film.upload_state === 'uploading' || film.upload_state === 'pending';
        return `<article class="film-card card${scoped ? ' scoped' : ''}" data-film-card="${esc(film.id)}">
          <div class="film-card-art"><span>▶</span><small>${esc(film.upload_state || 'uploaded')}</small></div>
          <div class="film-card-body"><div class="film-card-top"><div><span class="eyebrow">${scoped ? 'ASSOCIATED GAME FILM' : 'FILM'}</span><h2>${esc(film.title)}</h2><p>${esc(game?.opponent || film.opponent || 'Practice / unassociated')} · ${esc(formatDate(game?.date || film.game_date))}</p></div><span class="tag">${esc(film.mime_type || 'video')}</span></div>
          <div class="film-meta"><span>${film.duration_seconds ? stamp(film.duration_seconds) : 'Duration pending'}</span><span>${formatSize(film.file_size_bytes)}</span><span>${clips.length} clips</span><span>${refs} playlist refs</span><span>Uploaded ${esc(formatDate((film.uploaded_at || film.created_at || '').slice(0, 10)))}</span></div>
          <div class="film-actions">${ready ? `<button class="btn primary" data-film-open="${esc(film.id)}">Open Film</button><button class="btn" data-film-clips="${esc(film.id)}">View Clips</button>` : `<span class="tag">${uploading ? 'Upload in progress — not playable yet' : 'Failed upload — not playable'}</span>`}${failed && canEdit() ? `<button class="btn" data-film-resume-upload>Retry / Resume</button><button class="btn danger" data-film-clean-failed="${esc(film.id)}">Clean Up Failed Upload</button>` : ''}${canEdit() ? `<button class="btn danger" data-film-delete="${esc(film.id)}">Delete Film</button>` : ''}</div></div>
        </article>`;
      }).join('');
      const uploadLabel = state.scopedGameId ? 'Upload Film for This Game' : 'Upload Film';
      return `${renderScopedHeader()}<div class="film-library-head"><div><span class="eyebrow">VIDEO WORKSPACE</span><h2>Film Library</h2><p>Private video for ${esc(context().teamName || 'your selected team')} · ${esc(context().seasonName || 'selected season')}</p></div>${canEdit() ? `<button class="btn primary" data-film-upload>${uploadLabel}</button>` : ''}</div>
        ${state.error ? `<div class="callout">${esc(state.error)}</div>` : ''}${state.success ? `<div class="callout success">${esc(state.success)}</div>` : ''}<div class="film-grid">${cards || '<section class="card polish-empty film-empty"><span class="eyebrow">THE GAME DOESN’T END AT THE BUZZER</span><h2>Every shift has a story.<br>Find the moments that matter.</h2><p>No film for this view. Upload an MP4 or supported private video to start building coach-controlled clips.</p><ol class="polish-steps"><li><span>01</span><h3>Upload</h3><p>Bring private team video into the library.</p></li><li><span>02</span><h3>Organize</h3><p>Connect film to the right game.</p></li><li><span>03</span><h3>Clip</h3><p>Mark the moments worth revisiting.</p></li><li><span>04</span><h3>Review</h3><p>Build playlists for the next conversation.</p></li></ol><span class="tag">Private team film · Coach-controlled clips</span></section>'}</div>`;
    }

    function renderPlayer() {
      const film = selectedFilm();
      if (!film) return '';
      const game = findGame(film.game_id);
      const clips = filmClips(film.id);
      return `<section class="film-player card"><div class="film-player-head"><div><span class="eyebrow">NOW PLAYING</span><h2>${esc(film.title)}</h2><p>${esc(game?.opponent || film.opponent || 'Practice film')} · ${esc(formatDate(game?.date || film.game_date))}</p></div><button class="btn" data-film-close>Back to Library</button></div>
        ${state.signedUrls.get(film.id) ? `<video id="filmVideo" controls playsinline preload="metadata" src="${esc(state.signedUrls.get(film.id))}"></video>` : '<div class="film-video-empty">Private playback URL unavailable.</div>'}
        <div class="film-markers"><div><small>IN</small><strong>${state.inPoint === null ? '-' : stamp(state.inPoint)}</strong></div><div><small>OUT</small><strong>${state.outPoint === null ? '-' : stamp(state.outPoint)}</strong></div><div><small>DURATION</small><strong>${state.inPoint !== null && state.outPoint !== null ? stamp(state.outPoint - state.inPoint) : '-'}</strong></div><button class="btn" data-film-mark-in>MARK IN</button><button class="btn" data-film-mark-out>MARK OUT</button><button class="btn" data-film-reset-markers>Reset</button>${canEdit() ? '<button class="btn primary" data-film-save-clip>SAVE CLIP</button>' : ''}</div>
        <div class="film-workspace-grid"><div class="clip-list"><div class="card-title"><h2>Saved Clips</h2><span class="card-note">${clips.length} timestamp reference${clips.length === 1 ? '' : 's'}</span></div>${renderClips(clips)}</div>${renderPlaylists()}</div></section>`;
    }

    function renderClips(clips) {
      return clips.map(clip => `<article class="clip-row"><div><strong>${esc(clip.title)}</strong><small>${stamp(clip.start_seconds)}-${stamp(clip.end_seconds)} · ${stamp(Number(clip.end_seconds) - Number(clip.start_seconds))}</small><p>${esc(clip.notes || '')}${clip.tags?.length ? ` · ${clip.tags.map(tag => `<span class="tag">${esc(tag)}</span>`).join(' ')}` : ''}</p></div><div class="clip-actions"><button class="btn" data-film-play-clip="${esc(clip.id)}">Play Clip</button>${canEdit() ? `<button class="btn" data-film-edit-clip="${esc(clip.id)}">Edit</button><button class="btn" data-film-add-playlist="${esc(clip.id)}">Add to Playlist</button><button class="btn danger" data-film-delete-clip="${esc(clip.id)}">Delete</button>` : ''}</div></article>`).join('') || '<p class="sub">Mark an in and out point to save the first clip.</p>';
    }

    function renderPlaylists() {
      return `<div class="clip-list"><div class="card-title"><h2>Playlists</h2>${canEdit() ? '<button class="btn primary" data-film-create-playlist>Create Playlist</button>' : ''}</div>${state.playlists.map(renderPlaylist).join('') || '<p class="sub">Create a playlist to arrange saved clips without duplicating video files.</p>'}</div>`;
    }

    function renderPlaylist(playlist) {
      const items = playlistItems(playlist.id);
      const shareCount = state.shares.filter(share => share.playlist_id === playlist.id).length;
      return `<article class="playlist-card" data-playlist="${esc(playlist.id)}"><div class="playlist-head"><div><strong>${esc(playlist.title)}</strong><small>${items.length} clips · ${esc(playlist.sharing === 'selected_staff' ? `Selected staff (${shareCount})` : 'Team private')}</small></div><div class="film-actions"><button class="btn" data-film-open-playlist="${esc(playlist.id)}">Open Playlist</button><button class="btn" data-film-play-playlist="${esc(playlist.id)}">Play Playlist</button>${canShare() ? `<button class="btn" data-film-share-playlist="${esc(playlist.id)}">Share</button>` : ''}${canEdit() ? `<button class="btn danger" data-film-delete-playlist="${esc(playlist.id)}">Delete</button>` : ''}</div></div>
      <ol class="playlist-items">${items.map((item, index) => {
        const clip = clipById(item.clip_id);
        const film = filmById(clip?.film_id);
        return `<li draggable="${canEdit()}" data-clip-id="${esc(item.clip_id)}"><span>${index + 1}. ${esc(clip?.title || 'Missing clip')}</span><small>${esc(film?.title || '')} · ${clip ? `${stamp(clip.start_seconds)}-${stamp(clip.end_seconds)}` : ''}</small>${canEdit() ? `<button class="btn" data-film-move-up="${esc(playlist.id)}:${esc(item.clip_id)}">Up</button><button class="btn" data-film-move-down="${esc(playlist.id)}:${esc(item.clip_id)}">Down</button><button class="btn danger" data-film-remove-playlist-clip="${esc(playlist.id)}:${esc(item.clip_id)}">Remove</button>` : ''}</li>`;
      }).join('')}</ol><div class="playlist-status" data-playlist-status="${esc(playlist.id)}"></div>${canShare() ? renderSharePanel(playlist) : ''}</article>`;
    }

    function renderSharePanel(playlist) {
      const selected = new Set(state.shares.filter(share => share.playlist_id === playlist.id).map(share => share.user_id));
      return `<form class="share-panel" data-share-form hidden><input type="hidden" name="playlist_id" value="${esc(playlist.id)}"><label><input type="radio" name="sharing" value="team_private" ${playlist.sharing !== 'selected_staff' ? 'checked' : ''}> TEAM PRIVATE</label><label><input type="radio" name="sharing" value="selected_staff" ${playlist.sharing === 'selected_staff' ? 'checked' : ''}> SELECTED STAFF</label><div class="staff-select">${state.staff.map(member => `<label><input type="checkbox" name="staff" value="${esc(member.user_id)}" ${selected.has(member.user_id) ? 'checked' : ''}> ${esc(member.roles?.label || member.user_id)}</label>`).join('') || '<p class="sub">No active same-team staff loaded.</p>'}</div><button class="btn primary" type="submit">Save Sharing</button></form>`;
    }

    function renderUploadDialog() {
      const scope = scopedGame();
      const options = games().filter(game => !seasonId() || game.season_id === seasonId()).map(game => `<option value="${esc(game.id)}" ${game.id === state.scopedGameId ? 'selected' : ''}>${esc(game.opponent)} · ${esc(formatDate(game.date))}</option>`).join('');
      return `<dialog id="filmUploadDialog" class="film-dialog" ${state.uploadOpen ? 'open' : ''}><form method="dialog" id="filmUploadForm"><div class="card-title"><h2>${scope ? 'Upload Film for This Game' : 'Upload Film'}</h2><button class="btn" value="cancel" data-film-cancel-upload ${state.uploading ? 'disabled' : ''}>Close</button></div>${scope ? `<div class="callout"><strong>${esc(scope.opponent || 'Game')}</strong><br>${esc(formatDate(scope.date))}</div>` : ''}<label>Title<input name="title" required maxlength="160" placeholder="vs. opponent · 2026-09-15" ${state.uploading ? 'disabled' : ''}></label><label>Associate with game<select name="game_id" ${state.uploading ? 'disabled' : ''}><option value="">Practice / no game</option>${options}</select></label><label>Video file<input name="file" type="file" accept="${VIDEO_TYPES.join(',')}" required ${state.uploading ? 'disabled' : ''}></label><p class="sub" id="filmFileState">${state.upload.filename ? `${esc(state.upload.filename)} · ${formatSize(state.upload.size)}` : 'Choose MP4 first. MOV/WebM/MKV may depend on browser playback support.'}</p><p class="sub">Resumable uploads use Supabase Storage TUS with real byte progress when available. No fake progress is shown.</p><progress id="filmUploadProgress" max="${state.upload.bytesTotal || 1}" value="${state.upload.bytesUploaded || 0}" ${state.upload.status === 'idle' || state.upload.status === 'preparing' ? 'hidden' : ''}></progress><p id="filmUploadStatus" role="status">${esc(state.upload.message || '')}</p><div class="actions">${state.upload.canResume ? '<button class="btn" type="button" data-film-resume-upload>Retry / Resume</button>' : ''}${state.upload.canCancel ? '<button class="btn danger" type="button" data-film-cancel-active-upload>Cancel Upload</button>' : ''}<button class="btn primary" type="submit" ${state.uploading ? 'disabled' : ''}>${state.uploading ? 'Uploading…' : 'Upload Film'}</button></div></form></dialog>`;
    }

    function renderPlaylistStatus() {
      if (!state.playback.playlistId) return;
      const target = document.querySelector(`[data-playlist-status="${CSS.escape(state.playback.playlistId)}"]`);
      if (!target) return;
      const items = playlistItems(state.playback.playlistId);
      target.innerHTML = `<div class="playlist-transport"><button class="btn" data-film-prev-playlist>Previous Clip</button><button class="btn" data-film-toggle-video>Play/Pause</button><button class="btn" data-film-next-playlist>Next Clip</button><span>Clip ${Math.min(state.playback.index + 1, items.length)} / ${items.length}</span></div>`;
      target.querySelector('[data-film-prev-playlist]')?.addEventListener('click', previousPlaylistClip);
      target.querySelector('[data-film-next-playlist]')?.addEventListener('click', nextPlaylistClip);
      target.querySelector('[data-film-toggle-video]')?.addEventListener('click', () => {
        const video = document.querySelector('#filmVideo');
        if (!video) return;
        if (video.paused) video.play().catch(() => {});
        else video.pause();
      });
    }

    function render() {
      const host = document.querySelector('#app');
      if (!host) return;
      host.innerHTML = `<div class="page-head"><div><div class="eyebrow">PUCKNEXUS · ${esc(context().teamName || 'TEAM')} WORKSPACE</div><h1>Film Room</h1><p>Manual video breakdown with timestamp clips and private team sharing.</p></div></div>${selectedFilm() ? renderPlayer() : renderLibrary()}${renderUploadDialog()}`;
      bind();
      renderPlaylistStatus();
    }

    function bind() {
      document.querySelector('[data-film-clear-scope]')?.addEventListener('click', resetScope);
      document.querySelector('[data-film-upload]')?.addEventListener('click', () => { state.uploadOpen = true; render(); });
      document.querySelector('[data-film-cancel-upload]')?.addEventListener('click', () => { state.uploadOpen = false; });
      document.querySelector('#filmUploadForm')?.addEventListener('submit', async event => {
        event.preventDefault();
        const status = document.querySelector('#filmUploadStatus');
        try { await upload(event.currentTarget); } catch (error) { state.uploading = false; if (status) status.textContent = error.message || 'Upload failed — retry.'; render(); }
      });
      document.querySelector('#filmUploadForm input[name="file"]')?.addEventListener('change', event => {
        const file = event.currentTarget.files[0];
        const target = document.querySelector('#filmFileState');
        if (target && file) target.textContent = `${file.name} · ${formatSize(file.size)} · ${VIDEO_TYPES.includes(file.type) ? 'Supported type' : 'Unsupported type'}`;
      });
      document.querySelectorAll('[data-film-open], [data-film-clips]').forEach(button => button.addEventListener('click', () => openFilm(button.dataset.filmOpen || button.dataset.filmClips)));
      document.querySelectorAll('[data-film-delete]').forEach(button => button.addEventListener('click', () => deleteFilm(button.dataset.filmDelete).catch(error => window.alert(error.message))));
      document.querySelectorAll('[data-film-clean-failed]').forEach(button => button.addEventListener('click', () => cleanFailedFilm(button.dataset.filmCleanFailed).catch(error => window.alert(error.message))));
      document.querySelectorAll('[data-film-resume-upload]').forEach(button => button.addEventListener('click', () => resumeUpload().catch(error => window.alert(error.message))));
      document.querySelector('[data-film-cancel-active-upload]')?.addEventListener('click', () => cancelUpload().catch(error => window.alert(error.message)));
      document.querySelector('[data-film-close]')?.addEventListener('click', () => { state.selectedFilmId = ''; render(); });
      document.querySelector('[data-film-mark-in]')?.addEventListener('click', () => { const video = document.querySelector('#filmVideo'); if (video) { state.inPoint = video.currentTime; render(); } });
      document.querySelector('[data-film-mark-out]')?.addEventListener('click', () => { const video = document.querySelector('#filmVideo'); if (video) { state.outPoint = video.currentTime; render(); } });
      document.querySelector('[data-film-reset-markers]')?.addEventListener('click', () => { state.inPoint = null; state.outPoint = null; render(); });
      document.querySelector('[data-film-save-clip]')?.addEventListener('click', () => saveClipFromMarkers().catch(error => window.alert(error.message)));
      document.querySelectorAll('[data-film-play-clip]').forEach(button => button.addEventListener('click', () => playClip(button.dataset.filmPlayClip)));
      document.querySelectorAll('[data-film-edit-clip]').forEach(button => button.addEventListener('click', () => editClip(button.dataset.filmEditClip).catch(error => window.alert(error.message))));
      document.querySelectorAll('[data-film-delete-clip]').forEach(button => button.addEventListener('click', () => deleteClip(button.dataset.filmDeleteClip).catch(error => window.alert(error.message))));
      document.querySelector('[data-film-create-playlist]')?.addEventListener('click', () => createPlaylist().catch(error => window.alert(error.message)));
      document.querySelectorAll('[data-film-add-playlist]').forEach(button => button.addEventListener('click', () => addClipToPlaylist(button.dataset.filmAddPlaylist).catch(error => window.alert(error.message))));
      document.querySelectorAll('[data-film-delete-playlist]').forEach(button => button.addEventListener('click', () => deletePlaylist(button.dataset.filmDeletePlaylist).catch(error => window.alert(error.message))));
      document.querySelectorAll('[data-film-open-playlist]').forEach(button => button.addEventListener('click', () => openPlaylist(button.dataset.filmOpenPlaylist)));
      document.querySelectorAll('[data-film-play-playlist]').forEach(button => button.addEventListener('click', () => startPlaylist(button.dataset.filmPlayPlaylist).catch(error => window.alert(error.message))));
      document.querySelectorAll('[data-film-move-up], [data-film-move-down], [data-film-remove-playlist-clip]').forEach(button => button.addEventListener('click', event => {
        const value = event.currentTarget.dataset.filmMoveUp || event.currentTarget.dataset.filmMoveDown || event.currentTarget.dataset.filmRemovePlaylistClip;
        const [playlistId, clipId] = value.split(':');
        const action = event.currentTarget.dataset.filmMoveUp ? movePlaylistClip(playlistId, clipId, -1) : event.currentTarget.dataset.filmMoveDown ? movePlaylistClip(playlistId, clipId, 1) : removePlaylistClip(playlistId, clipId);
        action.catch(error => window.alert(error.message));
      }));
      document.querySelectorAll('[data-film-share-playlist]').forEach(button => button.addEventListener('click', () => {
        const panel = button.closest('.playlist-card')?.querySelector('[data-share-form]');
        if (panel) panel.hidden = !panel.hidden;
      }));
      document.querySelectorAll('[data-share-form]').forEach(form => form.addEventListener('submit', event => {
        event.preventDefault();
        saveSharing(event.currentTarget).catch(error => window.alert(error.message));
      }));
      bindDragDrop();
    }

    function bindDragDrop() {
      let dragged = null;
      document.querySelectorAll('.playlist-items li[draggable="true"]').forEach(item => {
        item.addEventListener('dragstart', () => { dragged = item; });
        item.addEventListener('dragover', event => event.preventDefault());
        item.addEventListener('drop', event => {
          event.preventDefault();
          if (!dragged || dragged === item) return;
          const list = item.parentElement;
          list.insertBefore(dragged, dragged.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING ? item.nextSibling : item);
          const playlistId = item.closest('[data-playlist]').dataset.playlist;
          savePlaylistOrder(playlistId, Array.from(list.querySelectorAll('[data-clip-id]')).map(node => node.dataset.clipId)).catch(error => window.alert(error.message));
        });
      });
    }

    return {
      load, render, openForGame, LARGE_FILE_AUDIT,
      _state: state,
      _test: { validateClip, VIDEO_TYPES, visibleFilms, playlistItems, canView, canEdit, canShare }
    };
  }

  window.FoxesFilmRoom = Object.freeze({ createFilmRoom, LARGE_FILE_AUDIT });
})();
