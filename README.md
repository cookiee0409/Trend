# 트렌드 자동 수집 · 리포트 도구 (Vercel 배포판)

개인용 트렌드 수집·리포트 도구입니다. **GitHub 에 올리고 Vercel 에 연결하면** 별도 서버 없이
서버리스 함수 + KV(Upstash Redis)로 동작하며, **매일 자동으로 트렌드를 수집하고 리포트를 생성**합니다.

수집 대상:
1. **Google Trends** (Trending Now RSS)
2. **네이버 데이터랩** (지정 키워드 그룹의 검색 관심도)
3. **Trends24** 한국 X/Twitter 트렌드

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
| ① 오늘의 트렌드 | 오늘 수집된 Google/Trends24/네이버 상승 그룹/새 키워드 + 로그 |
| ② 리포트 | 일·주·월 리포트 생성, Markdown 복사/다운로드/삭제 |
| ③ 키워드 후보 | 발견 키워드 상태 변경(new/watching/ignored/added_to_naver) |
| ④ 설정/데이터 | 수집 시간·지역·키워드 그룹 편집, Trends24 수동 입력, 백업 |

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
    reports.js            GET 목록 / POST 생성 / DELETE / (크론 generate)
    state.js              GET 전체 백업
  lib/                    공유 로직(함수가 아님, import 전용)
    store.js              Upstash Redis(KV) 저장소 (4개 테이블)
    collect-service.js    수집 핵심 로직(collect/cron 공용)
    collectors.js         Google RSS / Trends24 HTML / 네이버 API (+mock fallback)
    report.js             규칙 기반 MD 리포트 (KST, generateAiSummary 자리)
    normalize.js scoring.js mock.js http.js
  tests/integration.test.js
  vercel.json             Cron 스케줄
  package.json  .env.example  .gitignore
```

---

## 6. 데이터 소스별 한계 (반드시 인지)

- **Google Trends**: 공식 API 아님(RSS 기반). 값은 절대 검색량이 아니라 **상대적 검색 관심도/급상승 검색어**.
- **네이버 데이터랩**: "전체 인기검색어"가 아니라 **지정 키워드 그룹의 검색 관심도 추이**. `ratio` 는 절대 검색량 아님.
- **Trends24**: X 공식 API 아닌 **제3자 사이트**이며 **봇 차단**이 있습니다. 특히 Vercel 같은 데이터센터 IP에는
  트렌드가 없는 차단 페이지를 응답하는 경우가 많아, 서버 자동 수집은 자주 **mock 으로 대체**됩니다.
  제안서 원칙(우회·차단 회피 금지)에 따라 이를 우회하지 않습니다. 실데이터가 필요하면 ④설정의
  **Trends24 수동 입력**에 trends24.in/korea 의 키워드를 붙여넣으세요. (Google Trends·네이버는 서버에서 정상 수집됩니다.)

리포트 문장은 과장하지 않습니다 — "검색량 1위"가 아니라 **"수집 기준 상위 / 검색 관심도 상승 / 반복 등장 / 내부 기준 주목도"**.

---

## 7. 향후 확장

- [lib/report.js](lib/report.js) 의 `generateAiSummary()` 에 Claude/OpenAI API 를 연결하면 요약 품질을 높일 수 있습니다(현재 null, 규칙 기반만 사용).
- 저장 데이터가 커지면 KV 배열 통째 읽기/쓰기 대신 페이지네이션/요약 테이블 도입을 고려하세요(개인용 규모에선 충분).
