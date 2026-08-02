// Cosmic Gems - Supabase configuration.
// Setup steps (also in README.md):
//   1. Create a free project at https://supabase.com
//   2. Run supabase/schema.sql in the project's SQL editor.
//   3. Enable Email auth (Auth -> Providers). For Google sign-in, also enable the
//      Google provider and add your site URL as a redirect URL.
//   4. Paste your Project URL and anon/public key below (Project Settings -> API).
// The anon key is PUBLIC by design and safe to ship in client-side code.
window.COSMIC_CONFIG = {
  url: 'REPLACE_WITH_YOUR_SUPABASE_URL',
  anon: 'REPLACE_WITH_YOUR_SUPABASE_ANON_KEY',
};
