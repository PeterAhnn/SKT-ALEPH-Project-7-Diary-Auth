-- Dedicated T07 project only. t07_server is provisioned separately with a
-- random credential kept outside Git; clients never connect with this role.
BEGIN;
CREATE SCHEMA IF NOT EXISTS t07_private;
REVOKE ALL ON SCHEMA t07_private FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS t07_private.users (
 id uuid PRIMARY KEY, email text NOT NULL UNIQUE,
 password_digest text NOT NULL, created_at timestamptz NOT NULL,
 record_origin text NOT NULL CHECK(record_origin IN ('user','synthetic'))
);
CREATE TABLE IF NOT EXISTS t07_private.sessions (
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[0-9a-f]{64}$'),
 user_id uuid NOT NULL REFERENCES t07_private.users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON t07_private.sessions(user_id);
CREATE TABLE IF NOT EXISTS t07_private.auth_attempts (
 bucket text PRIMARY KEY, window_start bigint NOT NULL, attempts integer NOT NULL
);
CREATE TABLE IF NOT EXISTS t07_private.diaries (
 user_id uuid PRIMARY KEY REFERENCES t07_private.users(id) ON DELETE CASCADE,
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 revision bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON ALL TABLES IN SCHEMA t07_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA t07_private TO t07_server;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA t07_private TO t07_server;
ALTER TABLE t07_private.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE t07_private.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE t07_private.auth_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE t07_private.diaries ENABLE ROW LEVEL SECURITY;
-- Only the trusted backend role receives a policy. An authenticated Supabase
-- JWT is not authorization for these tables; this app uses opaque DB sessions.
CREATE POLICY server_only ON t07_private.users TO t07_server USING(true) WITH CHECK(true);
CREATE POLICY server_only ON t07_private.sessions TO t07_server USING(true) WITH CHECK(true);
CREATE POLICY server_only ON t07_private.auth_attempts TO t07_server USING(true) WITH CHECK(true);
CREATE POLICY server_only ON t07_private.diaries TO t07_server
 USING(user_id=nullif(current_setting('t07.user_id',true),'')::uuid)
 WITH CHECK(user_id=nullif(current_setting('t07.user_id',true),'')::uuid);
ALTER DEFAULT PRIVILEGES IN SCHEMA t07_private REVOKE ALL ON TABLES FROM PUBLIC,anon,authenticated;
COMMIT;
