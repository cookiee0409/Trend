/*
 * lib/normalize.js — 키워드 정규화 (서버용 CJS)
 *  - 해시태그 # 제거 / 반복 공백 축소 / 앞뒤 공백 제거 / 소문자 통일
 */
function normalizeKeyword(raw) {
  if (raw === null || raw === undefined) return "";
  let s = String(raw);
  s = s.replace(/#/g, "");
  s = s.replace(/\s+/g, " ");
  s = s.trim();
  s = s.toLowerCase();
  return s;
}
module.exports = { normalizeKeyword };
