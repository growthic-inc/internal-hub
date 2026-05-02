-- ============================================================
-- Announcement Images Migration
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Add image_urls column to announcements table
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS image_urls text[];

-- 2. Create public storage bucket for announcement images
-- (Run this separately in the Supabase Storage UI if the INSERT fails)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'announcement-images',
  'announcement-images',
  true,
  2097152,   -- 2 MB per file
  ARRAY['image/jpeg','image/jpg','image/png','image/gif','image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public            = true,
  file_size_limit   = 2097152,
  allowed_mime_types = ARRAY['image/jpeg','image/jpg','image/png','image/gif','image/webp'];

-- 3. Storage RLS: allow authenticated users to upload
DROP POLICY IF EXISTS "Authenticated users can upload announcement images" ON storage.objects;
CREATE POLICY "Authenticated users can upload announcement images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'announcement-images');

-- 4. Storage RLS: public read
DROP POLICY IF EXISTS "Anyone can read announcement images" ON storage.objects;
CREATE POLICY "Anyone can read announcement images"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'announcement-images');

-- 5. Allow authenticated users to delete their own uploads
DROP POLICY IF EXISTS "Authenticated users can delete announcement images" ON storage.objects;
CREATE POLICY "Authenticated users can delete announcement images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'announcement-images');
