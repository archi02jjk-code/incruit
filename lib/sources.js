// 채용공고 3개 채널 어댑터
// 각 API 응답을 화면에서 쓰는 같은 모양(공고 한 건 = 아래 job 객체)으로 바꿉니다.
//
// job = { id, source, org, title, url, posted, start, deadline, regions[], area,
//         hireType, career, field, prefer, headcount, salary, repost }
//   날짜는 모두 "YYYY-MM-DD" 문자열, 모르면 null

const DATA_GO = "https://apis.data.go.kr";
const GG = "https://openapi.gg.go.kr";

// 행정구역 코드 앞 두 자리 → 시도
const SIDO = { "11":"서울","26":"부산","27":"대구","28":"인천","29":"광주","30":"대전","31":"울산","36":"세종",
  "41":"경기","42":"강원","51":"강원","43":"충북","44":"충남","45":"전북","52":"전북","46":"전남","47":"경북","48":"경남","50":"제주" };
const SIDO_NAMES = ["서울","부산","대구","인천","광주","대전","울산","세종","경기","강원","충북","충남","전북","전남","경북","경남","제주"];

const ymd = s => {
  const d = String(s ?? "").replace(/\D/g, "").slice(0, 8);
  return d.length === 8 && d > "19000101" ? `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}` : null;
};
const decodeXml = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const hideKey = msg => String(msg).replace(/(serviceKey|KEY)=[^&\s]+/gi, "$1=***");
// 공공데이터포털 키는 Decoding 키를 쓰는 게 기본. Encoding 키(%2B 등)를 넣어도 동작하게 풀어 둔다.
const normKey = k => { k = String(k || "").trim(); try { return k.includes("%") ? decodeURIComponent(k) : k; } catch { return k; } };
// 나라일터에는 채용공고 말고도 합격자 발표·면접 일정 같은 안내 글과 현직 공무원 전입 모집이 섞여 온다
const NOT_A_POSTING = /합격자|면접시험\s*계획|면접\s*일정|시험\s*장소|시험장소|결과\s*(발표|공고|안내)|응시자\s*유의|전입|비상임|전보|정정\s*공고|취소\s*공고/;
const isPosting = title => !!title && !NOT_A_POSTING.test(title);
const hash = s => { let h = 5381; for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };

async function getText(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status} ${gatewayError(text) || text.slice(0, 120)}`);
    return text;
  } catch (e) {
    if (e.name === "AbortError") throw new Error(`응답 시간이 초과됐어요 (${timeoutMs / 1000}초)`);
    throw e;
  } finally { clearTimeout(t); }
}
// 공공데이터포털 게이트웨이 오류는 XML로 온다 (예: SERVICE_KEY_IS_NOT_REGISTERED_ERROR)
function gatewayError(text) {
  const m = text.match(/<returnAuthMsg>([^<]+)<\/returnAuthMsg>/) || text.match(/<errMsg>([^<]+)<\/errMsg>/);
  if (m) return m[1].trim();
  try {
    const h = JSON.parse(text)?.OpenAPI_ServiceResponse?.cmmMsgHeader;
    if (h) return `${h.errMsg || ""}${h.returnAuthMsg ? " (" + h.returnAuthMsg + ")" : ""}${h.returnReasonCode === "30" ? " — 이 API의 활용신청이 안 됐거나 아직 반영 전이에요" : ""}`.trim();
  } catch {}
  return null;
}
// 여러 쪽을 동시에 (최대 limit 개씩) 받는다
async function mapLimit(list, limit, fn) {
  const out = new Array(list.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (i < list.length) { const k = i++; out[k] = await fn(list[k]); }
  }));
  return out;
}

/* ---------------------------------------------------------------
   1. 인사혁신처_공공취업정보 조회 서비스 (나라일터) — 공공데이터포털 15156780
   GET /1760000/PblJobService/getList  (XML)
   item: areacode, begindate, enddate, idx, insttname, regdate, title, type01, type02
   - 등록일(Begin_de~End_de)로 범위를 좁히고, 정렬이 날짜순이 아니므로 모든 쪽을 4개씩 동시에 읽는다
   - areacode 는 시군구 코드(여러 곳이면 쉼표), 00000 = 미지정
---------------------------------------------------------------- */
function parseMpmXml(xml) {
  const code = (xml.match(/<resultCode>([^<]*)<\/resultCode>/) || [])[1];
  if (code !== undefined && !["00", "0"].includes(code.trim())) {
    const msg = (xml.match(/<resultMsg>([^<]*)<\/resultMsg>/) || [])[1] || "";
    throw new Error(`나라일터 API 오류: ${code.trim()} ${msg}`.trim());
  }
  if (code === undefined) {
    const gw = gatewayError(xml);
    throw new Error(`나라일터 API 오류: ${gw || "응답 형식을 알 수 없어요"}`);
  }
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m =>
    Object.fromEntries([...m[1].matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)].map(x => [x[1], decodeXml(x[2].trim())])));
  const total = Number((xml.match(/<totalCount>(\d+)<\/totalCount>/) || [])[1] || 0);
  return { items, total };
}
function mpmToJob(i) {
  const codes = String(i.areacode || "").split(",").map(s => s.trim()).filter(Boolean);
  const regions = [...new Set(codes.filter(c => c !== "00000").map(c => SIDO[c.slice(0, 2)]).filter(Boolean))];
  return {
    id: `mpm-${i.idx}`, source: "나라일터", org: i.insttname || "", title: i.title,
    url: `https://www.gojobs.go.kr/apmView.do?empmnsn=${i.idx}&searchJobsecode=020&menuNo=401&selMenuNo=400`,
    posted: ymd(i.regdate) || ymd(i.begindate), start: ymd(i.begindate), deadline: ymd(i.enddate),
    regions, area: "", hireType: "", career: "", field: "", prefer: "", headcount: null, salary: "", repost: /재공고|재공모/.test(i.title),
  };
}
async function fetchMpm({ key, from, to, maxPages = 30 }) {
  const base = { serviceKey: key, numOfRows: 100, Pblanc_ty: "", Instt_se: "", Sort_order: "desc", Begin_de: from, End_de: to };
  const url = p => `${DATA_GO}/1760000/PblJobService/getList?` + new URLSearchParams({ ...base, pageNo: p });
  // 공공데이터포털이 느릴 때가 있어 한 쪽당 20초까지 기다리고, 실패하면 한 번 더 시도한다
  const page = async p => {
    try { return parseMpmXml(await getText(url(p), 20000)); }
    catch (e) { if (/API 오류/.test(e.message)) throw e; return parseMpmXml(await getText(url(p), 20000)); }
  };
  // 첫 쪽은 전체 건수를 알아야 해서 꼭 필요하다 → 30초까지 기다린다
  const first = await (async () => {
    try { return parseMpmXml(await getText(url(1), 30000)); }
    catch (e) { if (/API 오류/.test(e.message)) throw e; return parseMpmXml(await getText(url(1), 30000)); }
  })();
  const last = Math.ceil(first.total / 100);
  // 2026-10-27 확인: 정렬 순서가 날짜순이 아니어서 일부 쪽만 읽으면 공고가 빠진다 → 모든 쪽을 읽는다 (최대 maxPages 쪽)
  const pages = [];
  for (let p = 2; p <= Math.min(last, maxPages); p++) pages.push(p);
  const rest = await mapLimit(pages, 6, async p => {
    try { return (await page(p)).items; } catch { return []; }   // 한 쪽이 실패해도 나머지는 쓴다
  });
  const items = first.items.concat(...rest);
  return items.filter(i => isPosting(i.title)).map(mpmToJob);
}

/* ---------------------------------------------------------------
   2·3. 경기데이터드림 Open API (잡아바 공공일자리 / 민간 채용정보 현황)
   GET https://openapi.gg.go.kr/{서비스명}?KEY=&Type=json&pIndex=&pSize=
   응답: { 서비스명: [ {head:[{list_total_count}, {RESULT:{CODE,MESSAGE}}]}, {row:[...]} ] }
   ※ 서비스명과 필드명은 경기데이터드림 해당 데이터의 'Open API' 탭에서 확인해 .env 에 적는다.
     필드명은 이름 규칙으로 자동으로 찾고, 틀리면 .env 의 *_FIELDS 로 직접 지정한다.
---------------------------------------------------------------- */
function pickKey(row, candidates, test) {
  const has = k => row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== "";
  for (const c of candidates) if (has(c)) return c;
  return Object.keys(row).find(k => test(k) && has(k)) || null;
}
// 경기데이터드림 'Open API' 탭에서 확인한 출력값 (2026-10-27)
const GG_KNOWN_FIELDS = {
  // 경기도 내 공공일자리 정보 (잡아바)
  JobFndtnPublJob: { title:"PBLANC_TITLE", org:"INST_NM", start:"RECRUT_BEGIN_DE", end:"RECRUT_END_DE", url:"DETAIL_PAGE_URL" },
  // 경기도일자리재단 잡아바 채용정보 (민간). 예전 '민간 채용정보 현황(EmplmntInfoStus)'은 2025년부터 갱신 중단
  GGJOBABARECRUSTM: { title:"PBANC_CONT", org:"ENTRPRS_NM", start:"RCPT_BGNG_DE", end:"RCPT_END_DE", url:"URL",
                      area:"WORK_REGION_CONT", salary:"SALARY_COND", career:"CAREER_DIV", hire:"PBANC_FORM_DIV",
                      field:"RECRUT_FIELD_NM", headcount:"EMPLMNT_PSNCNT" },
};
function ggFieldMap(row, overrides = {}, service = "") {
  const auto = {
    title:  pickKey(row, ["PBLANC_NM","RECRUT_PBLANC_NM","EMPLMNT_PBLANC_NM","PBANC_NM","RCRIT_NM","TITLE","WANTED_TITLE"], k => /TITLE|PBLANC_NM|PBANC|RCRIT_NM|SUBJECT/.test(k)),
    org:    pickKey(row, ["INST_NM","INSTT_NM","ENTRPS_NM","CMPNY_NM","COMPANY_NM","BIZPLC_NM","CORP_NM"], k => /(INST|ENTRPS|CMPNY|COMPANY|CORP|BIZPLC)/.test(k) && /NM/.test(k)),
    start:  pickKey(row, [], k => /(BEGIN|BGNG|STRT|START|REGIST|REG)/.test(k) && /(DE|DT|YMD|DATE)/.test(k)),
    end:    pickKey(row, [], k => /(END|CLOS|DDLN|DEADLINE)/.test(k) && /(DE|DT|YMD|DATE)/.test(k)),
    url:    pickKey(row, [], k => /URL/.test(k)),
    area:   pickKey(row, [], k => /(ADDR|WORK_AREA|WORK_REGION|SIGUN_NM|AREA)/.test(k)),
    salary: pickKey(row, [], k => /(SALARY|SAL_|PAY|WAGE)/.test(k)),
    career: pickKey(row, [], k => /(CAREER|CARER)/.test(k)),
    hire:   pickKey(row, [], k => /(EMPLMNT_STLE|EMPLYM|HIRE|WORK_STLE|EMPMN_STLE)/.test(k)),
  };
  return { ...auto, ...(GG_KNOWN_FIELDS[service] || {}), ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v)) };
}
function parseGgJson(text, service, name) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`${name} API 오류: ${text.slice(0, 100)}`); }
  if (data.RESULT) {
    if (data.RESULT.CODE === "INFO-200") return { rows: [], total: 0 };      // 데이터 없음
    throw new Error(`${name} API 오류: ${data.RESULT.CODE} ${data.RESULT.MESSAGE || ""}`.trim());
  }
  const block = data[service];
  if (!Array.isArray(block)) throw new Error(`${name} 응답에 '${service}' 항목이 없어요. 서비스명을 확인하세요.`);
  const head = block[0]?.head || [];
  const res = head.find(h => h.RESULT)?.RESULT;
  if (res && res.CODE !== "INFO-000") throw new Error(`${name} API 오류: ${res.CODE} ${res.MESSAGE || ""}`.trim());
  return { rows: block[1]?.row || [], total: Number(head.find(h => h.list_total_count)?.list_total_count || 0) };
}
// 근무지 글자에서 시도 찾기: "서울특별시", "인천광역시", "[대전] ..." 등. 못 찾으면 경기로 본다
function findSido(text) {
  return SIDO_NAMES.filter(n => new RegExp(`(^|[\\[\\(\\s])${n}(특별|광역|도|시|\\]|\\)|\\s|$)`).test(text));
}
function ggToJobs(rows, map, name, idPrefix, today = null) {
  return rows.map(r => {
    const v = k => (k ? String(r[k] ?? "").trim() : "");
    const area = v(map.area);
    const title = v(map.title), org = v(map.org);
    const sido = findSido(area);
    const fromTitle = sido.length ? [] : findSido(title + " " + org);
    const hire = v(map.hire).split("/")[0].trim();          // "기간의 정함이 없는 근로계약/ 파견근로 비희망/ …" → 앞부분만
    return {
      id: `${idPrefix}-${hash(org + title + v(map.start))}`, source: name, org, title, url: v(map.url),
      posted: ymd(v(map.start)), start: ymd(v(map.start)), deadline: ymd(v(map.end)),
      regions: sido.length ? sido : fromTitle.length ? fromTitle : ["경기"], area, hireType: hire, career: v(map.career),
      field: v(map.field), prefer: "", headcount: map.headcount && r[map.headcount] ? Number(r[map.headcount]) : null,
      salary: v(map.salary), repost: /재공고|재공모/.test(title),
    };
  }).filter(j => isPosting(j.title) && !(today && j.deadline && j.deadline < today));   // 마감 지난 공고는 뺀다
}
// 전체가 적으면 다 읽고, 많으면(예: 민간 채용정보 38만 건) 앞쪽 몇 쪽과 끝쪽 몇 쪽만 읽는다.
// pageStats 로 어느 쪽에 접수 중인 공고가 있는지 남겨, 실제 정렬 순서를 확인할 수 있게 한다.
async function fetchGg({ key, service, name, idPrefix, overrides, to, headPages = 3, tailPages = 6, maxAll = 12 }) {
  const url = p => `${GG}/${encodeURIComponent(service)}?` + new URLSearchParams({ KEY: key, Type: "json", pIndex: p, pSize: 100 });
  const first = parseGgJson(await getText(url(1)), service, name);
  const last = Math.ceil(first.total / 100);
  const pages = new Set();
  if (last <= maxAll) for (let p = 2; p <= last; p++) pages.add(p);
  else {
    for (let p = 2; p <= headPages; p++) pages.add(p);
    for (let p = Math.max(2, last - tailPages + 1); p <= last; p++) pages.add(p);
  }
  const list = [...pages];
  const rest = await mapLimit(list, 4, async p => { try { return parseGgJson(await getText(url(p)), service, name).rows; } catch { return []; } });
  const byPage = [[1, first.rows], ...list.map((p, i) => [p, rest[i]])];
  const rows = byPage.flatMap(([, r]) => r);
  const map = rows.length ? ggFieldMap(rows[0], overrides, service) : {};
  const pageStats = byPage.map(([p, r]) => {
    const ends = r.map(x => ymd(map.end ? x[map.end] : "")).filter(Boolean);
    return { page: p, rows: r.length, open: ends.filter(d => !to || d >= to).length + r.filter(x => !(map.end && ymd(x[map.end]))).length };
  });
  return { jobs: ggToJobs(rows, map, name, idPrefix, to), fieldMap: map, sampleKeys: rows.length ? Object.keys(rows[0]) : [], total: first.total, pageStats };
}
const PRIVATE_FIELD_OK = /경영|사무|금융|연구|공학|기술직/;
const privateFieldOk = j => !j.field || PRIVATE_FIELD_OK.test(j.field);
const parseFields = s => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };

/* ---------------------------------------------------------------
   3개 채널을 한꺼번에 모은다. 한 곳이 실패해도 나머지는 그대로 쓴다.
---------------------------------------------------------------- */
async function collectAll({ env, from, to }) {
  const dataKey = normKey(env.DATA_GO_KR_KEY);
  const ggKey = normKey(env.GG_API_KEY);
  const channels = [
    { id: "mpm", name: "나라일터", label: "인사혁신처 공공취업정보",
      missing: !dataKey && "DATA_GO_KR_KEY가 없어요",
      run: () => fetchMpm({ key: dataKey, from, to }) },
    { id: "jobaba", name: "잡아바", label: "경기도 내 공공일자리 정보",
      missing: !ggKey && "GG_API_KEY가 없어요",
      run: () => fetchGg({ key: ggKey, service: env.GG_PUBLIC_JOB_SERVICE || "JobFndtnPublJob", name: "잡아바", idPrefix: "jobaba", overrides: parseFields(env.GG_PUBLIC_JOB_FIELDS), to }) },
    { id: "ggprivate", name: "경기 민간채용", label: "경기도일자리재단 잡아바 채용정보",
      missing: !ggKey && "GG_API_KEY가 없어요",
      // 2026-10-27 확인: 38만 건 중 앞쪽은 지난 공고, 최신 공고는 끝쪽에 있다 → 끝쪽 12쪽을 읽는다
      // 경력직 재취업과 거리가 먼 생산·서비스·운전 직무군은 받지 않는다 (경영·사무, 연구·공학 기술직, 직무 미기재만)
      run: async () => {
        const out = await fetchGg({ key: ggKey, service: env.GG_PRIVATE_JOB_SERVICE || "GGJOBABARECRUSTM", name: "경기 민간채용", idPrefix: "ggp", overrides: parseFields(env.GG_PRIVATE_JOB_FIELDS), to, headPages: 1, tailPages: 12 });
        return { ...out, jobs: out.jobs.filter(privateFieldOk) };
      } },
  ];

  const sources = await Promise.all(channels.map(async c => {
    const base = { id: c.id, name: c.name, label: c.label };
    if (c.missing) return { ...base, status: "no-key", message: c.missing, count: 0, jobs: [] };
    try {
      const out = await c.run();
      const jobs = Array.isArray(out) ? out : out.jobs;
      return { ...base, status: "ok", count: jobs.length, jobs, fieldMap: out.fieldMap, sampleKeys: out.sampleKeys, total: out.total, pageStats: out.pageStats };
    } catch (e) {
      return { ...base, status: "error", message: hideKey(e.message), count: 0, jobs: [] };
    }
  }));

  // 같은 공고가 두 채널에 올라온 경우 하나만 남긴다
  const seen = new Set(), jobs = [];
  for (const s of sources) for (const j of s.jobs) {
    const k = (j.org + "|" + j.title).replace(/\s+/g, "");
    if (seen.has(k)) continue;
    seen.add(k); jobs.push(j);
  }
  return {
    generatedAt: new Date().toISOString(), from, to,
    sources: sources.map(({ jobs, ...s }) => s),
    jobs,
  };
}

module.exports = { collectAll, isPosting, privateFieldOk, findSido, GG_KNOWN_FIELDS, parseMpmXml, mpmToJob, parseGgJson, ggFieldMap, ggToJobs, ymd, normKey, hideKey };
