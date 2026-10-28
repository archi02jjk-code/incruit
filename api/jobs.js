// GET /api/jobs?from=YYYY-MM-DD
// 4개 채널의 채용공고를 모아 JSON으로 돌려줍니다.
// - 로컬: server.js 가 이 함수를 그대로 씁니다.
// - Vercel: api/ 폴더의 파일이라 그대로 서버리스 함수가 됩니다. 키는 Vercel 환경변수에 넣으세요.
const { collectAll } = require("../lib/sources");

const CACHE_MS = 30 * 60 * 1000;   // 30분 동안은 다시 부르지 않는다 (호출 한도 절약)
let cache = { key: "", at: 0, data: null };

const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Vercel CDN 캐시: 30분 동안은 저장본을 바로 주고, 그 뒤 하루까지는 저장본을 먼저 준 다음 뒤에서 새로 받아 둔다.
// 그래서 공고 수집(30초 이상)을 기다리는 사람은 배포 직후 첫 방문자 정도뿐이다.
function send(res, status, body, cdn = "") {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", cdn || "no-store");
  res.end(JSON.stringify(body));
}

// 출처 하나라도 실패했으면 5분만 저장해 금방 다시 시도한다
const cdnHeader = d => (d.sources || []).every(x => x.status === "ok" || x.status === "no-key")
  ? "public, max-age=0, s-maxage=1800, stale-while-revalidate=86400"
  : "public, max-age=0, s-maxage=300, stale-while-revalidate=600";

module.exports = async function handler(req, res) {
  const url = new URL(req.url, "http://localhost");
  const to = kstToday();
  let from = url.searchParams.get("from") || addDays(to, -30);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || from > to) from = addDays(to, -30);
  if (from < addDays(to, -60)) from = addDays(to, -60);   // 너무 먼 과거는 60일로 제한

  const key = `${from}~${to}`;
  if (cache.data && cache.key === key && Date.now() - cache.at < CACHE_MS && url.searchParams.get("refresh") !== "1") {
    return send(res, 200, { ...cache.data, cached: true }, cdnHeader(cache.data));
  }
  try {
    const data = await collectAll({ env: process.env, from, to });
    cache = { key, at: Date.now(), data };
    send(res, 200, data, cdnHeader(data));
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
};
