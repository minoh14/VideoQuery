# VideoQuery — 시스템 명세서 (v1.0)

> **VideoQuery**: TwelveLabs API/SDK 기반. 사용자가 영상을 업로드·삭제하고, 자연어로 영상 내용을 검색·분석할 수 있는 웹 시스템.

### 확정된 결정 사항
- **제품명**: **VideoQuery**. (상표·도메인 충돌은 실제 발생 시점에 대응하기로 함.)
- **백엔드/스택**: Node.js (API Routes, 단일 코드베이스). API 키는 서버 사이드에만 보관.
- **인증**: v1은 단일 사용자용 BYOK 연결 방식. TwelveLabs API 키는 로그인 시 서버 메모리 세션에만 저장하고, 브라우저에는 `HttpOnly` 세션 쿠키만 보관.
- **인덱스 구조**: **프로젝트 = TwelveLabs 인덱스 1개**. 사용자는 프로젝트를 여러 개 만들고, 검색/분석은 선택한 프로젝트 범위에서 동작.
- **모델**: 검색 = **Marengo 3.0**(인덱스에 활성화, 인덱싱 필요). 분석 = **Pegasus 1.5**(호출별 온더플라이, 사전 인덱싱 불필요).
- **업로드 방식**: **공개 URL 업로드와 로컬 파일 업로드**를 지원한다. URL 업로드는 TwelveLabs에 URL을 전달하고, 로컬 파일은 청크 단위로 서버에 전송한 뒤 TwelveLabs Multipart Upload API로 스트리밍한다.
- **상태 추적**: 앱 DB 캐시를 두지 않고, **매번 TwelveLabs에 실시간 조회**.
- **분석 응답**: **논스트리밍(단건 반환)만** 지원. 실시간 스트리밍은 제외.
- **검색 결과 재생**: **인라인 재생**(별도 상세 페이지 없음). 클립을 결과 영역 안에서 `start` 지점부터 재생.

---

## 1. 개요

### 1.1 목적
웹 브라우저에서 영상을 업로드하고, 업로드된 영상에 대해 자연어로 질의(검색/분석)하며, 필요 없는 영상을 삭제할 수 있는 시스템을 만든다. 영상 이해 기능은 TwelveLabs 플랫폼에 위임한다.

### 1.2 범위 (v1)
- **필수**: 프로젝트 생성/선택, 영상 업로드, 영상 목록 조회, 영상 삭제, 자연어 쿼리(검색 + 분석)
- **단일 사용자**: 별도 계정·권한 시스템은 없으며, 유효한 TwelveLabs API 키로 서버 세션을 생성한다.
- **비범위 (이후 고려)**: 사용자 인증/멀티테넌시, 임베딩 기반 커스텀 검색, 영상 편집, 다국어 UI

### 1.3 핵심 외부 의존성
TwelveLabs 플랫폼. Python 또는 Node.js SDK, 혹은 REST API(`https://api.twelvelabs.io/v1.3`)로 접근.

---

## 2. 도메인 개념 (TwelveLabs 모델)

| 개념                              | 설명                                                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Index (인덱스)**                | 영상을 담는 컨테이너. 어떤 모델을 사용할지 생성 시 지정한다.                                                                                    |
| **Asset (자산)**                  | 업로드된 원본 콘텐츠. 한 번 만들면 재업로드 없이 여러 작업에 재사용 가능.                                                                       |
| **Indexed Asset (인덱싱된 자산)** | 자산을 인덱싱해서 검색·분석에 쓸 수 있게 된 상태. UI상 "영상"에 해당.                                                                           |
| **Model**                         | `marengo3.0` = 검색(any-to-video search). `pegasus1.5` = 분석/텍스트 생성 + 영상 세그멘테이션(현재 버전). `pegasus1.2`는 일반 분석 전용 구버전. |

> 참고 1: 예전 `task.create`(업로드+인덱싱 통합) 방식은 향후 제거 예정. 신규 구현은 **자산 생성 → 인덱싱**의 분리 워크플로우를 사용한다.
> 참고 2: **Pegasus 1.5는 사전 인덱싱이 필요 없다.** URL·자산·base64를 직접 대상으로 분석하므로, 분석 경로는 Marengo 인덱싱 완료를 기다리지 않는다. Marengo 3.0 인덱싱은 **검색 기능에만** 필요하다.

---

## 3. 기능 요구사항

### FR-1. 영상 업로드
- 사용자는 **공개 URL 또는 로컬 파일**로 영상을 추가할 수 있다.
  - 공개 URL: 사용자가 입력한 URL을 백엔드가 TwelveLabs 자산으로 등록한다.
  - 로컬 파일: 브라우저가 파일을 청크로 나누어 백엔드에 전송하고, 백엔드가 각 청크를 TwelveLabs Multipart Upload 세션으로 전달한다. 여러 파일을 선택하면 파일별 업로드 세션을 수행한다.
- 업로드 후 인덱싱은 비동기로 진행되며, UI는 진행 상태(`uploading → indexing → ready / failed`)를 표시한다.
- 제약:
  - 공개 URL: 최대 4GB. 원본 미디어 직링크만 지원(호스팅 플랫폼/클라우드 공유 링크 불가).
  - 로컬 파일: 청크 업로드 방식이며 파일 1개당 최대 10GB. 브라우저에서 비디오/오디오 파일을 선택할 수 있고, 청크 전송률을 표시한다.
  - URL·로컬 파일 모두 자산 처리와 인덱싱은 비동기로 진행되며, 인덱싱 전에 자산 상태(`ready`) 확인이 필요하다.

### FR-2. 영상 목록 조회
- 인덱스에 속한 영상 목록을 조회한다(제목, 썸네일, 길이, 상태, 생성일).
- 상태별 필터 및 제목 검색을 제공한다.

### FR-3. 영상 삭제
- 사용자는 특정 영상을 삭제할 수 있다. 되돌릴 수 없으므로 확인 절차를 둔다.
- 신규 방식: **Delete an indexed asset** 사용. (레거시 `DELETE /indexes/{index-id}/videos/{video-id}`는 지원 종료 예정)

### FR-4. 자연어 쿼리
두 가지 질의 모드를 제공한다.

- **검색 (Search)**: 특정 장면이 "어디에" 나오는지 찾기. `marengo3.0` 사용.
  - 입력: 자연어 텍스트(최대 500토큰), 검색 옵션(`visual`, `audio`, `transcription`).
  - 출력: 매칭된 클립 목록 — `video_id`, `rank`(1=가장 관련), `start`/`end`(초).
- **분석 (Analyze)**: 영상 내용을 "설명/요약/질의응답". `pegasus1.5` 사용 (`analysis_mode="general"`).
  - 입력: 대상(자산 ID / URL / base64) + 프롬프트(최대 2,000토큰). 참조 이미지 최대 4개(`prompt_v2`의 `<@name>` 플레이스홀더)로 멀티모달 프롬프트 가능.
  - 출력: 생성 텍스트(Pegasus 1.5 최대 약 98,304토큰). **v1은 논스트리밍(완성 결과 단건 반환)만 지원**하며, 실시간 스트리밍은 제외.
  - **사전 인덱싱 불필요** — 자산이 준비되면 인덱싱 대기 없이 바로 분석.
- **(선택) 구조화 추출 (TBM)**: Pegasus 1.5의 Time-Based Metadata Extraction. JSON 스키마를 정의하면 최대 2시간 영상에서 타임스탬프가 붙은 구조화 메타데이터(세그먼트, 화자 전환, 로고 등장 등)를 한 번의 호출로 반환. v1 포함 여부는 열린 사항.

---

## 4. 시스템 아키텍처

```
[브라우저 / HTTPS]
        │
        ▼
[백엔드 API 서버]  ← TwelveLabs API 키는 여기서만 보관
        │  (TwelveLabs SDK)
        ▼
[TwelveLabs 플랫폼]  (Index / Asset / Indexed Asset)
```

**핵심 원칙**: TwelveLabs API 키는 로그인 요청에서 서버로 전달된 뒤 서버 메모리 세션에만 보관한다. 브라우저 저장소에는 키를 남기지 않으며, 이후 요청은 `HttpOnly`, `SameSite=Strict` 세션 쿠키로 인증한다. 모든 TwelveLabs 호출은 백엔드를 경유한다.

**확정 스택**:
- 프론트엔드 + 백엔드: **Vanilla JavaScript** (API Routes). 프론트·백엔드가 한 언어·한 코드베이스.
- TwelveLabs 접근: 공식 Node.js SDK (`twelvelabs-js`)를 API Routes에서 호출.
- 상태 추적: 앱 DB 캐시 없이 **매번 TwelveLabs에 실시간 조회**. 프론트는 백엔드 상태 엔드포인트를 폴링하고, 백엔드는 그 요청마다 TwelveLabs를 조회해 결과를 그대로 전달(패스스루).

**프로젝트 ↔ 인덱스 매핑**: 앱의 "프로젝트" 1개 = TwelveLabs 인덱스 1개. 사용자는 항상 하나의 활성 프로젝트를 선택한 상태로 업로드/검색/분석한다.

### 4.1 프로젝트 디렉토리 구조

```
VideoQuery/
├── .env.example              # 환경변수 템플릿 (PORT, 세션 설정)
├── .gitignore
├── package.json
├── server.js                 # Express 진입점, 미들웨어, 정적 파일 서빙, 에러 핸들링
├── lib/
│   ├── twelvelabs-client.js  # TwelvelabsApiClient 생성
│   └── session-store.js      # API 키를 보관하는 서버 메모리 세션
├── routes/
│   ├── auth.js               # 로그인, 세션 확인, 로그아웃
│   ├── projects.js           # POST /api/projects, GET /api/projects
│   ├── videos.js             # POST/GET/DELETE /api/videos, GET /api/videos/:id/status
│   ├── search.js             # POST /api/search
│   └── analyze.js            # POST /api/analyze
└── public/                   # 프론트엔드 (정적 파일, Express가 서빙)
    ├── index.html            # SPA 진입점 (프로젝트 목록 / 워크스페이스 뷰)
    ├── style.css             # 다크 테마 UI 스타일
    └── app.js                # 클라이언트 로직 (API 호출, 라우팅, 폴링)
```

- **런타임**: Node.js + Express (Vanilla JavaScript, CommonJS)
- **SDK**: `twelvelabs-js` (TwelvelabsApiClient)
- **DB 없음**: 모든 상태는 TwelveLabs API 실시간 조회

---

## 5. 데이터 모델

**상태·영상 정보는 앱에 캐시하지 않고 매번 TwelveLabs에서 실시간으로 가져온다.** 따라서 영상용 로컬 테이블은 두지 않는다. 프로젝트 목록도 TwelveLabs 인덱스 목록을 그대로 조회해 쓰므로, 앱 DB는 없거나 최소한으로 유지할 수 있다.

- **프로젝트 = TwelveLabs 인덱스**: 인덱스 목록/이름/ID를 TwelveLabs에서 직접 조회. 별도 저장 불필요.
- **영상**: 인덱스별 영상 목록·상태·썸네일·길이를 요청 시점마다 TwelveLabs 조회로 획득(패스스루).

> 트레이드오프: 구현이 단순하고 항상 최신 상태를 보장하지만, 화면 진입/폴링마다 TwelveLabs 호출이 발생한다. 레이트 리밋과 지연에 유의하고, 필요 시 짧은 TTL의 인메모리 캐시로 완화할 수 있다(선택).

(만약 이후 로컬 저장이 필요해지면 `Project{tl_index_id, name}` / `Video{tl_indexed_asset_id, tl_asset_id, ...}` 형태로 확장 가능.)

---

## 6. 백엔드 API ↔ TwelveLabs SDK 매핑

앱 백엔드가 노출할 엔드포인트와, 내부에서 호출하는 SDK 메서드(메서드명은 Node.js/Python 공통 구조).

| 앱 엔드포인트                  | 설명                         | TwelveLabs SDK 호출                                                                                                                    |
| ------------------------------ | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/login`         | API 키 검증 및 서버 세션 생성 | `client.indexes.list(...)`로 키 검증 후 `HttpOnly` 쿠키 발급                                                                           |
| `GET /api/auth/session`        | 현재 세션 확인                | 외부 호출 없음                                                                                                                         |
| `POST /api/auth/logout`        | 서버 세션 삭제                | 외부 호출 없음                                                                                                                         |
| `POST /api/projects`           | 프로젝트 생성(= 인덱스 생성) | `client.indexes.create(index_name, models=[{marengo3.0}])` (검색용. Pegasus는 인덱스에 넣지 않고 호출별로 사용)                        |
| `GET  /api/projects`           | 프로젝트 목록                | 인덱스 목록 조회(실시간)                                                                                                               |
| `POST /api/videos`             | 공개 URL 영상 업로드 시작    | `client.assets.create(method="url", url=...)`                                                                                          |
| `POST /api/videos/multipart/init`    | 로컬 파일 Multipart 세션 생성 | `client.multipartUpload.create({filename, type, totalSize})`                                                                       |
| `POST /api/videos/multipart/chunk`   | 로컬 파일 청크 스트리밍 프록시 | 브라우저 청크를 TwelveLabs presigned URL로 스트리밍 PUT                                                                          |
| `POST /api/videos/multipart/report`  | 업로드 청크 완료 보고        | `client.multipartUpload.reportChunkBatch(upload_id, {completedChunks})`                                                          |
| `POST /api/videos/upload`      | 기존 소형 로컬 파일 업로드(레거시) | `client.assets.create(method="direct", file=..., filename=...)`                                                               |
| `GET  /api/videos/{id}/status` | 상태 확인(실시간)            | `client.assets.retrieve(asset_id)` → `client.indexes.indexed_assets.retrieve(index_id, indexed_asset_id)`                              |
| `GET  /api/videos`             | 영상 목록(실시간)            | 인덱스별 영상 목록 조회                                                                                                                |
| `DELETE /api/videos/{id}`      | 영상 삭제                    | Delete an indexed asset (+ 필요 시 asset 삭제)                                                                                         |
| `POST /api/search`             | 자연어 검색                  | `client.search.query(index_id, query_text, search_options)`                                                                            |
| `POST /api/analyze`            | 영상 분석(논스트리밍)        | `client.analyze(...)` — `model_name="pegasus1.5"`, `analysis_mode="general"`, 대상 = 자산/URL. (스트리밍 `analyze_stream`은 v1 미사용) |

---

## 7. 주요 플로우

### 7.1 업로드 & 인덱싱 (비동기, URL 또는 파일 입력)
```
1. (초기 1회) 인덱스 생성: marengo3.0 활성화 (검색용)
2. 입력 방식에 따라 자산 생성:
   ├─ URL:  client.assets.create(method="url", url=...) → asset_id
   └─ 파일: multipartUpload.create(...) → 청크 업로드/완료 보고 → asset_id
3. 로컬 파일은 브라우저가 파일을 청크로 나누고, 서버가 각 청크를 TwelveLabs presigned URL로 스트리밍한다. 서버는 전체 파일을 메모리나 영구 저장소에 보관하지 않는다.
4. 자산 상태 확인: assets.retrieve 로 status == "ready" 까지 폴링
   └ 여기까지 완료되면 → Pegasus 1.5 분석은 바로 가능 (인덱싱 대기 불필요)
5. (검색을 쓰려면) 인덱싱 요청: client.indexes.indexed_assets.create(index_id, asset_id) → indexed_asset_id
6. 인덱싱 모니터링:  indexed_assets.retrieve 로 status == "ready" 까지 폴링
7. 완료 → 검색 가능
```
상태 폴링은 앱 캐시 없이 매 호출 TwelveLabs를 조회한다.
UI 상태 표시: `uploading → (asset ready: 분석 가능) → indexing → ready(검색 가능) / failed`

### 7.2 쿼리
```
검색(Marengo):  query_text + search_options → 클립 리스트(video_id, rank, start, end)
                → UI에서 해당 구간을 타임스탬프로 표시/재생  [인덱싱 완료 필요]
분석(Pegasus 1.5):  asset_id/URL + prompt → 생성 텍스트(요약/QA 등)  [인덱싱 불필요]
```

### 7.3 삭제
```
확인 모달 → indexed asset 삭제 → (선택) 원본 asset 삭제 → 목록 재조회(TwelveLabs 실시간)
```

---

## 8. 화면 설계

### 8.1 정보 구조
로그인이 없고 작업이 프로젝트 범위에 갇히므로 화면 전환을 최소화한다. 주요 면은 두 개(**프로젝트 목록 → 워크스페이스**)이고, 나머지는 모달로 처리한다.

```
프로젝트 목록 ──선택──▶ 워크스페이스 ──(모달)──▶ URL/파일로 영상 추가 / 삭제 확인
```

### 8.2 화면 1 — 프로젝트 목록 (진입)
- 프로젝트(= TwelveLabs 인덱스) 카드 그리드. 카드마다 이름·영상 수·최근 활동을 표시.
- 상태 실시간 조회이므로, 인덱싱 진행 중인 영상이 있으면 카드에 힌트 배지(예: "1개 인덱싱 중")를 노출.
- 상단에 "새 프로젝트"(= 인덱스 생성)와 프로젝트 검색/필터.
- 카드 클릭 → 해당 프로젝트 워크스페이스로 진입.

### 8.3 화면 2 — 프로젝트 워크스페이스 (핵심)
3분할 레이아웃:
- **좌측 사이드바 — 영상 목록**: 항목마다 제목 + 상태 배지(8.4 참조). 클릭 시 인라인 플레이어로 재생.
- **상단 — 쿼리 바**: `검색 / 질문(분석)` 토글 + 입력창 + 실행. 모드에 따라 결과 영역 렌더링이 바뀐다.
- **본문 — 결과 영역**:
  - 검색: 클립 카드(썸네일 + `시작–끝` 타임스탬프). 클릭하면 인라인 플레이어로 해당 구간을 그 자리에서 재생(8.6 참조).
  - 질문(분석): 논스트리밍이므로 로딩 표시 후 완성된 답변 텍스트를 한 번에 표시.
- 상단 우측: "영상 추가" 액션. 모달에서 URL 입력 또는 로컬 파일 선택 방식을 고른다.

### 8.4 상태 배지 규칙
TwelveLabs 상태를 UI 배지로 매핑한다. 자산이 준비되면 분석은 가능하고, 인덱싱까지 끝나야 검색이 가능하다는 점을 두 단계로 구분한다.

| 배지                  | 조건 (TwelveLabs)                   | 가능한 작업                    |
| --------------------- | ----------------------------------- | ------------------------------ |
| 업로드 중             | 자산 처리 중(대용량)                | 대기                           |
| 인덱싱 중 · 분석 가능 | asset `ready`, indexed asset 미완료 | 분석(Pegasus) 가능, 검색 불가  |
| 검색 가능             | indexed asset `ready`               | 검색(Marengo) + 분석 모두 가능 |
| 실패                  | asset/indexing `failed`             | 재시도 안내                    |

### 8.5 모달
- **영상 추가**: URL 탭에서는 공개 URL(+ 선택적 제목)을 입력하고, 파일 탭에서는 하나 이상의 로컬 비디오/오디오 파일을 선택한다. 추가된 영상은 목록에 표시되고 상태 폴링을 시작한다.
- **삭제 확인**: 되돌릴 수 없음을 경고 → 확인 시 indexed asset(및 필요 시 asset) 삭제 → 목록 재조회.

### 8.6 검색 결과 재생 (인라인)
검색 결과 클립은 **별도 상세 페이지 없이 결과 영역 안에서 인라인 재생**한다. 클립을 열면 해당 `start` 지점부터 재생되며, 목록/결과 맥락을 벗어나지 않는다.

### 8.7 상태 갱신
앱 캐시 없이 폴링으로 TwelveLabs를 실시간 조회한다. 목록·배지는 짧은 간격으로 갱신하고, 폴링 중임을 은근하게 표시한다.

---

## 9. 비기능 요구사항

### 9.1 보안
- TwelveLabs API 키는 로그인 요청 직후 서버 메모리 세션에만 보관하고 브라우저 저장소에는 남기지 않는다.
- 세션 쿠키는 `HttpOnly`, `SameSite=Strict`를 적용하며 운영 환경에서는 `Secure`를 강제한다.
- 삭제 등 파괴적 작업은 확인 절차 필수.

### 9.2 에러 처리
SDK 예외를 앱 응답 코드로 매핑한다.

| SDK 예외                 | HTTP |
| ------------------------ | ---- |
| BadRequestError          | 400  |
| AuthenticationError      | 401  |
| PermissionDeniedError    | 403  |
| NotFoundError            | 404  |
| ConflictError            | 409  |
| UnprocessableEntityError | 422  |
| RateLimitError           | 429  |
| InternalServerError      | 5xx  |

- 업로드/인덱싱 API는 레이트 리밋이 있으므로 재시도(backoff) 전략 필요.

### 9.3 제약 요약
- 검색은 **단일 인덱스 내에서만** 수행. 여러 인덱스 교차 검색 불가, 영상 단위 검색 불가.
- 업로드는 공개 URL 또는 로컬 파일을 지원한다. 공개 URL은 최대 4GB, 로컬 파일은 청크 기반 Multipart Upload로 파일 1개당 최대 10GB까지 지원한다. 서버는 전체 파일을 메모리에 올리지 않는다(위 FR-1 참조). Pegasus 1.5 분석 대상 영상은 최대 2시간.
- 검색 쿼리 500토큰 / 분석 프롬프트 2,000토큰 / 분석 출력 Pegasus 1.5 최대 약 98,304토큰.
- 검색은 인덱싱 완료가 전제. 분석은 자산만 준비되면 가능(인덱싱 불필요).

---

## 10. 결정 사항 & 남은 열린 사항

### 결정됨
- ~~인덱스 구조~~ → **프로젝트 = 인덱스 1개**
- ~~계정/멀티유저~~ → **v1 단일 사용자, API 키 기반 서버 세션만 사용**
- ~~백엔드 언어~~ → **Node.js (Node.js SDK)**
- ~~분석 모델~~ → **Pegasus 1.5 (온더플라이, 인덱싱 불필요)**; 검색 = Marengo 3.0
- ~~업로드 방식~~ → **공개 URL 및 로컬 파일 업로드** (로컬 파일은 청크 기반 Multipart Upload, 파일 1개당 최대 10GB)
- ~~상태 추적 방식~~ → **앱 캐시 없이 매번 TwelveLabs 실시간 조회**
- ~~분석 스트리밍~~ → **논스트리밍만; 실시간 스트리밍 v1 제외**
- ~~검색 결과 재생 UX~~ → **인라인 재생**(별도 상세 페이지 없음)

### 아직 열린 사항
1. **TBM(구조화 추출) 포함 여부**: Pegasus 1.5의 JSON 스키마 기반 타임스탬프 메타데이터 추출을 v1 기능으로 노출할지.
2. **분석 인덱싱 정책**: 분석이 인덱싱 불필요하므로, "검색을 안 쓸 영상"은 인덱싱을 건너뛰고 자산만 유지할지(비용/시간 절감) 결정 필요.

> 구현 착수 전 확인: Pegasus 1.5 analyze의 정확한 Node.js SDK 메서드 시그니처(`model_name`/`analysis_mode`/대상 파라미터, 스트리밍 형태)는 최신 SDK 레퍼런스로 검증할 것.
