// GET /api/detail?url=<공고 원문 주소>   → { ok, text } 또는 { ok:false, reason }
// 나라일터·잡아바 공고 페이지의 본문만 읽어 준다. 같은 주소는 6시간 동안 다시 읽지 않는다.
const { allowedUrl, fetchDetail } = require("../lib/detail");

const cache = new Map();            // url → { at, body }
const TTL = 6 * 3600 * 1000;

function send(res, status, body, cacheSec = 0) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", cacheSec ? `public, s-maxage=${cacheSec}, max-age=600` : "no-store");
  res.end(JSON.stringify(body));
}

async function handle(req, res, fetchImpl) {
  const q = new URL(req.url, "http://localhost").searchParams.get("url") || "";
  const url = allowedUrl(q);
  if (!url) return send(res, 200, { ok: false, reason: "읽을 수 없는 사이트" }, 21600);
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL) return send(res, 200, hit.body, 21600);
  const body = await fetchDetail(url, fetchImpl);
  if (body.ok) { cache.set(url, { at: Date.now(), body }); if (cache.size > 3000) cache.clear(); }
  return send(res, 200, body, body.ok ? 21600 : 0);
}

module.exports = (req, res) => handle(req, res);
module.exports.handle = handle;
