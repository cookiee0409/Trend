/*
 * lib/spam.js — 스팸 키워드 분류기 (보수적 규칙, 오탐 최소화 지향).
 *
 * 설계: "차단"이 아니라 "분류"다.
 *  - classify() 는 스팸 여부와 매칭 규칙만 알려준다(데이터는 지우지 않음).
 *  - 화이트리스트(사용자가 '정상'으로 표시한 정규화 키워드)는 항상 스팸 아님.
 *  - 사용자 추가 스팸어(extra_terms)는 부분일치로 매칭.
 *  - 리포트에서 실제 제외 여부는 settings.spam_filter.mode(observe|enforce)가 결정한다.
 *
 * 기본 규칙은 한국 X/Twitter 트렌드에 흔한 광고 스팸(성인서비스/연락처유도/불법금융/도박)에
 * 한정한다. 모호한 단일 단어(예: 대출/만남 단독)는 오탐 위험이 커서 기본 규칙에서 제외하고,
 * 필요하면 사용자가 extra_terms 로 직접 추가하도록 둔다.
 */
var Normalize = require("./normalize");

var DEFAULT_PATTERNS = [
  { rule: "성인서비스", re: /(출장\s*안마|출장\s*만남|조건\s*만남|애인\s*대행|오피스타|건마|휴게텔|립카페|안마방|키스방)/i },
  { rule: "만남알선", re: /(만남\s*(진행|가능|구함|문의)|즉석\s*만남|성인\s*만남|섹파|폰섹)/i },
  { rule: "연락처유도", re: /(qq\s*\d{3,}|라인\s*[a-z0-9]{2,}|텔레\s*[a-z0-9@]|텔레그램\s*[a-z0-9@]|위커\s*[a-z0-9]|wickr|카톡\s*[a-z0-9]{2,})/i },
  { rule: "불법금융", re: /(작업\s*대출|내구제|무직자\s*대출|급전\s*대출|미납\s*대출|통장\s*대여)/i },
  { rule: "도박", re: /(먹튀\s*검증|토토\s*사이트|카지노\s*사이트|바카라\s*사이트|슬롯\s*사이트|사설\s*토토)/i }
];

// keyword: 원본 문자열, opts: { extraTerms:[], whitelist:[] (정규화된 키워드 목록) }
function classify(keyword, opts) {
  opts = opts || {};
  var extraTerms = opts.extraTerms || [];
  var whitelist = opts.whitelist || [];
  var nk = Normalize.normalizeKeyword(keyword);

  if (whitelist.indexOf(nk) !== -1) {
    return { spam: false, rule: null, whitelisted: true };
  }
  for (var i = 0; i < extraTerms.length; i++) {
    var term = Normalize.normalizeKeyword(extraTerms[i]);
    if (term && nk.indexOf(term) !== -1) {
      return { spam: true, rule: "사용자추가:" + extraTerms[i], whitelisted: false };
    }
  }
  for (var j = 0; j < DEFAULT_PATTERNS.length; j++) {
    if (DEFAULT_PATTERNS[j].re.test(keyword)) {
      return { spam: true, rule: DEFAULT_PATTERNS[j].rule, whitelisted: false };
    }
  }
  return { spam: false, rule: null, whitelisted: false };
}

function isSpam(keyword, opts) {
  return classify(keyword, opts).spam;
}

module.exports = {
  classify: classify,
  isSpam: isSpam,
  DEFAULT_PATTERNS: DEFAULT_PATTERNS
};
