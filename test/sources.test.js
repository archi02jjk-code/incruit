// 실제 API 응답 형식 샘플로 변환 로직을 확인합니다.  실행: npm test
// mpm_list.xml / alio_list.json 은 2026-10 실제 응답 형식을 담은 샘플입니다.
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const S = require("../lib/sources");
const read = f => fs.readFileSync(path.join(__dirname, f), "utf8");

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log("  ✓", name); };

t("나라일터 XML을 공고로 바꾼다", () => {
  const { items, total } = S.parseMpmXml(read("mpm_list.xml"));
  assert.equal(total, 6); assert.equal(items.length, 6);
  const j = S.mpmToJob(items[0]);
  assert.equal(j.source, "나라일터");
  assert.equal(j.title, "2026학년도 삼호초등학교 방과후 컴퓨터 시간강사 채용 공고");
  assert.equal(j.posted, "2026-10-07"); assert.equal(j.deadline, "2026-10-14");
  assert.deepEqual(j.regions, ["울산"]);
  assert.ok(j.url.includes("empmnsn=305163"));
  const multi = S.mpmToJob(items[2]);                       // 31170,26200 → 울산, 부산
  assert.deepEqual(multi.regions, ["울산", "부산"]);
});

t("나라일터 실제 응답(2026-10-27): 빈 접수시작일, 안내 글 걸러내기", () => {
  const { items, total } = S.parseMpmXml(read("mpm_live_2026-10-27.xml"));
  assert.equal(total, 637); assert.equal(items.length, 5);
  const j = S.mpmToJob(items[0]);
  assert.equal(j.posted, "2026-10-26"); assert.equal(j.start, null); assert.deepEqual(j.regions, ["경기"]);
  assert.equal(S.mpmToJob(items[1]).repost, true);
  const kept = items.filter(i => S.isPosting(i.title)).map(i => i.idx);
  assert.deepEqual(kept, ["289736", "303839", "304414"]);   // 합격자·면접 안내, 전입 모집은 뺀다
});

t("나라일터 키 오류를 알아듣는다", () => {
  assert.throws(() => S.parseMpmXml(read("datagokr_key_error.xml")), /SERVICE_KEY_IS_NOT_REGISTERED/);
});

t("잡알리오 JSON을 공고로 바꾼다", () => {
  const { items, total } = S.parseAlioJson(read("alio_list.json"));
  assert.equal(total, 3);
  const j = S.alioToJob(items[1]);
  assert.equal(j.org, "한국청소년상담복지개발원");
  assert.equal(j.posted, "2026-10-12"); assert.equal(j.deadline, "2026-10-27");
  assert.deepEqual(j.regions, ["부산"]);
  assert.equal(j.career, "신입+경력"); assert.equal(j.headcount, 3);
  assert.equal(j.url, "https://job.alio.go.kr/recruitview.do?idx=305902");
  assert.throws(() => S.parseAlioJson('{"resultCode":500,"resultMsg":"fail"}'), /500/);
  // 2026-10-27 실제 응답: 활용신청 전 키
  assert.throws(() => S.parseAlioJson('{"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"errMsg":"SERVICE_KEY_IS_NOT_REGISTERED_ERROR","returnAuthMsg":"등록되지 않은 서비스키","returnReasonCode":"30"}}}'), /활용신청/);
});

t("경기데이터드림 응답 틀과 필드 자동 매칭", () => {
  const body = JSON.stringify({ SvcX: [
    { head: [{ list_total_count: 2 }, { RESULT: { CODE: "INFO-000", MESSAGE: "정상 처리되었습니다." } }, { api_version: "1.0" }] },
    { row: [
      { SIGUN_NM: "수원시", ENTRPS_NM: "(주)테스트", PBLANC_NM: "보안관제 팀장", RCPT_BEGIN_DE: "2026-10-21", RCPT_END_DE: "20261105", DETAIL_URL: "https://x.test/1", SALARY_CN: "연 6000만 원" },
      { SIGUN_NM: "서울특별시 중구", ENTRPS_NM: "(주)둘", PBLANC_NM: "사업관리", RCPT_BEGIN_DE: "20261022", RCPT_END_DE: "" },
    ] },
  ] });
  const { rows, total } = S.parseGgJson(body, "SvcX", "경기 민간채용");
  assert.equal(total, 2);
  const map = S.ggFieldMap(rows[0]);
  assert.equal(map.title, "PBLANC_NM"); assert.equal(map.org, "ENTRPS_NM");
  assert.equal(map.start, "RCPT_BEGIN_DE"); assert.equal(map.end, "RCPT_END_DE");
  assert.equal(map.url, "DETAIL_URL"); assert.equal(map.area, "SIGUN_NM"); assert.equal(map.salary, "SALARY_CN");
  const jobs = S.ggToJobs(rows, map, "경기 민간채용", "ggp");
  assert.equal(jobs[0].posted, "2026-10-21"); assert.equal(jobs[0].deadline, "2026-11-05");
  assert.deepEqual(jobs[0].regions, ["경기"]); assert.deepEqual(jobs[1].regions, ["서울"]);
  assert.equal(jobs[1].deadline, null);
  assert.equal(S.ggFieldMap(rows[0], { title: "ENTRPS_NM" }).title, "ENTRPS_NM");   // 직접 지정이 우선
  assert.deepEqual(S.parseGgJson('{"RESULT":{"CODE":"INFO-200","MESSAGE":"해당하는 데이터가 없습니다."}}', "SvcX", "x").rows, []);
  assert.throws(() => S.parseGgJson('{"RESULT":{"CODE":"ERROR-290","MESSAGE":"인증키가 유효하지 않습니다."}}', "SvcX", "x"), /ERROR-290/);
});

t("키는 로그에 남기지 않는다", () => {
  assert.equal(S.hideKey("https://a?serviceKey=SECRET&x=1"), "https://a?serviceKey=***&x=1");
  assert.equal(S.normKey("abc%2Bdef%3D%3D"), "abc+def==");
});

(async () => {
  const out = await S.collectAll({ env: {}, from: "2026-10-13", to: "2026-10-27" });
  assert.equal(out.sources.length, 4);
  assert.ok(out.sources.every(s => s.status === "no-key"));
  assert.equal(out.jobs.length, 0);
  passed++; console.log("  ✓ 키가 없으면 채널별로 '키 없음'을 돌려준다");
  console.log(`\n${passed}개 모두 통과`);
})();
