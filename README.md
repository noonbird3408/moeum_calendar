# 모음달력

링크 하나로 함께 쓰는 공유 월간 캘린더 **모음달력**입니다. 내가 속한 모든 캘린더를 메인 화면 한 달력에 합쳐 볼 수도 있습니다. 별도 백엔드 서버 없이 **React(Vite) + Supabase(Auth·DB·Realtime·Storage)** 만으로 동작합니다.

- 구글 로그인, 최초 1회 프로필(닉네임·프로필 사진·퍼스널 컬러) 설정
- 캘린더 생성 → 링크(`/join/코드`)나 6자리 초대코드로 공유
- 관리자/이용자 권한 분리, 멤버 추방 시 그 멤버의 일정 자동 삭제
- **메인 화면**: 창 너비에 맞춰 늘고 줄어드는 레이아웃. 왼쪽 내 캘린더 칩과 그 아래 **다가오는 단체 일정**(D-day, 누르면 해당 캘린더·날짜로 이동) · 가운데 모음달력(달 표시와 일정 추가는 달력 바로 위) · 오른쪽 프로필 카드, 내 캘린더(그 안의 `초대코드로 참여` 버튼을 누르면 입력 칸이 열림)
- **캘린더 화면**: 왼쪽 가능한 날(한 줄에 한 날짜)과 다가오는 단체 일정 · 가운데 달력, 그 아래 메모 탭(멤버 모두가 보는 메모 목록, + 로 새 메모, 작성자·작성 시간 표시) · 오른쪽 **캘린더 탭**(이름·설명·초대코드, 관리 시트), 멤버 목록, 내 일정, 공지사항
- **캘린더 탭 관리 시트**: 이름·강조색, 초대 링크·재발급, 멤버 목록, 이 캘린더 일정 .ics 내보내기, 나가기·삭제
- **공지사항**: 관리자만 작성. 누르면 게시글처럼 열리고(작성자·시각·본문·링크 미리보기), 전체 일정 하나를 태그하면 그 일정으로 바로 이동
- **일정 추가**: `날짜` 버튼을 누르면 요일 반복과 달력이 펼쳐짐. 날짜를 하나씩 눌러 고르거나, 끌어서 여러 날, 한 날짜를 누른 채 다른 날짜를 우클릭(또는 Shift+클릭)하면 사이 전체 선택. 하루종일은 이어진 날짜마다 한 일정, 시간 일정은 고른 날마다 한 일정
- **전체 일정**: 사진 최대 4장(멤버만 볼 수 있는 비공개 저장소), 참여 정원(정원이 차면 관리자만 추가 가능), 댓글 수정·삭제·답글
- 일정 추가는 **날짜 선택** 또는 **요일 반복**(예: 매주 월·수) 중 선택. 요일 반복은 한 행으로 저장되고 화면에서만 회차로 펼쳐집니다.
- 개인 일정과 **전체(단체) 일정**을 분리해 작성 (단체 일정은 관리자만)
- 개인 일정: 달력에서 시작·종료 날짜를 차례로 눌러 기간 선택, 요일 탭을 누르면 매주 반복, `하루종일` 칩으로 시간 입력 끄기
- 전체 일정: 게시글처럼 제목 + 설명 작성, 설명의 외부 링크는 본문 아래에 미리보기. 관리자는 멤버를 참여자로 추가할 수 있고, 참여자에게 개인 일정이 겹치면 저장이 막힙니다
- 공지사항: 캘린더마다 내 일정 아래 탭 (관리자 작성·수정·삭제, 실시간 반영). 글씨 크기·굵게·기울임·밑줄·형광펜·글자색·링크 서식, 본문 속 링크는 아래에 미리보기
- 멤버 목록: 나 → 관리자 → 나머지 순, 5명을 넘으면 `+N more` 로 전체 보기
- 전체(단체) 일정이 있는 날은 달력에서 캘린더 색 띠로 강조
- 메인 화면의 일정 추가는 개인 일정만 (전체 일정은 각 캘린더 화면에서)
- 요일 반복은 날짜를 고르지 않아도 됨 (기본: 오늘부터 1년, `기간 설정`으로 변경)
- 내 일정 패널: 정기 일정 우선, 지난 일정 제외, 4개 이상이면 `…` 표시 → `전체 보기`에서 일괄 선택 삭제
- 단체 일정: 제목·설명·외부 링크 미리보기·참여 멤버·댓글 (v0.4 에서 리치 서식 제거. v0.3 에서 만든 리치 본문은 더 이상 표시되지 않습니다)
- 모바일: 간략 달력(단체 일정 + `+N`) / 날짜별 아코디언 목록 뷰 전환
- 가능한 날: 하루종일 / 특정 시간대 탭으로 나눠 보기 (예: `19시 이전 / 21시 이후`), 달력 강조 온/오프, 강조 색은 설정에서 변경
- 실시간 반영 (Realtime), 접속 상태 점 (Presence)
- 설정: 다크/라이트, 글자 크기·글꼴, 주 시작 요일, 모바일 기본 보기, 내 일정 `.ics` 내보내기, 로그아웃, 계정 삭제, 버그 신고(메일)

---

## 1. 준비물

- Node.js 20 이상 (https://nodejs.org)
- Supabase 계정 (무료) — https://supabase.com
- Google Cloud 계정 (OAuth 클라이언트 발급용)

## 2. Supabase 설정 (약 10분)

1. **프로젝트 생성**: Supabase → New project (리전: Northeast Asia (Seoul) 권장).
2. **DB 설치**: 왼쪽 메뉴 **SQL Editor → New query** 에 `supabase/setup.sql` 내용을 전부 붙여넣고 **Run**.
   - 같은 내용이 `supabase/migrations/` 에 12개 파일로도 나뉘어 있습니다 (Supabase CLI 사용 시 순서대로 실행).
   - `setup.sql` 은 여러 번 실행해도 안전합니다. `relation already exists` 같은 오류가 나지 않도록 모든 구문이 멱등하게 작성되어 있습니다.
   - **이미 설치한 프로젝트를 올릴 때**는 `setup.sql` 전체를 다시 실행하면 됩니다(멱등). 새 파일만 실행하려면 v0.4 `…07_notices_admin_participants.sql`, v0.5 `…08_notice_rich.sql`, v0.6 `…09_v06.sql`, v0.7 `…10_notice_event_tag.sql`, v0.8 `…11_security_hardening.sql`, `…12_occurrence_exceptions.sql`, 메모 탭 `20261015000001_memos.sql`, 일정 추가 권한 오류 수정 `20261021000001_fix_event_dates_grant.sql` 을 순서대로 실행하세요.
     - v0.8: 권한 정리(anon 차단·TRUNCATE 회수·내부 함수 실행 금지), 값 검사, 사용량·도배 제한, 접속 표시 비공개 채널 정책
     - v0.7: 공지사항에 전체 일정 태그(`announcements.event_id`, 같은 캘린더의 전체 일정만), 공지의 캘린더·작성자 변경 차단
     - v0.6: 캘린더 설명·헤더 모양, 댓글 수정·답글, 전체 일정 사진(비공개 `event-images` 버킷)·참여 정원, 공용·개인 메모, 초대코드 대입 방지, 프로필 사진 저장소 제한
     - v0.5: 공지사항 서식 본문 컬럼(`announcements.body_html`, 20,000자 제한). 화면에서는 허용된 태그·스타일만 남겨서 그립니다.
   - v0.4 에서 추가되는 것:
     - 캘린더별 공지사항 테이블(`announcements`)과 RLS (멤버는 읽기, 관리자만 작성·수정·삭제)
     - 관리자가 멤버를 단체 일정 참여자로 추가·제거할 수 있는 정책 (`event_participants`)

     - 프로필 사진 저장소(`avatars` 공개 버킷)와 본인 폴더 전용 업로드·삭제 정책
     - 단체 일정 참여(`event_participants`)·댓글(`event_comments`) 테이블과 RLS
     - 요일 반복 컬럼(`repeat_weekdays`, `repeat_until`, `excluded_dates`), 링크(`link_url`), 리치 본문(`body_rich`)
     - 최근 사용 색(`profiles.recent_colors`)
     - 계정 삭제 함수 `delete_my_account()`
3. **API 키 복사**: Project Settings → API (또는 API Keys) 에서 `Project URL` 과 `anon`(또는 `publishable`) 키를 복사합니다.
   - `service_role` / `secret` 키는 절대 프론트엔드에 넣지 마세요.

## 3. Google 로그인 설정 (약 15분)

1. https://console.cloud.google.com → 새 프로젝트 → **APIs & Services → OAuth consent screen**
   - User type: External, 앱 이름·지원 이메일 입력, 범위는 기본(`openid`, `email`, `profile`)만.
2. **Credentials → Create credentials → OAuth client ID → Web application**
   - Authorized JavaScript origins: `http://localhost:5173`, `https://<배포 도메인>`
   - Authorized redirect URIs: `https://<project-ref>.supabase.co/auth/v1/callback`
     (Supabase → Authentication → Sign In / Providers → Google 화면에 표시된 Callback URL 을 그대로 복사)
3. Supabase → **Authentication → Sign In / Providers → Google** → Enable, Client ID / Client Secret 붙여넣기 → Save.
4. Supabase → **Authentication → URL Configuration**
   - Site URL: `https://<배포 도메인>` (개발 중엔 `http://localhost:5173`)
   - Redirect URLs 에 추가: `http://localhost:5173/**`, `https://<배포 도메인>/**`
5. 테스트 단계에서는 OAuth 동의 화면이 *Testing* 상태라 **등록한 테스트 사용자만** 로그인됩니다. 친구들에게 공개하기 전에 **Publish app** 을 눌러 프로덕션으로 전환하세요.

## 4. 로컬 실행

```bash
npm install
cp .env.example .env.local     # Windows: copy .env.example .env.local
# .env.local 에 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY 입력
npm run dev
```

브라우저에서 http://localhost:5173 을 엽니다. 휴대폰으로 확인하려면 `npm run dev -- --host` 후 같은 Wi-Fi 에서 PC 의 IP:5173 으로 접속하세요 (단, 구글 로그인은 위에 등록한 주소에서만 동작).

## 5. 배포 (Vercel, 무료)

1. 이 폴더를 GitHub 저장소에 올립니다.
2. https://vercel.com → Add New → Project → 저장소 선택 (Framework: Vite 자동 인식).
3. Environment Variables 에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` 추가 → Deploy.
4. 배포 도메인을 **Google OAuth origins** 와 **Supabase Redirect URLs / Site URL** 에 추가합니다 (2·3단계).
5. `vercel.json` 이 모든 경로를 `index.html` 로 보내므로 `/join/AB12CD` 같은 링크를 바로 열 수 있습니다.

## 6. 사용 흐름

1. 링크 접속 → 구글 로그인 → (처음이면) 닉네임·사진·색 설정 → 메인 화면
2. 홈에서 **새 캘린더 만들기** → 캘린더의 **공유** 버튼으로 링크/코드 전달
3. 받은 사람은 링크만 누르면 로그인 후 **자동 참여**
4. 메인 화면의 **일정 추가** 는 고른 캘린더마다 같은 일정을 한 번에 넣습니다. 캘린더 화면에서 추가한 일정도 메인에 그대로 보입니다.
5. 관리자는 **멤버** 화면에서 관리자 지정/해제, 내보내기, 초대코드 재발급, 캘린더 이름·강조색 변경, 삭제

## 7. 권한 규칙 (DB 의 RLS 가 강제)

| 동작 | 관리자 | 이용자 |
| --- | --- | --- |
| 일정·멤버 보기 | O | O |
| 개인 일정 등록, 본인 일정 수정·삭제 | O | O |
| 단체 일정 등록 | O | X |
| 다른 사람 일정 수정·삭제 | O | X |
| 단체 일정 참여·댓글 (참여 멤버 등록, 본인 댓글 삭제) | O | O |
| 멤버 내보내기(일정도 삭제), 관리자 지정 | O | X |
| 초대코드 재발급, 캘린더 이름·색 변경·삭제 | O | X |
| 캘린더 나가기 | O (마지막 관리자는 불가) | O |

## 8. 계정 삭제 동작

설정 → **계정 삭제** (확인 칸에 `삭제` 입력) 를 하면 `delete_my_account()` 가 다음을 처리합니다.

1. 참여한 **모든 캘린더에서 자동으로 나갑니다.**
2. 내가 작성한 **일정은 모두 삭제**되고, 단체 일정의 참여·댓글도 함께 지워집니다.
3. 내가 관리자였던 캘린더는 가장 먼저 들어온 다른 관리자(없으면 이용자) 에게 관리자 권한을 넘깁니다. 캘린더 소유자 표시도 함께 넘깁니다.
4. 멤버가 나 혼자였던 캘린더는 캘린더와 그 일정까지 삭제합니다.
5. 프로필 사진 파일은 앱이 먼저 Storage 에서 지우고, 마지막에 인증 계정을 삭제합니다.
6. 이 기기의 세션을 끊고 **로그인 화면**으로 돌아갑니다. 다시 접속하면 로그인부터 다시 해야 합니다.

## 9. 폴더 구조

```text
supabase/
  setup.sql                 한 번에 설치하는 SQL (migrations 001~012 합본)
  migrations/               001 스키마 · 002 RLS · 003 RPC · 004 Realtime · 005 정기 일정 · 006 v0.3(사진·참여·댓글·요일 반복·계정 삭제) · 007 v0.4(공지사항·참여자 관리 정책) · 008 v0.5(공지 서식 본문) · 009 v0.6(캘린더 탭·댓글·사진·정원·메모·보안) · 010 v0.7(공지 일정 태그) · 011 v0.8(보안 보강) · 012 반복 회차 예외 · 20261015000001 메모 탭(멤버 공용 메모 목록) · 20261021000001 일정 추가 권한 오류 수정
  tests/permissions.test.sql  권한·RLS·계정 삭제 검증 (로컬 Postgres 에서 실행, 마지막 줄 ALL TESTS PASSED)
src/
  App.tsx                   라우트 + 로그인/프로필 관문
  lib/                      supabase 클라이언트, 라우터, 날짜 유틸, 화면 설정, 반복 펼치기(recurrence),
                            리치 텍스트(rich), 링크 미리보기(links), 사진 업로드(avatar),
                            .ics 내보내기(ics), 계정 삭제·내보내기(account)
  auth/                     로그인, 온보딩, 프로필 폼
  calendars/                메인(모음달력·내 캘린더·초대코드), 참여(/join/:code), 공유 시트
  calendar/                 월간 그리드, 모바일 달력/목록, 일정 폼·상세·하루 시트, 단체 일정 댓글/참여,
                            다가오는 단체 일정, 데이터·실시간 훅
  availability/             가능 날짜 계산(computeAvailability) + 칩 UI
  members/                  멤버 관리
  settings/                 설정(프로필·화면·데이터·버그 신고·로그아웃·계정 삭제)
  ui/                       시트(모달), 토스트·확인창, 공통 컨트롤, 아바타, 색 선택, 아이콘
  styles.css, features.css  기본 테마·레이아웃
  features2.css             v0.4 메인·캘린더 반응형 레이아웃, 가능한 날 탭, 공지사항, 내 일정 패널, 날짜 범위 선택, 강조 색 설정 등
```

## 10. 참고

- 시간은 모든 사용자가 한국 시간을 쓴다는 전제로 `date` + `time` 으로 저장합니다. 시간을 정하지 않으면 하루종일 일정입니다.
- 요일 반복 일정은 DB 에 한 행(첫 날 ~ 반복 종료일, 요일 목록)으로 저장하고, 화면에서 해당 요일마다 하루짜리 회차로 펼칩니다. 날짜 선택기에서 반복 회차를 우클릭하거나 길게 눌러 해당 날짜만 제외할 수 있고, 일정 상세의 제외 날짜 목록에서 다시 포함할 수 있습니다.
- 카카오톡·인스타그램 앱 안의 브라우저는 구글 로그인을 막기 때문에, 로그인 화면에서 외부 브라우저로 여는 버튼을 보여줍니다.
- 모두 가능한 날짜 계산 기준은 활동 09~24시, 최소 2시간 빈 시간으로 고정되어 있습니다(필터 기능 없음). 반복 일정도 계산에 포함됩니다.
- 단체 일정 링크 미리보기는 유튜브·X 만 제목·썸네일을 가져옵니다. 다른 사이트는 주소 카드만 보여줍니다(별도 서버가 없어 임의 사이트의 메타 정보를 가져올 수 없습니다).
- 접속 상태(초록 점)는 Supabase Realtime Presence 로 계산하며, 캘린더를 열어 둔 멤버만 표시됩니다.
- 버그 신고는 기기의 메일 앱으로 `deleu1134@gmail.com` 에 보내집니다.


---

## 보안 (v0.8 점검 반영)

### 코드·DB 에 들어 있는 것
- **권한은 DB 가 최종 판단**: 모든 테이블 RLS, 컬럼 단위 수정 권한(작성자·캘린더·작성 시각 등은 못 바꿈). `supabase/tests/permissions.test.sql` 로 검증합니다.
- **로그인하지 않은 요청(anon)** 은 어떤 테이블·함수도 쓸 수 없고, 로그인 사용자도 RLS 를 거치지 않는 권한(TRUNCATE 등)과 내부용 함수 실행 권한은 없습니다.
- **사용량 제한**: 캘린더 50개/사람, 멤버 300명/캘린더, 참여 100개/사람, 일정 3000개/사람·캘린더, 댓글 1000개/일정, 공지 500개/캘린더. 1분 안에 일정 200개·댓글 20개·공지 10개를 넘게 쓰면 잠시 막습니다(도배 방지).
- **초대코드 대입 방지**: 15분 동안 틀린 코드 10번이면 잠시 막습니다.
- **접속 표시(Presence)** 는 비공개 채널 `presence:<캘린더 id>` 를 쓰고, DB 정책으로 같은 캘린더 멤버만 듣고 보낼 수 있습니다.
- **사진**: 전체 일정 사진은 비공개 버킷 + 1시간 서명 URL, 올리기 전 다시 저장해 위치정보(EXIF) 제거. 프로필 사진은 1MB·이미지 형식만, 다른 사람 폴더 목록 조회 불가, 화면에는 우리 저장소·구글 사진 주소만 그립니다.
- **본문 서식**: 공지 HTML 은 허용한 태그·스타일만 남겨 그리고, 링크는 http(s) 만 + `noopener noreferrer nofollow`.
- **링크 미리보기** 요청에는 우리 주소(캘린더 id)·쿠키를 보내지 않습니다.
- **주소 검사**: 캘린더 id 는 UUID, 초대코드는 6자리만 받고, 로그인 뒤 돌아갈 주소는 이 사이트 안의 경로만 허용합니다.
- **로그아웃** 하면 이 기기에 남긴 마지막 캘린더 기록 등을 지웁니다.
- **보안 헤더**: `vercel.json` 에 CSP·X-Frame-Options·HSTS·Referrer-Policy·Permissions-Policy·COOP. Supabase 를 **사용자 지정 도메인**으로 쓰면 CSP 의 `*.supabase.co` 를 그 도메인으로 바꿔 주세요.

### Supabase·Google 대시보드에서 직접 확인할 것 (코드로는 못 바꿈)
1. **Authentication → Providers**: Google 만 켜고 Email(비밀번호)·Anonymous 로그인은 끄기.
2. **Authentication → URL Configuration**: Site URL 을 실제 배포 주소로, Redirect URLs 에는 `https://내도메인/**` 처럼 내 도메인만 (다른 도메인·`*` 하나만 쓰는 와일드카드 금지).
3. **Google Cloud OAuth 동의 화면**: 범위는 `email`, `profile`, `openid` 만.
4. **API 키**: 프론트엔드에는 anon/publishable 키만. `service_role`/secret 키는 어디에도 올리지 말고, `.env.local` 은 git 에 올리지 않기(.gitignore 에 포함).
5. **Realtime → Settings**: "Allow public access" 는 켠 채로 두세요. 일정·공지 실시간 반영은 일반 채널을 쓰지만 내용은 RLS 로 보호되고, 접속 표시는 비공개 채널이라 정책이 적용됩니다.
6. Supabase·Vercel·GitHub·Google 계정에 2단계 인증을 켜 두세요.

### 남은 한계
- 프로필 사진은 공개 버킷이라 주소를 아는 사람은 볼 수 있습니다. 파일 이름을 무작위로 바꿔 주소를 짐작할 수는 없게 했습니다.
- 브라우저에 로그인 토큰이 저장되므로(Supabase 기본), XSS 가 생기면 위험합니다. 그래서 HTML 정리와 CSP 를 함께 둡니다.
