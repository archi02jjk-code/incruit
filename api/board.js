// /api/board  문의 게시판
//   GET  /api/board?page=1                         목록
//   POST /api/board {action:"view",   id, password}           글 보기 (비밀글은 비밀번호)
//   POST /api/board {action:"create", name, title, content, password, is_private}
//   POST /api/board {action:"delete", id, password}           글쓴이 또는 관리자
//   POST /api/board {action:"answer", id, adminPassword, answer}   관리자 답변 (빈 답변이면 지움)
// 필요한 환경변수: SUPABASE_URL, SUPABASE_SECRET_KEY, (답변용) BOARD_ADMIN_PASSWORD
const B = require("../lib/board");

// 같은 곳에서 너무 자주 쓰는 것 막기 (서버가 다시 뜨면 초기화되는 간단한 방식)
const recent = new Map();
function tooMany(ip, limit = 5, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const list = (recent.get(ip) || []).filter(t => now - t < windowMs);
  if (list.length >= limit) { recent.set(ip, list); return true; }
  list.push(now); recent.set(ip, list);
  if (recent.size > 5000) recent.clear();
  return false;
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;          // Vercel 이 이미 읽어 둔 경우
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  return new Promise(resolve => {
    let raw = "";
    req.on("data", c => { raw += c; if (raw.length > 20000) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

async function handle(req, res, env = process.env, fetchImpl) {
  const db = B.client(env, fetchImpl);
  if (!db) return send(res, 503, { error: "게시판이 아직 준비 중이에요. (Supabase 연결 필요)", notConfigured: true });
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET") return send(res, 200, await B.listPosts(db, url.searchParams.get("page")));
    if (req.method !== "POST") return send(res, 405, { error: "지원하지 않는 요청이에요." });

    const b = await readBody(req);
    const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
    let out;
    switch (b.action) {
      case "view":   out = await B.viewPost(db, b.id, b.password, env); break;
      case "create":
        if (b.website) return send(res, 201, { id: null });                // 스팸 봇용 숨은 칸에 값이 있으면 조용히 무시
        if (tooMany(ip)) return send(res, 429, { error: "잠시 후에 다시 써 주세요. (10분에 5개까지)" });
        out = await B.createPost(db, b); break;
      case "delete": out = await B.deletePost(db, b.id, b.password, env); break;
      case "answer": out = await B.answerPost(db, b.id, b.adminPassword, b.answer, env); break;
      default: return send(res, 400, { error: "알 수 없는 요청이에요." });
    }
    return send(res, out.status, out.body);
  } catch (e) {
    const notReady = /relation .*inquiries.* does not exist|Could not find the table/i.test(e.message);
    return send(res, notReady ? 503 : 500, { error: notReady ? "게시판 테이블이 아직 없어요. supabase/schema.sql 을 실행해 주세요." : "잠시 문제가 생겼어요. 다시 시도해 주세요.", detail: String(e.message).slice(0, 200) });
  }
}

module.exports = (req, res) => handle(req, res);
module.exports.handle = handle;
