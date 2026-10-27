// 문의 게시판을 가짜 Supabase(메모리)로 끝까지 확인합니다.  실행: npm test
const assert = require("assert");
const { handle } = require("../api/board");
const B = require("../lib/board");

// --- 아주 작은 가짜 PostgREST ---
function fakeSupabase() {
  const rows = []; let seq = 0; const calls = [];
  async function fetchImpl(url, opt) {
    const u = new URL(url); calls.push({ method: opt.method, url, headers: opt.headers });
    const idEq = (u.searchParams.get("id") || "").replace("eq.", "");
    const reply = (status, body, headers = {}) => ({ ok: status < 400, status, text: async () => (body === undefined ? "" : JSON.stringify(body)), headers: { get: k => headers[k.toLowerCase()] ?? null } });
    if (opt.method === "GET" && idEq) return reply(200, rows.filter(r => String(r.id) === idEq));
    if (opt.method === "GET") {
      const lim = +u.searchParams.get("limit"), off = +u.searchParams.get("offset");
      const sorted = [...rows].sort((a, b) => b.id - a.id).slice(off, off + lim)
        .map(r => ({ id: r.id, created_at: r.created_at, name: r.name, title: r.title, is_private: r.is_private, answered_at: r.answered_at }));
      return reply(200, sorted, { "content-range": `0-${sorted.length - 1}/${rows.length}` });
    }
    if (opt.method === "POST") { const r = { id: ++seq, created_at: new Date().toISOString(), answer: null, answered_at: null, ...JSON.parse(opt.body) }; rows.push(r); return reply(201, [{ id: r.id }]); }
    if (opt.method === "PATCH") { Object.assign(rows.find(r => String(r.id) === idEq), JSON.parse(opt.body)); return reply(204); }
    if (opt.method === "DELETE") { rows.splice(rows.findIndex(r => String(r.id) === idEq), 1); return reply(204); }
  }
  return { rows, calls, fetchImpl };
}
const ENV = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_test", BOARD_ADMIN_PASSWORD: "admin-1234" };
async function api(fake, method, body, path = "/api/board", env = ENV) {
  const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(s) { this.body = JSON.parse(s); } };
  await handle({ method, url: path, body, headers: { "x-forwarded-for": "1.2.3." + Math.random() } }, res, env, fake.fetchImpl);
  return res;
}

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log("  ✓", name); };

(async () => {
  await t("비밀번호는 해시로만 저장하고 맞는지 확인한다", () => {
    const h = B.hashPassword("1234");
    assert.ok(h.startsWith("scrypt$") && !h.includes("1234"));
    assert.ok(B.checkPassword("1234", h)); assert.ok(!B.checkPassword("12345", h));
  });

  await t("Supabase 설정이 없으면 '준비 중'으로 답한다", async () => {
    const r = await api(fakeSupabase(), "GET", null, "/api/board", {});
    assert.equal(r.statusCode, 503); assert.ok(r.body.notConfigured);
  });

  const fake = fakeSupabase();
  await t("글을 쓰면 비밀번호 원문은 저장되지 않는다", async () => {
    const r = await api(fake, "POST", { action: "create", name: "홍길동", title: "공고 문의", content: "추천 기준이 궁금해요", password: "1234" });
    assert.equal(r.statusCode, 201); assert.equal(r.body.id, 1);
    assert.ok(!JSON.stringify(fake.rows).includes('"1234"'));
    assert.equal(fake.calls.at(-1).headers.apikey, "sb_secret_test");
    assert.equal(fake.calls.at(-1).headers.Authorization, undefined);      // 새 secret 키는 apikey 헤더만
  });

  await t("빈 칸·짧은 비밀번호는 막는다, 스팸 칸은 조용히 무시", async () => {
    assert.equal((await api(fake, "POST", { action: "create", name: "", title: "a", content: "b", password: "1234" })).statusCode, 400);
    assert.equal((await api(fake, "POST", { action: "create", name: "a", title: "a", content: "b", password: "12" })).body.error, "비밀번호는 4~30자로 정해 주세요.");
    const spam = await api(fake, "POST", { action: "create", name: "a", title: "a", content: "b", password: "1234", website: "http://spam" });
    assert.equal(spam.statusCode, 201); assert.equal(fake.rows.length, 1);
  });

  await t("비밀글은 목록에서 제목을 가리고, 비밀번호가 있어야 본다", async () => {
    await api(fake, "POST", { action: "create", name: "김OO", title: "개인 사정 문의", content: "비공개 내용", password: "pass99", is_private: true });
    const list = await api(fake, "GET", null, "/api/board?page=1");
    assert.equal(list.body.total, 2);
    assert.equal(list.body.items[0].title, "비밀글입니다");
    assert.ok(!JSON.stringify(list.body).includes("password_hash"));
    assert.equal((await api(fake, "POST", { action: "view", id: 2 })).statusCode, 403);
    assert.equal((await api(fake, "POST", { action: "view", id: 2, password: "wrong" })).statusCode, 403);
    const ok = await api(fake, "POST", { action: "view", id: 2, password: "pass99" });
    assert.equal(ok.body.content, "비공개 내용"); assert.equal(ok.body.password_hash, undefined);
    assert.equal((await api(fake, "POST", { action: "view", id: 2, password: "admin-1234" })).statusCode, 200);   // 관리자는 볼 수 있음
  });

  await t("관리자만 답변을 달 수 있다", async () => {
    assert.equal((await api(fake, "POST", { action: "answer", id: 1, adminPassword: "nope", answer: "x" })).statusCode, 403);
    assert.equal((await api(fake, "POST", { action: "answer", id: 1, adminPassword: "admin-1234", answer: "기준은 화면 아래에 있어요." })).statusCode, 200);
    const v = await api(fake, "POST", { action: "view", id: 1 });
    assert.equal(v.body.answer, "기준은 화면 아래에 있어요.");
    assert.equal((await api(fake, "GET", null)).body.items[1].answered, true);
  });

  await t("글쓴이 비밀번호나 관리자 비밀번호로만 지운다", async () => {
    assert.equal((await api(fake, "POST", { action: "delete", id: 1, password: "0000" })).statusCode, 403);
    assert.equal((await api(fake, "POST", { action: "delete", id: 1, password: "1234" })).statusCode, 200);
    assert.equal((await api(fake, "POST", { action: "delete", id: 2, password: "admin-1234" })).statusCode, 200);
    assert.equal(fake.rows.length, 0);
    assert.equal((await api(fake, "POST", { action: "view", id: 1 })).statusCode, 404);
  });

  await t("짧은 시간에 너무 많이 쓰면 막는다", async () => {
    const f = fakeSupabase(); const env = ENV;
    const res = () => ({ statusCode: 0, headers: {}, setHeader() {}, end(s) { this.body = JSON.parse(s); } });
    let last;
    for (let i = 0; i < 6; i++) { last = res(); await handle({ method: "POST", url: "/api/board", body: { action: "create", name: "a", title: "t" + i, content: "c", password: "1234" }, headers: { "x-forwarded-for": "9.9.9.9" } }, last, env, f.fetchImpl); }
    assert.equal(last.statusCode, 429); assert.equal(f.rows.length, 5);
  });

  console.log(`\n게시판 ${passed}개 모두 통과`);
})().catch(e => { console.error(e); process.exit(1); });
