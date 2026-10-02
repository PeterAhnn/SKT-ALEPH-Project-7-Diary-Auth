// T06's public Supabase adapter must not be reused for private T07 records.
// A persistent authenticated cloud adapter is pending; serverless fails closed.
export const config = { helpers: false };
export default async function api(req, res) {
  res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ ok: false, error: { code: 'UNAVAILABLE', message: '인증된 저장소 연결을 준비하고 있습니다. 아직 공개 배포를 사용할 수 없습니다.' } }));
}
