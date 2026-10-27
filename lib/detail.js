// 공고 원문 페이지에서 본문 글자만 뽑는다 ('반드시 포함' 단어를 내용에서 찾기 위해)
// 읽을 수 있는 곳 (2026-10-27 확인):
//   - 나라일터  www.gojobs.go.kr/apmView.do   → <textarea id="content"> 본문 + 표(채용직급·근무지역·첨부파일)
//   - 잡아바    job.gg.go.kr/...               → <article class="jb-detaildoc"> 본문
// 그 밖의 사이트(잡코리아, 고용24 등)는 읽지 않는다.

const ALLOWED = [
  { host: /^(www\.)?gojobs\.go\.kr$/, path: /^\/apmView\.do$/ },
  { host: /^job\.gg\.go\.kr$/, path: /^\// },
];
function allowedUrl(raw) {
  try {
    const u = new URL(String(raw).trim());
    if (!/^https?:$/.test(u.protocol)) return null;
    return ALLOWED.some(a => a.host.test(u.hostname) && a.path.test(u.pathname)) ? u.toString() : null;
  } catch { return null; }
}

const decode = s => String(s)
  .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h\d|dt|dd)>/gi, "\n")
  .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&(middot|lsquo|rsquo|ldquo|rdquo|hellip|ndash|mdash|bull|times);/g, (_, n) =>
    ({ middot:"·", lsquo:"‘", rsquo:"’", ldquo:"“", rdquo:"”", hellip:"…", ndash:"–", mdash:"—", bull:"•", times:"×" })[n])
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&")
  .replace(/[ \t\r\f\v]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();

function extract(html, url) {
  const host = new URL(url).hostname;
  if (/gojobs\.go\.kr$/.test(host)) {
    const body = (html.match(/<textarea[^>]*id=["']content["'][^>]*>([\s\S]*?)<\/textarea>/i) || [])[1] || "";
    const rows = [...html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)]
      .map(m => [decode(m[1]), decode(m[2])])
      .filter(([k]) => /채용직급|근무지역|첨부파일|모집분야|자격/.test(k))
      .map(([k, v]) => `${k}: ${v}`);
    return decode(body) + (rows.length ? "\n" + rows.join("\n") : "");
  }
  if (/job\.gg\.go\.kr$/.test(host)) {
    const art = (html.match(/<article[^>]*jb-detaildoc[^>]*>([\s\S]*?)<\/article>/i) || [])[1];
    if (art) return decode(art);
  }
  const main = (html.match(/<main[\s\S]*?<\/main>/i) || html.match(/<body[\s\S]*?<\/body>/i) || [html])[0];
  return decode(main);
}

async function fetchDetail(url, fetchImpl = fetch, timeoutMs = 8000) {
  const ok = allowedUrl(url);
  if (!ok) return { ok: false, reason: "읽을 수 없는 사이트" };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(ok, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (dasi-chulgeun job matcher)", "Accept-Language": "ko" } });
    if (!r.ok) return { ok: false, reason: `HTTP ${r.status}` };
    const text = extract(await r.text(), ok).slice(0, 8000);
    return text ? { ok: true, text } : { ok: false, reason: "본문을 찾지 못함" };
  } catch (e) {
    return { ok: false, reason: e.name === "AbortError" ? "시간 초과" : "연결 실패" };
  } finally { clearTimeout(t); }
}

module.exports = { allowedUrl, extract, fetchDetail, decode };
