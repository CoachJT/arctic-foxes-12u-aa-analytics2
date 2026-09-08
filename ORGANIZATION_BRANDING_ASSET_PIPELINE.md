# Organization branding asset pipeline proposal

## Status

This is a review-only proposal. It has not created a bucket, changed a policy, applied a migration, uploaded an asset, or updated `team_branding`.

## Recommended architecture

Create a dedicated public-read `organization-branding` bucket. Do not make the existing `branding` bucket public: it is a private bucket governed by the shared `media_assets` private-media policy and has no object-level MIME or size limit.

Only non-sensitive, approved organization artwork belongs in the new bucket:

```text
organizations/{organization-id}/logo/{asset-id}.png
organizations/{organization-id}/hero/{asset-id}.jpg
organizations/{organization-id}/welcome/{asset-id}.jpg
organizations/{organization-id}/secondary/{asset-id}.jpg
organizations/{organization-id}/wordmark/{asset-id}.png
organizations/{organization-id}/watermark/{asset-id}.png
organizations/{organization-id}/film/{asset-id}.jpg
organizations/{organization-id}/scouting/{asset-id}.jpg
organizations/{organization-id}/reports/{asset-id}.jpg
organizations/{organization-id}/development/{asset-id}.jpg
organizations/{organization-id}/coaching_tools/{asset-id}.jpg
```

Each immutable UUID-named object receives the stable URL returned by `storage.from('organization-branding').getPublicUrl(path)`. No signed URLs, data URLs, local paths, blobs, or temporary attachments are persisted.

## Authorization model

Public `SELECT` is acceptable because this bucket contains non-sensitive organization artwork only. `INSERT`, `UPDATE`, and `DELETE` remain authenticated and must be authorized server-side for the target organization and team. The proposed `prepare_organization_branding_asset`, `finalize_organization_branding_asset`, and `delete_organization_branding_asset` RPCs must authorize the target workspace using existing team ownership (`is_team_owner`) or an explicit future organization branding administrator capability. They must never accept a client-provided object path.

Anonymous write, update, and delete are never granted. The object path begins with the server-validated organization ID, and storage policies must cross-check the pending/finalized `media_assets` row to prevent cross-organization modification.

## File policy

Accept PNG (`image/png`), JPEG (`image/jpeg`), and WebP (`image/webp`) only. Reject SVG until a reviewed sanitization/delivery policy exists. Client and server both enforce a 10 MB maximum. The server decides the extension from MIME type and ignores client filenames.

## Proposed migration and policy changes

The following must be applied only after explicit approval, as a new additive migration:

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'organization-branding',
  'organization-branding',
  true,
  10485760,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

create policy organization_branding_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'organization-branding'
  and exists (
    select 1
    from public.media_assets asset
    where asset.bucket_name = bucket_id
      and asset.object_path = name
      and asset.asset_type = 'branding'
      and asset.status = 'pending'
      and asset.uploaded_by = (select auth.uid())
  )
);

create policy organization_branding_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'organization-branding'
  and exists (
    select 1
    from public.media_assets asset
    where asset.bucket_name = bucket_id
      and asset.object_path = name
      and asset.asset_type = 'branding'
      and public.is_team_owner(asset.team_id)
  )
);
```

The same migration must add security-definer RPCs that validate active ownership/approved organization-admin authority, validate asset key/MIME/size, insert a pending `media_assets` row with a generated UUID path, atomically merge the returned stable URL into `team_branding.settings` (or `logo_url` for the logo), soft-delete the replaced metadata row, and delete/clear the configured asset during removal. The RPC must use JSONB merge semantics so unrelated settings such as `font` and `theme` survive.

## Rollback

Before applying: no action is needed.

After applying: revoke or drop the three RPCs and two object write policies, set the `organization-branding` bucket back to private, and retain objects/metadata for audit until an approved cleanup is complete. Do not delete the existing private `branding` bucket or alter its policies.
