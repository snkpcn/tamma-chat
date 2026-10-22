# Fast-accurate-bilingual deployment unblock

Target project: `upaokrprawzhgzeqsdke` (the existing tamma-chat production project).

1. Open https://supabase.com/dashboard/project/upaokrprawzhgzeqsdke/sql/new using an account authorized to run schema changes.
2. Paste the complete `20261022_fast_accurate_bilingual.sql` file and run it. It applies missing release migrations in dependency order in one transaction and verifies all ten SQL prerequisites before committing. It preserves existing application rows and notifies PostgREST to refresh its schema cache. If a prerequisite is absent or an existing schema is incompatible, it raises an error and rolls back; investigate the error rather than removing the check.
3. Success returns ten rows with `ready = true`. Then retry the failed Netlify production deploy: https://app.netlify.com/projects/tamma-chat/deploys/6ad9cc9b837e6a7aa774927a . The Netlify read-only build checks must pass before publication.
4. Verify the new published commit and test the web against that deployment. LINE delivery and actual cost require their own evidence.

The SQL Editor does not automatically record CLI migration history. Before any later `supabase db push`, reconcile these five versions against the verified hosted schema using Supabase migration tooling. Never blindly replay the older claim-view migration after the context-view migration; it would try to remove an appended view column. This helper does not change or fabricate existing CLI history.

Tests run the actual batch against PGlite for a missing, partially applied and complete release, twice per state, and verify existing outcome rows survive. A missing base schema stops before any release changes. These local tests do not establish hosted permissions or hosted migration success.
