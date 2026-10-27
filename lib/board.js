// 문의 게시판: Supabase(PostgREST)와 이야기하는 부분
// 브라우저는 Supabase에 직접 접속하지 않고, Vercel 서버의 /api/board 를 거칩니다.
// 그래서 Supabase secret 키는 서버 환경변수에만 있고 화면에는 나가지 않습니다.
const crypto = require("crypto");

const LIMITS = { name: 20, title: 100, content: 3000, answer: 3000, pwMin: 4, pwMax: 30 };
const PAGE_SIZE = 15;

/* ---------- 비밀번호 해시 (scrypt) ---------- */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(pw), salt, 32).toString("hex");
  return `scrypt$${salt}$${hash}`;
}
function checkPassword(pw, stored) {
  const [kind, salt, hash] = String(stored || "").split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const got = crypto.scryptSync(String(pw ?? ""), salt, 32);
  const want = Buffer.from(hash, "hex");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
function isAdmin(pw, env) {
  const admin = String(env.BOARD_ADMIN_PASSWORD || "");
  if (!admin || !pw) return false;
  const a = Buffer.from(String(pw)), b = Buffer.from(admin);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------- Supabase REST ---------- */
function client(env, fetchImpl = fetch) {
  const base = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!base || !key) return null;
  const headers = { apikey: key, "Content-Type": "application/json" };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;   // 예전 service_role(JWT) 키
  const url = q => `${base}/rest/v1/inquiries${q ? "?" + q : ""}`;
  async function call(method, q, body, extra = {}) {
    const r = await fetchImpl(url(q), { method, headers: { ...headers, ...extra }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    if (!r.ok) {
      let msg = text.slice(0, 200);
      try { const j = JSON.parse(text); msg = j.message || j.msg || j.error || msg; } catch {}
      const err = new Error(`Supabase ${r.status}: ${msg}`); err.status = r.status; throw err;
    }
    return { data: text ? JSON.parse(text) : null, range: r.headers.get("content-range") };
  }
  return { call };
}

/* ---------- 입력 검사 ---------- */
const clean = (s, max) => String(s ?? "").replace(/\r\n/g, "\n").trim().slice(0, max + 1);
function validatePost(b) {
  const name = clean(b.name, LIMITS.name), title = clean(b.title, LIMITS.title), content = clean(b.content, LIMITS.content);
  const password = String(b.password ?? "");
  if (!name) return "이름을 적어 주세요.";
  if (name.length > LIMITS.name) return `이름은 ${LIMITS.name}자까지예요.`;
  if (!title) return "제목을 적어 주세요.";
  if (title.length > LIMITS.title) return `제목은 ${LIMITS.title}자까지예요.`;
  if (!content) return "내용을 적어 주세요.";
  if (content.length > LIMITS.content) return `내용은 ${LIMITS.content}자까지예요.`;
  if (password.length < LIMITS.pwMin || password.length > LIMITS.pwMax) return `비밀번호는 ${LIMITS.pwMin}~${LIMITS.pwMax}자로 정해 주세요.`;
  return { name, title, content, password, is_private: !!b.is_private };
}

/* ---------- 공개해도 되는 모양으로 ---------- */
function toListItem(r) {
  return { id: r.id, created_at: r.created_at, name: r.name, title: r.is_private ? "비밀글입니다" : r.title,
           is_private: r.is_private, answered: !!r.answered_at };
}
function toDetail(r) {
  return { id: r.id, created_at: r.created_at, name: r.name, title: r.title, content: r.content,
           is_private: r.is_private, answer: r.answer || null, answered_at: r.answered_at || null };
}

/* ---------- 동작 ---------- */
async function listPosts(db, page = 1) {
  page = Math.max(1, Math.min(1000, Number(page) || 1));
  const q = new URLSearchParams({ select: "id,created_at,name,title,is_private,answered_at", order: "created_at.desc",
    limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) });
  const { data, range } = await db.call("GET", q.toString(), null, { Prefer: "count=exact" });
  const total = Number(String(range || "").split("/")[1]) || 0;
  return { page, pageSize: PAGE_SIZE, total, items: (data || []).map(toListItem) };
}
async function getRow(db, id) {
  id = Number(id);
  if (!Number.isInteger(id) || id < 1) return null;
  const { data } = await db.call("GET", `id=eq.${id}&select=*`);
  return (data && data[0]) || null;
}
async function viewPost(db, id, password, env) {
  const row = await getRow(db, id);
  if (!row) return { status: 404, body: { error: "없는 글이에요." } };
  if (row.is_private && !checkPassword(password, row.password_hash) && !isAdmin(password, env))
    return { status: 403, body: { error: "비밀글이에요. 글을 쓸 때 정한 비밀번호를 넣어 주세요.", needPassword: true } };
  return { status: 200, body: toDetail(row) };
}
async function createPost(db, b) {
  const v = validatePost(b);
  if (typeof v === "string") return { status: 400, body: { error: v } };
  const { data } = await db.call("POST", "select=id", {
    name: v.name, title: v.title, content: v.content, is_private: v.is_private, password_hash: hashPassword(v.password),
  }, { Prefer: "return=representation" });
  return { status: 201, body: { id: data && data[0] && data[0].id } };
}
async function deletePost(db, id, password, env) {
  const row = await getRow(db, id);
  if (!row) return { status: 404, body: { error: "없는 글이에요." } };
  if (!checkPassword(password, row.password_hash) && !isAdmin(password, env))
    return { status: 403, body: { error: "비밀번호가 맞지 않아요." } };
  await db.call("DELETE", `id=eq.${row.id}`);
  return { status: 200, body: { ok: true } };
}
async function answerPost(db, id, adminPassword, answer, env) {
  if (!env.BOARD_ADMIN_PASSWORD) return { status: 503, body: { error: "관리자 비밀번호(BOARD_ADMIN_PASSWORD)가 설정되지 않았어요." } };
  if (!isAdmin(adminPassword, env)) return { status: 403, body: { error: "관리자 비밀번호가 맞지 않아요." } };
  const text = clean(answer, LIMITS.answer);
  if (text.length > LIMITS.answer) return { status: 400, body: { error: `답변은 ${LIMITS.answer}자까지예요.` } };
  const row = await getRow(db, id);
  if (!row) return { status: 404, body: { error: "없는 글이에요." } };
  await db.call("PATCH", `id=eq.${row.id}`, text ? { answer: text, answered_at: new Date().toISOString() } : { answer: null, answered_at: null });
  return { status: 200, body: { ok: true } };
}

module.exports = { LIMITS, PAGE_SIZE, hashPassword, checkPassword, isAdmin, client, validatePost, toListItem, toDetail,
                   listPosts, viewPost, createPost, deletePost, answerPost };
