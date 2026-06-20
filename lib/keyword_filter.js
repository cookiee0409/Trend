/*
 * lib/keyword_filter.js — 블로그/카페 검색에 부적합한 키워드 제외 (제안서 11장).
 *  - 한 글자 / 숫자만 / 특수문자만 제외
 *  - ignore_keywords(설정)에 포함된 단어는 제외 (부분일치)
 */
var Normalize = require("./normalize");

function shouldIgnore(keyword, ignoreList) {
  var k = (keyword == null ? "" : String(keyword)).trim();
  if (k.length <= 1) return { ignore: true, reason: "한 글자" };
  if (/^\d+$/.test(k)) return { ignore: true, reason: "숫자만" };
  if (/^[^\p{L}\p{N}]+$/u.test(k)) return { ignore: true, reason: "특수문자만" };

  var nk = Normalize.normalizeKeyword(k);
  var list = ignoreList || [];
  for (var i = 0; i < list.length; i++) {
    var ig = Normalize.normalizeKeyword(list[i]);
    if (ig && nk.indexOf(ig) !== -1) return { ignore: true, reason: "제외목록:" + list[i] };
  }
  return { ignore: false, reason: null };
}

// 키워드 배열에서 통과한 것만 정규화 키워드 중복 제거하여 반환
function filterKeywords(keywords, ignoreList, limit) {
  var out = [];
  var seen = {};
  for (var i = 0; i < keywords.length; i++) {
    var kw = keywords[i];
    if (shouldIgnore(kw, ignoreList).ignore) continue;
    var nk = Normalize.normalizeKeyword(kw);
    if (seen[nk]) continue;
    seen[nk] = true;
    out.push(kw);
    if (limit && out.length >= limit) break;
  }
  return out;
}

module.exports = { shouldIgnore, filterKeywords };
