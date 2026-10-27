// 공고 원문 본문 읽기 확인 (2026-10-27 실제 페이지 구조를 줄인 샘플)
const assert = require("assert");
const D = require("../lib/detail");
const { handle } = require("../api/detail");

const GOJOBS = `<html><body><table><tr><th scope="row">공고명</th><td>조달청 기간제근로자 채용 공고(기계분야 설계검토)</td></tr>
<tr><th>채용직급</th><td> 기간제 근로자&nbsp;1명<br/> </td></tr><tr><th>근무지역</th><td>대전광역시 서구</td></tr></table>
<textarea id="content" readonly>조달청 기간제근로자 공개경쟁 채용시험 공고&#40;제2026-524호&#41;\r\n- 모집분야 : 시설공사 맞춤형서비스 설계검토 업무 (기계 1명)\r\n- 자격요건 : 공고문 참조</textarea></body></html>`;
const JOBABA = `<html><body><header>메뉴 보안 로그인</header><main class="jb-container"><article class="jb-detaildoc">
<h1 class="jb-detailhead__title">2025년 경기도 누림하우스 주거파트너 모집 공고</h1>
<section><h2>📂 담당업무</h2><p>가사지원, 건강위생 관리, 외출지원 &middot; 상담&#x00B7;조언</p></section>
<section><h2>📂 근무조건</h2><p>보수 및 복지 : 시급 12,152원</p></section></article><aside>추천 공고 정보보안</aside></main></body></html>`;

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log("  ✓", name); };
const fakeFetch = html => async () => ({ ok: true, status: 200, text: async () => html });

(async () => {
  await t("읽어도 되는 주소만 허용", () => {
    assert.ok(D.allowedUrl("https://www.gojobs.go.kr/apmView.do?empmnsn=304414&searchJobsecode=020"));
    assert.ok(D.allowedUrl("https://job.gg.go.kr/pblcEmpmn/publicJobDetail.do?seq=37256"));
    assert.equal(D.allowedUrl("https://www.jobkorea.co.kr/Recruit/GI_Read/1"), null);
    assert.equal(D.allowedUrl("https://www.gojobs.go.kr/other.do"), null);
    assert.equal(D.allowedUrl("javascript:alert(1)"), null);
    assert.equal(D.allowedUrl("https://evil.example/?u=gojobs.go.kr/apmView.do"), null);
  });

  await t("나라일터: textarea 본문과 채용직급·근무지역을 읽는다", () => {
    const text = D.extract(GOJOBS, "https://www.gojobs.go.kr/apmView.do?empmnsn=1");
    assert.ok(text.includes("시설공사 맞춤형서비스 설계검토"));
    assert.ok(text.includes("(제2026-524호)"));
    assert.ok(text.includes("채용직급: 기간제 근로자 1명"));
    assert.ok(text.includes("근무지역: 대전광역시 서구"));
    assert.ok(!text.includes("공고명:"));
  });

  await t("잡아바: 본문(article)만 읽고 메뉴·옆 광고는 뺀다", () => {
    const text = D.extract(JOBABA, "https://job.gg.go.kr/pblcEmpmn/publicJobDetail.do?seq=1");
    assert.ok(text.includes("외출지원 · 상담·조언") && text.includes("시급 12,152원"));
    assert.ok(!text.includes("정보보안") && !text.includes("로그인"));
  });

  await t("/api/detail: 허용 안 된 주소는 읽지 않고, 읽은 결과는 기억한다", async () => {
    let calls = 0;
    const f = async () => { calls++; return { ok: true, status: 200, text: async () => GOJOBS }; };
    const call = async url => { const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(s) { this.body = JSON.parse(s); } };
      await handle({ url: "/api/detail?url=" + encodeURIComponent(url) }, res, f); return res; };
    assert.equal((await call("https://www.jobkorea.co.kr/x")).body.ok, false);
    const a = await call("https://www.gojobs.go.kr/apmView.do?empmnsn=9");
    const b = await call("https://www.gojobs.go.kr/apmView.do?empmnsn=9");
    assert.ok(a.body.ok && a.body.text.includes("설계검토")); assert.deepEqual(a.body, b.body); assert.equal(calls, 1);
  });

  await t("응답 실패·시간 초과는 ok:false", async () => {
    assert.equal((await D.fetchDetail("https://www.gojobs.go.kr/apmView.do?empmnsn=1", async () => ({ ok: false, status: 500, text: async () => "" }))).ok, false);
    const slow = (u, o) => new Promise((_, rej) => o.signal.addEventListener("abort", () => { const e = new Error("x"); e.name = "AbortError"; rej(e); }));
    assert.equal((await D.fetchDetail("https://www.gojobs.go.kr/apmView.do?empmnsn=1", slow, 50)).reason, "시간 초과");
  });

  console.log(`\n공고 본문 ${passed}개 모두 통과`);
})().catch(e => { console.error(e); process.exit(1); });
