// 로컬 실행용 서버 (설치할 패키지 없음, Node 18 이상)
//   node server.js   →   http://localhost:3000
// .env 파일의 API 키를 읽어 /api/jobs 로 실제 공고를 가져옵니다.
const http = require("http");
const fs = require("fs");
const path = require("path");

// .env 읽기 (KEY=VALUE 형식)
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}

const jobsHandler = require("./api/jobs");
const boardHandler = require("./api/board");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
const PORT = Number(process.env.PORT || 3000);

http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  if (pathname === "/api/jobs") return jobsHandler(req, res);
  if (pathname === "/api/board") return boardHandler(req, res);

  // 정적 파일: 이 폴더 안의 공개 파일만 (.env, lib, api 등은 내보내지 않음)
  const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const file = path.join(__dirname, rel);
  const blocked = !file.startsWith(__dirname + path.sep) || /(^|[\\/])(\.env|\.git|lib|api|test|supabase|node_modules|server\.js|package\.json)([\\/]|$)/.test(rel);
  if (blocked || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.statusCode = 404; res.setHeader("Content-Type", "text/plain; charset=utf-8"); return res.end("없는 페이지예요.");
  }
  res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => {
  const has = k => (process.env[k] ? "있음" : "없음");
  console.log(`\n다시출근 로컬 서버: http://localhost:${PORT}`);
  console.log(`  공공데이터포털 키(DATA_GO_KR_KEY): ${has("DATA_GO_KR_KEY")}`);
  console.log(`  경기데이터드림 키(GG_API_KEY): ${has("GG_API_KEY")}`);
  console.log(`  게시판 Supabase(SUPABASE_URL·SUPABASE_SECRET_KEY): ${process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY ? "있음" : "없음"}`);
  console.log(`  키가 없는 채널은 화면에 '키 없음'으로 표시돼요.\n`);
});
