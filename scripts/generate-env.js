// scripts/generate-env.js
// Usage: NODE_ENV=production node scripts/generate-env.js
// This script writes env.js to the project root using environment variables
const fs = require('fs');
const path = require('path');

const outPath = path.resolve(process.cwd(), 'env.js');
const supaUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supaAnon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const content = `// env.js generated at build time. Do not commit this file.\nwindow.SUPABASE_URL = "${supaUrl}";\nwindow.SUPABASE_ANON_KEY = "${supaAnon}";\n`;

fs.writeFileSync(outPath, content, {encoding:'utf8'});
console.log('Wrote', outPath);
