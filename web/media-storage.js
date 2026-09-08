(function attachMediaStorage(global) {
  const MIME_PREFIXES = ['video/', 'image/'];
  const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

  function validMime(assetType, mime) {
    if (assetType === 'game_film' || assetType === 'clip') return mime === 'video/mp4' || mime === 'video/quicktime' || mime === 'video/webm';
    if (assetType === 'branding' || assetType === 'support_attachment') return MIME_PREFIXES.some(prefix => mime.startsWith(prefix));
    return true;
  }

  function createMediaStorage({ client, getWorkspace }) {
    function workspace() {
      const value = getWorkspace?.();
      if (!value?.authorized || !value.organization_id || !value.team_id) throw new Error('An authorized workspace is required.');
      return value;
    }

    async function prepareUpload({ file, assetType, gameId = null, playerId = null, supportReportId = null }) {
      const current = workspace();
      if (!file || !validMime(assetType, file.type || 'application/octet-stream')) throw new Error('That file type is not supported.');
      if (assetType === 'support_attachment' && file.size > MAX_IMAGE_BYTES) throw new Error('Support screenshots must be 10 MB or smaller.');
      const { data, error } = await client.rpc('create_media_asset', {
        target_organization_id: current.organization_id,
        target_team_id: current.team_id,
        target_season_id: current.season_id || null,
        requested_asset_type: assetType,
        requested_filename: file.name,
        requested_mime_type: file.type || 'application/octet-stream',
        requested_size_bytes: file.size,
        target_game_id: gameId,
        target_player_id: playerId,
        target_support_report_id: supportReportId
      });
      if (error) throw new Error(error.message || 'Media upload could not be prepared.');
      const asset = Array.isArray(data) ? data[0] : data;
      if (!asset?.bucket_name || !asset.object_path) throw new Error('Media upload path was not returned.');
      const upload = await client.storage.from(asset.bucket_name).upload(asset.object_path, file, {
        contentType: file.type || 'application/octet-stream',
        upsert: false
      });
      if (upload.error) {
        await client.rpc('set_media_asset_status', { target_asset_id: asset.asset_id, next_status: 'failed' });
        throw new Error(upload.error.message || 'Media upload failed.');
      }
      await client.rpc('set_media_asset_status', { target_asset_id: asset.asset_id, next_status: 'uploaded' });
      return asset;
    }

    async function signedUrl(assetId, expiresIn = 300) {
      const { data: asset, error } = await client.from('media_assets')
        .select('bucket_name,object_path,status')
        .eq('id', assetId)
        .maybeSingle();
      if (error || !asset || asset.status === 'deleted') throw new Error(error?.message || 'Media is unavailable.');
      const result = await client.storage.from(asset.bucket_name).createSignedUrl(asset.object_path, expiresIn);
      if (result.error) throw new Error(result.error.message || 'Signed media access failed.');
      return result.data.signedUrl;
    }

    return { prepareUpload, signedUrl, validMime };
  }

  global.FoxesMediaStorage = { createMediaStorage, validMime };
}(window));
