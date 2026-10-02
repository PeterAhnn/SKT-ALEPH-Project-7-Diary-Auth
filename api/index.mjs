import { fileURLToPath } from 'node:url';
import { createHandler } from '../src/http.mjs';
import { createPostgresIdentity } from '../src/identity-postgres.mjs';
export const config = { helpers: false };
let handler;
export default async function api(req,res) {
  if(!handler){
    try{
      const identity=createPostgresIdentity();
      handler=createHandler({identity,publicDir:fileURLToPath(new URL('../public',import.meta.url)),secureCookies:true});
    }catch{
      res.writeHead(503,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      return res.end(JSON.stringify({ok:false,error:{code:'UNAVAILABLE',message:'T07 전용 인증 저장소 연결을 확인해 주세요.'}}));
    }
  }
  const url=new URL(req.url,'https://diary.invalid');
  if(url.pathname==='/api/index'||url.pathname==='/api/index.mjs'){
    const route=url.searchParams.get('route');
    if(typeof route!=='string'||!/^[a-zA-Z0-9_\/-]+$/.test(route)){
      res.writeHead(404,{'Content-Type':'application/json'});return res.end(JSON.stringify({ok:false,error:{code:'NOT_FOUND',message:'요청 경로를 확인해 주세요.'}}));
    }
    req.url=route==='diary'?'/diary':`/api/${route}`;
  }
  return handler(req,res);
}
