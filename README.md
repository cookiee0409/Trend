# 트렌드 자동 수집 · 리포트 도구 (Vercel 배포판)

개인용 트렌드 수집·리포트 도구입니다. **GitHub 에 올리고 Vercel 에 연결하면** 별도 서버 없이
서버리스 함수 + KV(Upstash Redis)로 동작하며, **매일 자동으로 트렌드를 수집하고 리포트를 생성**합니다.

수집 대상:
1. **Google Trends** (Trending Now RSS)
2. **네이버 데이터랩** (지정 키워드 그룹의 검색 관심도)
3. **Trends24** 한국 X/Twitter 트렌드
4. **네이버 블로그·카페 검색** (Google Trends 키워드의 블로그 확산/카페 반응 분석)
5. **YouTube** (한국 인기 영상 + Google Trends 키워드 영상 검색)

> 인스타그램은 제외. 값은 절대 검색량이 아니라 **검색 관심도 / 내부 기준 주목도**입니다.

---

## 0. 한눈에 보는 동작 구조

```
브라우저(정적 index.html)  ──fetch──▶  /api/*  (Vercel 서버리스 함수)
                                          │
                          ┌───────────────┼─────────────────┐
                          ▼               ▼                 ▼
                  외부 사이트 수집     Upstash Redis(KV)    리포트 생성
                  (실패 시 mock)        영구 저장          (규칙 기반 MD)
                          ▲
                  Vercel Cron (매일 09/15/21시 KST 자동 수집 + 리포트)
```

- 외부 사이트 수집은 **서버에서** 하므로 CORS 문제가 없습니다(브라우저 직접 호출 X).
- 수집/파싱 실패 시 **mock 데이터로 자동 대체**되어 앱이 멈추지 않습니다.

---

## 1. 배포 순서 (GitHub → Vercel)

### ① GitHub 에 올리기
이 폴더를 그대로 커밋·푸시하면 됩니다. (`node_modules`, `.env` 는 `.gitignore` 로 제외됨)
```bash
git init
git add .
git commit -m "init: trend report tool"
git branch -M main
git remote add origin https://github.com/<당신>/<레포>.git
git push -u origin main
```

### ② Vercel 에 연결
1. https://vercel.com → **Add New → Project** → 방금 만든 GitHub 레포 Import
2. Framework Preset: **Other** (그대로 두면 됩니다. 빌드 설정 불필요)
3. 일단 **Deploy**. (이 시점엔 KV 가 없어 데이터가 안 쌓이지만 화면은 떠야 정상)

### ③ Upstash Redis(KV) 연결 — **필수**
데이터 영구 저장소입니다. 없으면 화면에 "저장소 미연결" 안내가 뜹니다.
1. Vercel 프로젝트 → **Storage** 탭 → **Create Database** → **Upstash for Redis** 선택(무료 플랜)
2. 생성 후 **Connect to Project** 로 이 프로젝트에 연결
3. 그러면 `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`(또는 `KV_REST_API_URL`/`KV_REST_API_TOKEN`)
   환경변수가 **자동 주입**됩니다. (코드가 두 이름 모두 인식)
4. **Redeploy** (Deployments → ⋯ → Redeploy)

### ④ 네이버 데이터랩 키 (선택)
없으면 네이버는 mock 으로 동작합니다. 실데이터를 원하면:
1. https://developers.naver.com → 앱 등록 → 사용 API **데이터랩(검색어트렌드)** 추가
2. 서비스 환경: **WEB** 선택, URL 에 배포 도메인 입력 (예: `https://<프로젝트>.vercel.app`)
3. Vercel → Settings → **Environment Variables** 에 추가 후 Redeploy:
   ```
   NAVER_CLIENT_ID = ...
   NAVER_CLIENT_SECRET = ...
   ```
> API 키는 **절대 코드/화면에 넣지 않습니다.** Vercel 환경변수로만 관리합니다.

### ⑤ (권장) 엔드포인트 보호키
`CRON_SECRET` 환경변수를 임의 문자열로 설정하면 `/api/collect` 등 외부 호출에 인증이 필요해집니다.
(Vercel Cron 은 이 값을 자동으로 헤더에 실어 보냅니다.)

---

## 2. 자동화 (Vercel Cron)

기본 설정은 **무료(Hobby) 플랜에서도 배포·동작**하도록 **하루 1회 단일 cron** 으로 구성했습니다.
[vercel.json](vercel.json):

| cron(UTC) | KST | 동작 (`/api/cron`) |
| --- | --- | --- |
| `10 12 * * *` | 매일 21:10 | 수집 1회 + 일일 리포트. (KST 월요일이면 주간, 매월 1일이면 월간도 자동 생성) |

> Hobby 플랜은 cron 개수·빈도(하루 1회) 제한이 있어, 위처럼 **하루 1회**로 맞췄습니다.
> 배포 시 cron 관련 에러가 나지 않습니다.

### 하루 3회(09/15/21시) 수집을 원하면
제안서의 "하루 3회"가 필요하면 둘 중 하나:
- **Pro 플랜**: [vercel.json](vercel.json) 의 cron 을 `0 0,6,12 * * *`(수집)처럼 늘리면 됩니다.
- **무료 유지 + 외부 크론**(권장): https://cron-job.org 등에서 아래 URL을 09:00/15:00/21:00(KST)에 호출:
  ```
  https://<프로젝트>.vercel.app/api/collect?force=1&key=<CRON_SECRET>
  ```
  리포트만 따로 돌리려면: `https://<프로젝트>.vercel.app/api/cron?key=<CRON_SECRET>`

> 참고: 화면의 [수집 실행] 버튼은 키 없이 동작하는 **비강제 수집**(20분 쿨다운)입니다.
> 쿨다운을 무시하는 `force=1` 수집만 `key=<CRON_SECRET>` 가 필요합니다.

수집은 과도한 요청 방지를 위해 **20분 쿨다운**이 있습니다(중복 호출 시 자동 skip). 화면의 [수집 실행] 버튼은 즉시(force) 수집합니다.

---

## 3. 화면 사용법

| 탭 | 내용 |
| --- | --- |
| ① 오늘의 트렌드 | Google Trends 키워드 + **실시간 네이버 확산 감지(블로그/카페/뉴스 신규수·상태)** + 확산상태별·콘텐츠 아이디어 + 로그 |
| ② 리포트 | 일·주·월 리포트 생성, Markdown 복사/다운로드/삭제 |
| ③ 블로그·카페 | 키워드별 블로그 확산/카페 반응 점수, 클릭 시 글 목록·콘텐츠 아이디어 |
| ④ YouTube | 한국 인기 영상(썸네일/조회수/댓글), 카테고리·반복채널, 키워드 연결 영상 |
| ⑤ 키워드 후보 | 발견 키워드 상태 변경(new/watching/ignored/added_to_naver) |
| ⑥ 스팸 분류 | 광고성 스팸 분류·관리(관찰/정식 적용, 화이트리스트, 사용자 스팸어) |
| ⑦ 장기 검색 관심도 | 네이버 데이터랩 그룹 추이(상대 검색 관심도, 보조 지표, ratio 소수점 2자리) |
| ⑧ 설정/데이터 | 수집 시간·지역·키워드 그룹·블로그카페·YouTube 설정, Trends24 수동 입력, 백업 |

### 실시간 네이버 확산 감지 (① 메인)
**네이버 데이터랩은 실시간 인기 검색어 API가 아닙니다.** 이 프로젝트는 Google Trends로 후보 키워드를
발견하고, 네이버 **블로그/카페/뉴스 검색 API의 최신순 결과**로 그 키워드가 네이버 생태계에서 퍼지는지 확인합니다.
- 키워드별 **블로그/카페/뉴스 신규 글 수**(최근 24시간, `link` 기준 새로 발견된 URL 수)
- **확산 상태** 자동 분류(색상 태그): 뉴스 주도 / 블로그 확산 / 커뮤니티 반응 / 콘텐츠화 가능 / 관찰 필요
- 행 클릭 → 상세(구글 감지정보 · 블로그/카페/뉴스 대표 제목 · 카페 질문/후기/비교/불만 신호 · 콘텐츠 아이디어)
- 데이터랩 ratio는 ⑦ **장기 검색 관심도** 탭으로 이동(보조 지표).

> 데이터 해석 주의:
> - 블로그/카페/뉴스 신규 글 수는 **검색 API로 수집한 내부 기준의 신규 URL 수**이며, 네이버 전체 게시글 수가 아닙니다.
> - 검색 API의 `total` 값을 절대 관심도처럼 쓰지 않습니다(새로 발견된 URL 수로만 계산).
> - 데이터랩 `ratio`는 **상대 검색 관심도**이며 실시간 검색어 순위가 아닙니다.

### 스팸 분류 (④ 탭)
한국 X 트렌드에는 광고성 스팸(성인서비스/연락처유도/불법금융/도박)이 섞입니다.
오탐(정상인데 스팸으로 잡힘)을 막기 위해 **분류와 제외를 분리**했습니다.
- **관찰(observe) 모드 — 기본값**: 스팸으로 *분류만* 하고 리포트에는 그대로 둡니다(데이터 손실 없음).
  ④ 탭에서 어떤 키워드가 잡히는지 한동안 지켜보세요.
- **오탐 처리**: 정상 키워드가 잡히면 **[정상으로 표시]** → 화이트리스트로 이동(항상 정상 처리).
- **사용자 스팸어 추가**: 기본 규칙이 못 잡는 스팸은 직접 단어를 추가(부분일치).
- **정식 적용(enforce) 모드**: 충분히 검토 후 전환하면 그때부터 리포트 집계에서 스팸을 제외합니다.

> 기본 규칙은 오탐을 줄이려 보수적입니다(모호한 단일 단어 제외). 규칙은 [lib/spam.js](lib/spam.js) 참고.

수집을 기다리지 않고 바로 보고 싶으면 우측 상단 **[🔄 수집 실행]** 을 누르세요.
Trends24 가 실패할 때는 ④설정의 **수동 입력**으로 키워드를 붙여넣을 수 있습니다.

---

## 4. 로컬 개발 (선택)

```bash
npm install
npm test          # 핵심 로직 통합 테스트 (네트워크/KV 불필요)
npm run dev       # vercel dev (Vercel CLI 필요: npm i -g vercel)
```
`vercel dev` 는 `.env.local` 의 환경변수를 읽습니다. KV 없이도 화면은 뜨지만 데이터 저장은 안 됩니다.

---

## 5. 파일 구조

```text
/
  index.html              대시보드(정적)
  css/style.css
  js/
    api.js                /api 호출 래퍼
    app.js                화면 렌더링(얇은 뷰)
  api/                    Vercel 서버리스 함수 (각 파일 = 엔드포인트)
    cron.js               Vercel Cron 진입점(수집+리포트, 하루 1회)
    config.js             GET/PUT 설정·키워드
    collect.js            수집(수동/외부크론, 20분 쿨다운)
    snapshots.js          GET 조회 / POST 수동 입력
    naver.js              GET 네이버 데이터랩
    candidates.js         GET / PATCH 키워드 후보
    spam.js               GET 스팸 분류현황 / POST 모드·화이트리스트·스팸어 관리
    posts.js              GET 블로그/카페 글 목록 + 키워드별 요약(summary)
    youtube.js            GET YouTube 인기영상/상위/채널/키워드연결
    reports.js            GET 목록 / POST 생성 / DELETE / (크론 generate)
    state.js              GET 전체 백업
  lib/                    공유 로직(함수가 아님, import 전용)
    store.js              KV 저장소 (snapshots/naver/blog/cafe/yt_*/reports/candidates)
    collect-service.js    수집 핵심 로직(트렌드+블로그/카페+YouTube, collect/cron 공용)
    collectors.js         Google RSS / Trends24 / 네이버 데이터랩·블로그·카페 (+mock fallback)
    youtube.js            YouTube Data API(인기영상/키워드검색, +mock fallback)
    report.js             규칙 기반 MD 리포트 (KST, generateAiSummary 자리)
    analyze.js            블로그 확산/카페 반응 분석 + 콘텐츠 아이디어(generateAiIdeas 자리)
    youtube_analyze.js    YouTube 인기흐름/키워드확산/아이디어(generateAiYoutubeIdeas 자리)
    keyword_filter.js     제외 키워드/짧은 키워드 필터
    spam.js               스팸 분류기(보수적 규칙 + 화이트리스트/사용자어)
    normalize.js scoring.js mock.js http.js
  config/ignore_keywords.json   제외 키워드 예시(참고용)
  config/youtube_stopwords.json YouTube 제목 분석 제외어(참고용)
  tests/integration.test.js
  vercel.json             Cron 스케줄
  package.json  .env.example  .gitignore
```

---

## 6. 데이터 소스별 한계 (반드시 인지)

- **Google Trends**: 공식 API 아님(RSS 기반). 값은 절대 검색량이 아니라 **상대적 검색 관심도/급상승 검색어**.
- **네이버 데이터랩**: "전체 인기검색어"가 아니라 **지정 키워드 그룹의 검색 관심도 추이**. `ratio` 는 절대 검색량 아님.
- **Trends24**: X 공식 API 아닌 **제3자 사이트**. 서버에서 `ol.trend-card__list` 를 파싱해 수집합니다.
  사이트 구조가 또 바뀌면 파싱이 실패할 수 있고, 그때는 mock 으로 대체되며 아래 보조 수집을 쓰면 됩니다.
  한국 X 트렌드에는 **광고성 스팸 키워드**(예: 만남/대출 등)가 섞여 들어올 수 있습니다 — 이는 실제 트렌드 내용입니다.

리포트 문장은 과장하지 않습니다 — "검색량 1위"가 아니라 **"수집 기준 상위 / 검색 관심도 상승 / 반복 등장 / 내부 기준 주목도"**.

---

## 7. Trends24 보조 수집 (서버 수집 실패 시)

서버 수집은 정상 동작하지만, 사이트 구조 변경 등으로 실패할 때를 대비한 두 가지 백업입니다.
(둘 다 trends24 를 정상 방문자로 읽는 방식이며, 프록시/지문위조 같은 차단 회피가 아닙니다.)

### A. 북마클릿 (설치 없음, 클릭 1번)
아래 코드를 북마크의 URL 로 저장하고, **trends24.in/korea 페이지를 연 상태에서** 클릭하면
현재 화면의 트렌드가 API 로 전송됩니다. (도메인은 본인 배포 주소로 교체)
```js
javascript:(function(){var l=document.querySelector('.trend-card__list');if(!l){alert('트렌드 목록을 찾지 못했습니다');return;}var items=[].slice.call(l.querySelectorAll('li a')).map(function(a,i){return{keyword:a.textContent.trim(),rank:i+1};}).filter(function(x){return x.keyword;});fetch('https://cookie-trend.vercel.app/api/snapshots',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:'trends24_x',region:'korea',items:items})}).then(function(r){return r.json();}).then(function(j){alert('전송: '+(j.added!=null?j.added+'건':JSON.stringify(j)));}).catch(function(e){alert('실패: '+e.message);});})();
```

### B. 로컬 스크립트 + Windows 작업 스케줄러 (완전 자동)
사용자 PC(일반 회선)에서 trends24 를 읽어 API 로 푸시합니다. → [tools/collect-trends24-local.js](tools/collect-trends24-local.js)
```bash
npm install              # cheerio 필요(최초 1회)
TREND_API=https://cookie-trend.vercel.app node tools/collect-trends24-local.js
```
**Windows 작업 스케줄러로 하루 2~3회 자동 실행**:
1. 작업 스케줄러 → 기본 작업 만들기 → 트리거: 매일, 시간 09:00/15:00/21:00(각각 작업 추가)
2. 동작: 프로그램 시작 → 프로그램 `node`, 인수 `tools\collect-trends24-local.js`, 시작 위치 = 이 프로젝트 폴더
3. (선택) 환경변수 대신 스크립트 상단 기본값(`https://cookie-trend.vercel.app`)을 그대로 써도 됩니다.

---

## 8. 네이버 블로그·카페 확산 분석

Google Trends 급상승 키워드가 **네이버 블로그(콘텐츠 생산)·카페(커뮤니티 반응)** 로
얼마나 퍼지는지 분석합니다. 수집 때 Google Trends 상위 키워드(기본 8개)로 블로그·카페 검색 API를 호출합니다.

### 사전 준비 — 네이버 검색 API 키
데이터랩과 **별개로** "검색" API 가 필요합니다. 두 가지 방법:
- **같은 앱에 추가**: https://developers.naver.com → 내 애플리케이션 → 사용 API → **검색** 추가 →
  기존 `NAVER_CLIENT_ID`/`NAVER_CLIENT_SECRET` 그대로 사용.
- **별도 앱/키 발급**(검색만 따로 만든 경우): 새 키를 Vercel 환경변수에 넣으세요.
  ```
  NAVER_SEARCH_CLIENT_ID = ...
  NAVER_SEARCH_CLIENT_SECRET = ...
  ```
  → 블로그·카페 검색은 이 키를, 데이터랩은 기존 `NAVER_CLIENT_ID`/`SECRET` 를 사용합니다.
  `NAVER_SEARCH_*` 가 비어 있으면 기존 키로 폴백합니다. 어느 쪽도 없으면 **mock** 으로 동작합니다.
  > 환경변수 추가/변경 후에는 **Redeploy** 해야 적용됩니다.

### 동작
- 수집 흐름: Google Trends 키워드 → (제외/짧은 키워드 필터) → 블로그 검색 + 카페 검색 → **link 기준 중복 제거** 저장
- 분석:
  - **블로그 확산 점수** = 신규 글 수 + 제목 반복표현 + 최근 작성일 가중치
  - **카페 반응 점수** = 신규 글 수 + 질문/후기/비교/우려 신호 수
  - **콘텐츠 아이디어**(규칙 기반) — 나중에 `generateAiIdeas()`(lib/analyze.js)에 AI 연결 가능
- ③ 블로그·카페 탭에서 키워드별 점수 표 → 행 클릭 시 글 목록·반복표현·반응 신호·아이디어
- 리포트에 **8) 블로그 확산 / 9) 카페 반응 / 10) 콘텐츠 아이디어** 섹션이 추가됩니다

### 제외 키워드
콘텐츠화하기 어려운 키워드는 ⑥설정의 **제외 키워드**(쉼표 구분)로 관리합니다.
한 글자/숫자만/특수문자만 키워드는 자동 제외됩니다. 예시: [config/ignore_keywords.json](config/ignore_keywords.json).

### 데이터 해석 주의
- Google Trends는 급상승 검색어 **후보** 제공용입니다.
- 네이버 블로그/카페 검색 결과는 **전수 데이터가 아니며**, 공개 검색 가능한 글 중심입니다.
- 블로그/카페 신규 글 수는 **내부 수집 기준의 참고 지표**입니다. 전체 관심도처럼 단정하지 않습니다.

---

## 9. YouTube 데이터 (한국 인기 영상 + 키워드 검색)

YouTube Data API v3 로 **한국 인기 영상**과 **Google Trends 키워드 검색 결과**를 수집해, 영상 흐름·콘텐츠 아이디어를 분석합니다.

### YouTube API 키 발급
1. https://console.cloud.google.com → 프로젝트 생성 → **YouTube Data API v3** 사용 설정(Enable)
2. 사용자 인증 정보 → **API 키** 만들기
3. Vercel → Settings → Environment Variables 에 추가 후 **Redeploy**:
   ```
   YOUTUBE_API_KEY = ...
   ```
   키가 없으면 YouTube는 **mock** 으로 동작합니다.

### 동작
- **한국 인기 영상**: `videos.list(chart=mostPopular, regionCode=KR, maxResults=50)` — 1회 호출(저렴, 1 unit)
- **키워드 검색**: Google Trends 상위 키워드(기본 8개)로 `search.list` → videoId 모아 `videos.list` 배치 상세조회
- 분석: 카테고리 분포 / 반복 채널 / 조회수·댓글 상위 / 제목 반복 표현 / 키워드 연결 영상 / 콘텐츠 아이디어(`generateAiYoutubeIdeas()` 자리)
- ④ YouTube 탭 + 리포트 **11) YouTube 인기 영상 흐름** 섹션에 반영

### API quota 주의
- 기본 quota는 하루 **10,000 units**. `videos.list`=1, **`search.list`=100 units**(비쌈).
- 키워드 검색 8개 = 약 800 units/회. 하루 1회 cron이면 여유롭지만, 수동 force 수집을 반복하면 빨리 소모됩니다.
- quota가 부담되면 ⑦설정에서 **키워드 검색 끄기**(인기 영상만 수집) 또는 키워드 수를 줄이세요. quota 초과 시 자동으로 mock 폴백합니다.
- stopwords: [config/youtube_stopwords.json](config/youtube_stopwords.json) (제목 반복표현 분석에서 제외할 일반어).

### 데이터 해석 주의
- 인기 영상은 **수집 시점 기준** 목록이며, 검색 결과는 전수 데이터가 아닙니다.
- 조회수·좋아요·댓글 수는 **수집 시점 스냅샷**입니다. 제목/설명은 콘텐츠 아이디어 참고용입니다.

---

## 10. 향후 확장

- [lib/report.js](lib/report.js) 의 `generateAiSummary()` 에 Claude/OpenAI API 를 연결하면 요약 품질을 높일 수 있습니다(현재 null, 규칙 기반만 사용).
- 저장 데이터가 커지면 KV 배열 통째 읽기/쓰기 대신 페이지네이션/요약 테이블 도입을 고려하세요(개인용 규모에선 충분).
