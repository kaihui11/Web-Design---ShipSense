/* ===================================================================
   SUPABASE CONNECTION — shared by every page that talks to the backend
   (see supabase/README.md for how the project is set up).

   This lives in its own file because two separate parts of the site now
   need it: the internal app (app.html → app.js, exec-data.js) and the
   public Contact page (contact.html → site.js). Copying the URL and key
   into both would mean two places to update when the project is rotated,
   and one of them would eventually be missed.

   Both values are safe to ship to the browser. The anon key is the
   *publishable* key — what it may actually do is decided by the Row
   Level Security policies in supabase/schema.sql, not by keeping it
   secret. The service_role key, which does bypass RLS, is never used
   here; it only ever lives in GitHub Actions secrets (see
   .github/workflows/update-forecast-pkl.yml).
   =================================================================== */
const SUPABASE_URL = 'https://uioqmeulbvsnqfvtdmzt.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_LzOfDzr4YZ22RUkclX3zVQ_fa37cW-P';
