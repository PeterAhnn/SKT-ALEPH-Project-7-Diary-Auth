import pg from 'pg';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createSqliteStore } from './store-sqlite.mjs';
import { email, password, hashPassword, verifyPassword, SESSION_SECONDS } from './identity-sqlite.mjs';
import { problem } from './validation.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const loginMessage = '아이디 또는 비밀번호를 확인해 주세요.';
const publicUser = row => ({ id: row.id, email: row.email, created_at: new Date(row.created_at).toISOString(), record_origin: row.record_origin });
const noSession = () => problem(401,'다시 로그인해 주세요.','UNAUTHENTICATED');

export function cloudPool(environment = process.env) {
  const ref = environment.T07_PROJECT_REF;
  if (!/^[a-z]{20}$/.test(ref || '') || ref === 'yynsaokvquggrbdrmalr') throw problem(503,'T07 전용 저장소 설정을 확인해 주세요.','UNAVAILABLE');
  const host = environment.T07_PG_HOST || '';
  const pooled = /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(host);
  if ((!pooled && host !== `db.${ref}.supabase.co`) || environment.T07_PG_USER !== (pooled ? `t07_server.${ref}` : 't07_server') || !environment.T07_PG_PASSWORD) throw problem(503,'T07 전용 저장소 설정을 확인해 주세요.','UNAVAILABLE');
  const port = Number(environment.T07_PG_PORT || (pooled ? 6543 : 5432));
  if (![5432,6543].includes(port)) throw problem(503,'T07 저장소 포트를 확인해 주세요.','UNAVAILABLE');
  const pool = new pg.Pool({ host, port, database:'postgres', user:environment.T07_PG_USER, password:environment.T07_PG_PASSWORD,
    ssl:{ rejectUnauthorized:true, ...(environment.T07_PG_CA ? { ca:environment.T07_PG_CA.replaceAll('\\n','\n') } : {}) },
    max:2, idleTimeoutMillis:10000, connectionTimeoutMillis:8000, query_timeout:12000,
    application_name:'t07-diary-server', allowExitOnIdle:true });
  pool.on('error',()=>{}); // Responses/logs never include credentials or query payloads.
  return pool;
}

export function createPostgresIdentity({ pool = cloudPool(), recordOrigin = 'user', clock = () => new Date().toISOString(), sessionSeconds = SESSION_SECONDS } = {}) {
  if (!['user','synthetic'].includes(recordOrigin)) throw problem(400,'기록 종류를 확인해 주세요.','VALIDATION');
  let derivations=0;
  async function bounded(callback) {
    if (derivations>=4) throw problem(429,'요청이 많습니다. 잠시 뒤 다시 시도해 주세요.','RATE_LIMIT');
    derivations++; try{return await callback();}finally{derivations--;}
  }
  async function transaction(callback) {
    const client=await pool.connect();
    try {await client.query('BEGIN'); const result=await callback(client);await client.query('COMMIT');return result;}
    catch(error){await client.query('ROLLBACK').catch(()=>{});if(error.status)throw error;
      if(error.code==='23505')throw problem(409,'이미 사용 중인 아이디 또는 기록입니다.','CONFLICT');
      if(['40001','40P01'].includes(error.code))throw problem(409,'다른 변경과 겹쳤습니다. 다시 불러와 주세요.','CONFLICT');
      throw problem(503,'저장소 연결을 확인해 주세요.','UNAVAILABLE');
    }finally{client.release();}
  }
  async function throttle(bucket,max,windowMs) {
    const stamp=new Date(clock()).getTime();
    const result=await pool.query(`INSERT INTO t07_private.auth_attempts VALUES($1,$2,1)
      ON CONFLICT(bucket) DO UPDATE SET
      window_start=CASE WHEN $2-t07_private.auth_attempts.window_start >= $3 THEN $2 ELSE t07_private.auth_attempts.window_start END,
      attempts=CASE WHEN $2-t07_private.auth_attempts.window_start >= $3 THEN 1 ELSE t07_private.auth_attempts.attempts+1 END RETURNING attempts`,[bucket,stamp,windowMs]);
    return result.rows[0].attempts<=max;
  }
  async function userById(id,client=pool,lock='') {
    const result=await client.query(`SELECT * FROM t07_private.users WHERE id=$1 ${lock}`,[id]);
    if(!result.rows[0])throw noSession();return result.rows[0];
  }
  async function requireToken(client,id,token) {
    if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw noSession();
    const result=await client.query('SELECT token_hash FROM t07_private.sessions WHERE token_hash=$1 AND user_id=$2 AND expires_at>$3 FOR SHARE',[digest(token),id,clock()]);
    if(!result.rowCount)throw noSession();
  }
  return {
    kind:'postgres', pool,
    async register(input,remoteAddress='unknown') {
      const address=email(input.email);const secret=password(input.password,true);
      if(!await throttle(`signup:${digest(remoteAddress)}`,10,60*60*1000))throw problem(429,'요청이 많습니다. 잠시 뒤 다시 시도해 주세요.','RATE_LIMIT');
      const stored=await bounded(()=>hashPassword(secret));
      const row={id:randomUUID(),email:address,password_digest:stored,created_at:clock(),record_origin:recordOrigin};
      const empty=createSqliteStore({filename:':memory:',recordOrigin});
      let snapshot;try{snapshot=await empty.exportState();}finally{await empty.close();}
      await transaction(async client=>{
        await client.query("SELECT set_config('t07.user_id',$1,true)",[row.id]);
        await client.query('INSERT INTO t07_private.users VALUES($1,$2,$3,$4,$5)',[row.id,row.email,row.password_digest,row.created_at,row.record_origin]);
        await client.query('INSERT INTO t07_private.diaries(user_id,snapshot) VALUES($1,$2)',[row.id,JSON.stringify(snapshot)]);
      });return publicUser(row);
    },
    async login(input,remoteAddress='unknown') {
      const address=email(input.email);const secret=password(input.password);
      const accountAllowed=await throttle(`login:${digest(address)}`,10,5*60*1000);
      const ipAllowed=await throttle(`ip:${digest(remoteAddress)}`,30,5*60*1000);
      if(!accountAllowed||!ipAllowed)throw problem(429,'요청이 많습니다. 잠시 뒤 다시 시도해 주세요.','RATE_LIMIT');
      const before=(await pool.query('SELECT * FROM t07_private.users WHERE email=$1',[address])).rows[0];
      const valid=await bounded(()=>verifyPassword(secret,before?.password_digest));
      if(!valid||!before)throw problem(401,loginMessage,'LOGIN');
      const token=randomBytes(32).toString('base64url');const stamp=clock();const expires=new Date(new Date(stamp).getTime()+sessionSeconds*1000).toISOString();
      await transaction(async client=>{
        const current=await userById(before.id,client,'FOR UPDATE');
        if(current.password_digest!==before.password_digest)throw problem(401,loginMessage,'LOGIN');
        await client.query('DELETE FROM t07_private.sessions WHERE expires_at<=$1',[stamp]);
        await client.query('INSERT INTO t07_private.sessions VALUES($1,$2,$3,$4)',[digest(token),before.id,stamp,expires]);
      });return {user:publicUser(before),token,csrf:digest(`csrf:${token}`),expires_at:expires};
    },
    async authenticate(token) {
      if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))return null;
      const result=await pool.query(`SELECT u.*,s.expires_at FROM t07_private.sessions s JOIN t07_private.users u ON u.id=s.user_id
        WHERE s.token_hash=$1 AND s.expires_at>$2`,[digest(token),clock()]);
      const row=result.rows[0];return row?{user:publicUser(row),csrf:digest(`csrf:${token}`),expires_at:new Date(row.expires_at).toISOString()}:null;
    },
    async logout(token) {
      if(typeof token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(token))await pool.query('DELETE FROM t07_private.sessions WHERE token_hash=$1',[digest(token)]);
    },
    async changePassword(id,input,token) {
      const before=await userById(id);
      if(!await throttle(`reauth:${id}`,10,5*60*1000))throw problem(429,'요청이 많습니다. 잠시 뒤 다시 시도해 주세요.','RATE_LIMIT');
      const current=password(input.current_password);const next=password(input.password,true);
      const stored=await bounded(async()=>{if(!await verifyPassword(current,before.password_digest))throw problem(401,loginMessage,'LOGIN');return hashPassword(next);});
      await transaction(async client=>{
        const row=await userById(id,client,'FOR UPDATE');await requireToken(client,id,token);
        if(row.password_digest!==before.password_digest)throw noSession();
        await client.query('UPDATE t07_private.users SET password_digest=$1 WHERE id=$2',[stored,id]);
        await client.query('DELETE FROM t07_private.sessions WHERE user_id=$1',[id]);
      });
    },
    async deleteAccount(id,input,token) {
      const before=await userById(id);
      if(input.confirm!==before.email)throw problem(400,'계정 아이디를 정확히 입력해 주세요.','VALIDATION');
      if(!await throttle(`reauth:${id}`,10,5*60*1000))throw problem(429,'요청이 많습니다. 잠시 뒤 다시 시도해 주세요.','RATE_LIMIT');
      if(!await bounded(()=>verifyPassword(password(input.current_password),before.password_digest)))throw problem(401,loginMessage,'LOGIN');
      await transaction(async client=>{
        const row=await userById(id,client,'FOR UPDATE');await requireToken(client,id,token);
        if(row.password_digest!==before.password_digest)throw noSession();
        await client.query('DELETE FROM t07_private.auth_attempts WHERE bucket=$1',[`reauth:${id}`]);
        await client.query('DELETE FROM t07_private.users WHERE id=$1',[id]); // FK cascades sessions and the complete diary.
      });
    },
    async withDiary(id,callback,token) {
      return transaction(async client=>{
        // Lock order: user, session, diary. Password change/delete/logout cannot
        // complete and then let an already-started operation commit afterward.
        const user=await userById(id,client,'FOR SHARE');await requireToken(client,id,token);
        await client.query("SELECT set_config('t07.user_id',$1,true)",[id]);
        const before=(await client.query('SELECT snapshot FROM t07_private.diaries WHERE user_id=$1 FOR UPDATE',[id])).rows[0];
        if(!before)throw noSession();
        const store=createSqliteStore({filename:':memory:',clock,recordOrigin:user.record_origin});
        try {
          await store.restoreSnapshot(before.snapshot);
          const result=await callback(store);const after=await store.exportState();
          if(!isDeepStrictEqual(after,before.snapshot)){
            const serialized=JSON.stringify(after);
            if(Buffer.byteLength(serialized)>2*1024*1024)throw problem(413,'이 계정의 자료가 저장 한도 2MB를 넘었습니다. 전체 내보내기로 보관한 뒤 확인해 주세요.','PAYLOAD_TOO_LARGE');
            await client.query('UPDATE t07_private.diaries SET snapshot=$1,revision=revision+1,updated_at=$2 WHERE user_id=$3',[serialized,clock(),id]);
          }
          return result;
        }finally{await store.close();}
      });
    },
    async close(){await pool.end();}
  };
}
