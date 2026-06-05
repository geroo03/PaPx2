/**
 * Example serverless handler to create an Embajador in Supabase Auth using the
 * service_role key. Deploy this as a secure function (never expose service key
 * to the browser). This is a Node.js example for Vercel/Azure Functions style.
 *
 * Environment variables required:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 */

const fetch = require('node-fetch');

module.exports = async function handler(req, res){
  if(req.method !== 'POST') return res.status(405).send({ message: 'Only POST' });
  const { email, password, name } = req.body || {};
  if(!email || !password) return res.status(400).send({ message: 'email & password required' });
  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try{
    const r = await fetch(`${SUPA_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` },
      body: JSON.stringify({
        email,
        password,
        user_metadata: { name },
        raw_user_meta_data: { role: 'embajador' }
      })
    });
    const j = await r.json();
    if(!r.ok) return res.status(r.status).send(j);
    return res.status(200).send({ user: j });
  }catch(err){ console.error(err); return res.status(500).send({ message: err.message }); }
};
