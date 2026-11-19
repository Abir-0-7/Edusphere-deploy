# Enable the Phase 8F release

Practical Python Foundations is the fifth prebuilt course: four modules,
16 lessons and a required written capstone. The updated API seeds it at startup.
Its visibility does not depend on an F feature flag. A frontend release can show
the private planner before the backend has been deployed or enabled.

## Apply the deployment migrations

Back up the existing Neon database, and rehearse on a database branch first.
Use the GitHub deployment repository's current `main`, whose migration sequence
ends with `0019_course_outlines`, `0020_course_generation` and
`0021_generation_lesson_edits`. The separate original development worktree has a
different migration history and must not be used to migrate the deployment DB.

From a clean checkout of `Abir-0-7/Edusphere-deploy` main, in PowerShell:

```powershell
git pull --ff-only origin main
pnpm install --frozen-lockfile
$env:DATABASE_URL = '<Neon direct connection string for the target database>'
pnpm --filter @studyvault/db db:migrate
```

Drizzle applies the pending committed migrations in journal order. Obtain the
direct connection string from Neon **Connect** with pooling disabled. The
migration configuration reads `DATABASE_URL`; the running API uses
`AI_SERVICE_DATABASE_URL`. Both must address the intended database.

In Neon SQL Editor, these four results should be non-null after migration:

```sql
SELECT to_regclass('public.course_outlines'),
       to_regclass('public.course_outline_approvals'),
       to_regclass('public.course_generation_runs'),
       to_regclass('public.course_generation_lesson_edits');
```

## Configure the API service

In Render, open the existing AI web service, then **Environment**. Enable the
capabilities you need there; these are backend variables:

```dotenv
AI_SERVICE_COURSE_OUTLINES_ENABLED=true
AI_SERVICE_COURSE_GENERATION_ENABLED=true
AI_SERVICE_SOURCE_TEXT_IMPORT_ENABLED=true
AI_SERVICE_SOURCE_REFRESH_ENABLED=true
AI_SERVICE_COURSE_UPGRADES_ENABLED=true
AI_SERVICE_WORKER_ENABLED=true
```

Generation also uses the existing configured LLM fallback router. For public
GitHub imports, additionally configure the existing Upstash rate-limit service:

```dotenv
AI_SERVICE_GITHUB_IMPORT_ENABLED=true
UPSTASH_REDIS_REST_URL=<Upstash REST URL>
UPSTASH_REDIS_REST_TOKEN=<Upstash REST token>
```

Leave the GitHub import flag false until those credentials are configured.
New F flags default to false. Production retains `AI_SERVICE_JOB_STORE=postgres`
and `AI_SERVICE_JWT_DEV_MODE=false`.

## Deploy and verify

Save the environment changes with **Save only**, then use **Manual Deploy →
Deploy latest commit** on the service linked to `main`. The repository's Render
Blueprint sets automatic API deploys to off, so a GitHub push alone does not
establish that the API has updated. Deploying the latest commit builds the new
code with the saved environment. The frontend's `AI_SERVICE_URL` must point to
this API service.

After the deployment is live, refresh **Guided courses**. Practical Python
Foundations should appear alongside the existing four courses, and the private
planner should load when its flag is enabled. The authenticated catalog route is
`GET /api/courses`; its expected total is five prebuilt courses. `/ready` verifies
general API/database/worker readiness, while the SQL query above verifies the
new tables specifically.

References: [Neon connection strings](https://neon.com/docs/connect/connect-from-any-app),
[Drizzle migrations](https://orm.drizzle.team/docs/drizzle-kit-migrate),
[Render environment variables](https://render.com/docs/configure-environment-variables),
[Render manual deployment](https://render.com/docs/deploys).
