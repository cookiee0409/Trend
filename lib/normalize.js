/*
 * lib/normalize.js — 키워드 정규화 + HTML 정리 (서버용 CJS)
 *  - stripHtml: 네이버 API 결과의 <b>...</b> 등 태그/엔티티 제거
 *  - normalizeKeyword: 해시태그 # 제거 / 반복 공백 축소 / 앞뒤 공백 / 소문자
 */
function stripHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

function normalizeKeyword(raw) {
  if (raw === null || raw === undefined) return "";
  let s = stripHtml(raw);  // HTML 태그 먼저 제거
  s = s.replace(/#/g, "");
  s = s.replace(/\s+/g, " ");
  s = s.trim();
  s = s.toLowerCase();
  return s;
}

module.exports = { normalizeKeyword, stripHtml };
