# 모음달력

**여러 모임의 일정을 한 달력에서 보고, 구성원 모두가 가능한 시간을 찾는 공유 캘린더입니다.**

모임마다 흩어진 일정을 한 화면에 모아 보고, 초대 링크나 6자리 코드로 새 구성원을 초대할 수 있습니다. 구성원은 개인 일정을 공유하고 관리자는 단체 일정을 등록합니다.

## 주요 기능

| 기능 | 사용 흐름 |
| --- | --- |
| 모아보기 | 가입한 캘린더의 일정을 홈에서 함께 확인하고, 다가오는 단체 일정에서 해당 날짜로 이동합니다. |
| 일정 등록 | 하루 종일 일정, 시간 지정 일정, 요일 반복 일정을 등록합니다. 반복 일정은 특정 회차만 건너뛸 수 있습니다. |
| 가능 시간 찾기 | 개인·단체 일정의 바쁜 시간대를 합쳐 모두가 비어 있는 날과 시간대를 표시합니다. |
| 모임 운영 | 관리자가 권한, 초대코드, 공지, 단체 일정과 참여 정원을 관리합니다. 구성원은 댓글과 메모를 남길 수 있습니다. |
| 모바일·내보내기 | 모바일에서 월간 달력과 날짜별 목록을 전환하고, 일정을 `.ics` 파일로 내보낼 수 있습니다. |

## 구현

- **프론트엔드** | React, TypeScript, Vite
- **인증·데이터** | Supabase Auth(Google OAuth), PostgreSQL, Realtime, Storage
- **배포** | Vercel

반복 일정은 반복 요일과 종료일을 포함한 한 행으로 저장하고, 화면에서 날짜별 회차로 펼칩니다. 멤버십과 관리자 권한은 PostgreSQL의 RLS(Row-Level Security)로 검사합니다. 일정 변경과 접속 상태는 Supabase Realtime으로 반영합니다.

홈, 캘린더, 멤버, 설정 화면을 필요할 때 불러오도록 분리했습니다. Vite 프로덕션 빌드의 초기 JS는 gzip 기준 **177.70KB → 141.19KB(약 21% 감소)**입니다.

## 로컬 실행

필요한 환경은 Node.js 20.19 이상인 20.x 또는 Node.js 22.12 이상입니다. 로그인과 일정 기능을 사용하려면 Supabase 프로젝트와 Google OAuth 클라이언트가 필요합니다.

1. Supabase SQL Editor에서 [전체 설치 SQL](supabase/setup.sql)을 실행합니다. 마이그레이션을 개별 적용하는 경우 [마이그레이션 디렉터리](supabase/migrations)의 파일을 이름 순서대로 적용합니다.
2. Supabase Auth에서 Google 공급자를 설정합니다. Google OAuth 클라이언트의 리디렉션 URI에는 Supabase가 제공하는 콜백 URL을 등록합니다. Supabase의 Site URL과 Redirect URLs에는 로컬 주소를 등록합니다.
3. PowerShell에서 저장소 루트 기준으로 실행합니다.

   ```powershell
   npm.cmd ci
   Copy-Item .env.example .env.local
   ```

4. `.env.local`에 `VITE_SUPABASE_URL`과 `VITE_SUPABASE_ANON_KEY`를 입력하고 `npm.cmd run dev`를 실행합니다. 브라우저에서 `http://localhost:5173`을 엽니다.

Vercel 배포 시 동일한 환경변수를 등록하고, 배포 도메인을 Google OAuth와 Supabase Auth 설정에 추가합니다.

## 검증

- `npm run typecheck`로 타입을 검사하고, `npm run build`로 프로덕션 빌드를 생성합니다.
- [권한 테스트 SQL](supabase/tests/permissions.test.sql)은 설치가 끝난 테스트 DB에서 멤버 접근 권한, RLS, 계정 삭제 동작을 확인합니다.
