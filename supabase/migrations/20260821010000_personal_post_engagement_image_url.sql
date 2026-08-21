-- Fallback image source: the direct, unauthenticated live-fetch in
-- generate-client-report (fetchLinkedInPost) has started coming back empty
-- for every post — LinkedIn appears to serve a blocked/consent page instead
-- of erroring, so the code sees a normal response with no og:image tag,
-- never an exception. Apify already succeeds at scraping the same posts, so
-- it becomes the fallback image source when the live fetch turns up nothing
-- — tried second, not first, since the live fetch is always fresher when it
-- works and Apify's copy is only as current as the last "Apify" click.
ALTER TABLE personal_post_engagement ADD COLUMN IF NOT EXISTS image_url TEXT;
