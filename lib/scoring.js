/*
 * lib/scoring.js — 내부 기준 주목도(trend_score) (서버용 CJS)
 * 주의: "정확한 인기 순위"가 아니라 "내부 기준 주목도"다.
 */
function computeScore(snapshots, opts) {
  opts = opts || {};
  if (!snapshots || snapshots.length === 0) return 0;
  let score = 0;
  const sources = {};
  let bestRank = Infinity;
  snapshots.forEach(function (s) {
    sources[s.source] = true;
    if (typeof s.rank === "number" && s.rank > 0 && s.rank < bestRank) bestRank = s.rank;
  });
  if (snapshots.length >= 2) score += 2;
  score += Math.min(snapshots.length, 5);
  if (bestRank <= 10) score += 3;
  else if (bestRank <= 20) score += 1;
  if (sources["google_trends"] && sources["trends24_x"]) score += 3;
  if (Object.keys(sources).length >= 2) score += 1;
  if (opts.inNaverGroups) score += 2;
  return score;
}
module.exports = { computeScore };
