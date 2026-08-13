/* ===================================================================
   SUPABASE CONNECTION — shared by every page that talks to the backend
   (see supabase/README.md for how the project is set up).

   This lives in its own file because several scripts need it: app.js and
   exec-data.js for the forecast, quote and dashboard data, and
   contact-form.js for the Contact / Help form. Copying the URL and key
   into each would mean several places to update when the project is
   rotated, and one of them would eventually be missed.

   Both values are safe to ship to the browser. The anon key is the
   *publishable* key — what it may actually do is decided by the Row
   Level Security policies in supabase/schema.sql, not by keeping it
   secret. The service_role key, which does bypass RLS, is never used
   here; it only ever lives in GitHub Actions secrets (see
   .github/workflows/update-forecast-pkl.yml).
   =================================================================== */
const SUPABASE_URL = 'https://uioqmeulbvsnqfvtdmzt.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_LzOfDzr4YZ22RUkclX3zVQ_fa37cW-P';
