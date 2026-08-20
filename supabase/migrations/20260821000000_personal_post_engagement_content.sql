-- Two additions, both needed for the same underlying problem: Apify returns
-- a post_url with NO author handle in it for roughly half of any profile's
-- posts (e.g. "https://www.linkedin.com/posts/activity-7485181802052079616-
-- p6z9" — no identifying information at all). That broke two things at once:
--
-- 1. RETRIEVAL: the only way to fetch "this entity's scraped rows" was
--    guessing the handle from the URL and filtering by it — which silently
--    excludes every handle-less row before matching even gets a chance to
--    run. entity_id fixes this at the source: the edge function already
--    knows which entity it's scraping when it writes each row.
--
-- 2. MATCHING: once retrieved, a handle-less row still can't be matched to
--    a specific uploaded post by URL. content stores the post's own caption
--    text so matching can fall back to "does this text contain the phrase
--    from the uploaded post's URL slug" instead of relying on the URL.

ALTER TABLE personal_post_engagement ADD COLUMN IF NOT EXISTS entity_id UUID REFERENCES client_entities(id) ON DELETE SET NULL;
ALTER TABLE personal_post_engagement ADD COLUMN IF NOT EXISTS content TEXT;
CREATE INDEX IF NOT EXISTS idx_personal_post_engagement_entity ON personal_post_engagement(entity_id);
