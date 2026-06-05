Deployment notes — env.js generation (Vercel)

Goal: generate env.js at build time from Vercel environment variables and load it before assets/js/config.js.

1) Add these Environment Variables in Vercel Dashboard (Project Settings -> Environment Variables):
   - SUPABASE_URL  (value: https://...)
   - SUPABASE_ANON_KEY (value: public anon key)

2) Build Command for Vercel (set in project settings):
   - node scripts/generate-env.js && echo "build step placeholder"

   More realistically, if you have a build step (e.g., npm run build), do:
   - node scripts/generate-env.js && npm run build

   The important part is that the first command writes /env.js into the output directory (repo root in this static site).

3) Make sure `env.js` is not committed. It's generated at build time. Add it to .gitignore if necessary.

4) During runtime, each HTML includes a small loader that loads `/env.js` before importing `assets/js/config.js`.

Security notes:
- Do NOT expose service role keys in env.js. Use only the public ANON key in client runtime.
- To call privileged endpoints, use serverless functions with server-side secrets.
