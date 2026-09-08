(function attachOrganizationBrandingStorage(global) {
  const ALLOWED_ASSET_KEYS = ['logo', 'hero', 'welcome', 'secondary', 'wordmark', 'watermark', 'film', 'scouting', 'reports', 'development', 'coaching_tools'];
  const MIME_EXTENSIONS = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp'
  };
  const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
  const BRANDING_BUCKET = 'organization-branding';

  function safeImageUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const url = new URL(value.trim());
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
    } catch {
      return null;
    }
  }

  function validateImageFile(file) {
    if (!file || typeof file !== 'object') throw new Error('An image file is required.');
    const extension = MIME_EXTENSIONS[file.type];
    if (!extension) throw new Error('Branding artwork must be a PNG, JPEG, or WebP image.');
    if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_IMAGE_BYTES) {
      throw new Error('Branding artwork must be between 1 byte and 10 MB.');
    }
    return { mimeType: file.type, extension, sizeBytes: file.size };
  }

  function validateIdentifier(value, label) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''))) {
      throw new Error(`A valid ${label} is required.`);
    }
    return String(value).toLowerCase();
  }

  function brandingObjectPath({ organizationId, assetKey, assetId, extension }) {
    const organization = validateIdentifier(organizationId, 'organization ID');
    const object = validateIdentifier(assetId, 'asset ID');
    if (!ALLOWED_ASSET_KEYS.includes(assetKey)) throw new Error('Unsupported branding asset key.');
    if (!Object.values(MIME_EXTENSIONS).includes(extension)) throw new Error('Unsupported branding image extension.');
    return `organizations/${organization}/${assetKey}/${object}.${extension}`;
  }

  function settingsKey(assetKey) {
    return ['film', 'scouting', 'reports', 'development', 'coaching_tools'].includes(assetKey)
      ? ['feature_images', assetKey]
      : assetKey === 'logo' ? ['logo_url']
        : ['wordmark', 'watermark'].includes(assetKey) ? [`${assetKey}_url`]
          : [`${assetKey}_image_url`];
  }

  function mergeBrandingSettings(existingSettings, updates) {
    const existing = existingSettings && typeof existingSettings === 'object' && !Array.isArray(existingSettings)
      ? existingSettings
      : {};
    const result = { ...existing };
    for (const [key, value] of Object.entries(updates || {})) {
      if (['tagline', 'motto'].includes(key)) {
        if (typeof value === 'string' && value.trim()) result[key] = value.trim().slice(0, 160);
        else delete result[key];
        continue;
      }
      if (!ALLOWED_ASSET_KEYS.includes(key) || key === 'logo') continue;
      const url = safeImageUrl(value);
      const [parent, child] = settingsKey(key);
      if (child) {
        const features = result.feature_images && typeof result.feature_images === 'object' && !Array.isArray(result.feature_images)
          ? { ...result.feature_images }
          : {};
        if (url) features[child] = url;
        else delete features[child];
        result.feature_images = features;
      } else if (url) result[parent] = url;
      else delete result[parent];
    }
    return result;
  }

  function stablePublicUrl(client, objectPath) {
    const result = client.storage.from(BRANDING_BUCKET).getPublicUrl(objectPath);
    return safeImageUrl(result?.data?.publicUrl) || null;
  }

  function createOrganizationBrandingStorage({ client, getWorkspace }) {
    function workspace() {
      const value = getWorkspace?.();
      if (!value?.authorized || !value.organization_id || !value.team_id) throw new Error('An authorized workspace is required.');
      return {
        ...value,
        organization_id: validateIdentifier(value.organization_id, 'organization ID'),
        team_id: validateIdentifier(value.team_id, 'team ID')
      };
    }

    async function abortPreparedAsset(asset, finalizeError) {
      // Best-effort cleanup for a prepared-and-uploaded-but-not-finalized
      // asset. The ORIGINAL finalize error is always what gets thrown; this
      // function only ever annotates it with orphan details for later
      // reconciliation if any cleanup step itself fails.
      try {
        const aborted = await client.rpc('abort_organization_branding_asset', { target_asset_id: asset.asset_id });
        if (aborted.error) {
          finalizeError.orphanedBrandingAsset = {
            assetId: asset.asset_id, bucketName: asset.bucket_name, objectPath: asset.object_path, reason: 'abort_rpc_failed'
          };
          return;
        }
        const target = Array.isArray(aborted.data) ? aborted.data[0] : aborted.data;
        const bucketName = target?.bucket_name;
        const objectPath = target?.object_path;
        if (!bucketName || !objectPath) {
          finalizeError.orphanedBrandingAsset = {
            assetId: asset.asset_id, bucketName: asset.bucket_name, objectPath: asset.object_path, reason: 'missing_cleanup_path'
          };
          return;
        }
        // Remove ONLY the single, server-authorized object path returned by
        // the abort RPC -- never a client-guessed or batch path.
        const removal = await client.storage.from(bucketName).remove([objectPath]);
        if (removal?.error) {
          finalizeError.orphanedBrandingAsset = { assetId: asset.asset_id, bucketName, objectPath, reason: 'storage_remove_failed' };
        }
      } catch (cleanupError) {
        finalizeError.orphanedBrandingAsset = {
          assetId: asset.asset_id, bucketName: asset.bucket_name, objectPath: asset.object_path,
          reason: cleanupError?.message || 'cleanup_threw'
        };
      }
    }

    async function uploadAsset({ file, assetKey }) {
      const current = workspace();
      const validated = validateImageFile(file);
      if (!ALLOWED_ASSET_KEYS.includes(assetKey)) throw new Error('Unsupported branding asset key.');
      const { data, error } = await client.rpc('prepare_organization_branding_asset', {
        target_organization_id: current.organization_id,
        target_team_id: current.team_id,
        requested_asset_key: assetKey,
        requested_mime_type: validated.mimeType,
        requested_size_bytes: validated.sizeBytes
      });
      if (error) throw new Error(error.message || 'Branding upload could not be prepared.');
      const asset = Array.isArray(data) ? data[0] : data;
      if (!asset?.asset_id || asset.bucket_name !== BRANDING_BUCKET || !asset.object_path) throw new Error('Branding upload path was not returned.');
      const upload = await client.storage.from(BRANDING_BUCKET).upload(asset.object_path, file, { contentType: validated.mimeType, upsert: false });
      if (upload.error) throw new Error(upload.error.message || 'Branding upload failed.');
      const publicUrl = stablePublicUrl(client, asset.object_path);
      if (!publicUrl) throw new Error('A stable public branding URL could not be generated.');
      // The server derives and persists its own public URL from the
      // server-generated path; it never accepts one from the client.
      const finalized = await client.rpc('finalize_organization_branding_asset', { target_asset_id: asset.asset_id });
      if (finalized.error) {
        // prepare succeeded, upload succeeded, finalize failed: abort and
        // clean up ONLY this newly prepared asset, then re-throw the
        // ORIGINAL finalize error (never masked by a cleanup-step error).
        const finalizeError = new Error(finalized.error.message || 'Branding upload could not be finalized.');
        await abortPreparedAsset(asset, finalizeError);
        throw finalizeError;
      }
      return { ...asset, publicUrl };
    }

    async function deleteAsset(assetId) {
      const current = workspace();
      const { error } = await client.rpc('delete_organization_branding_asset', {
        target_organization_id: current.organization_id,
        target_team_id: current.team_id,
        target_asset_id: validateIdentifier(assetId, 'asset ID')
      });
      if (error) throw new Error(error.message || 'Branding asset could not be deleted.');
    }

    return { uploadAsset, deleteAsset };
  }

  global.FoxesOrganizationBrandingStorage = {
    ALLOWED_ASSET_KEYS,
    BRANDING_BUCKET,
    MAX_IMAGE_BYTES,
    brandingObjectPath,
    createOrganizationBrandingStorage,
    mergeBrandingSettings,
    safeImageUrl,
    stablePublicUrl,
    validateImageFile
  };
}(window));
