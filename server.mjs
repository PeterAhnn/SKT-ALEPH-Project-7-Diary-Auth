import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createIdentityStore } from './src/identity-sqlite.mjs';
import { createHandler } from './src/http.mjs';

if (existsSync('.env')) process.loadEnvFile('.env');
const origin = process.env.DIARY_RECORD_ORIGIN || 'user';
if (!['user', 'synthetic'].includes(origin)) throw new Error('DIARY_RECORD_ORIGIN must be user or synthetic');
if (process.env.SUPABASE_URL || process.env.SUPABASE_PUBLISHABLE_KEY) throw new Error('T07: the public T06 cloud adapter is not an authenticated backend. Use a dedicated T07 environment.');
const identity = createIdentityStore({ directory: resolve(process.env.DIARY_AUTH_DIRECTORY || '.data/t07'), recordOrigin: origin });
const server = createServer(createHandler({ identity, recordOrigin: origin, secureCookies: process.env.NODE_ENV === 'production', publicDir: fileURLToPath(new URL('./public', import.meta.url)) }));
const port = Number(process.env.PORT || 8009);
server.listen(port, '127.0.0.1', () => console.log(`플랜두씨 T07: http://127.0.0.1:${port} (${identity.kind}, ${origin})`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => { identity.close(); process.exit(0); }));
