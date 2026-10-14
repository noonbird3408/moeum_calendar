-- 005 : 정기 일정 표시 플래그
-- 반복 규칙(매주/매달 등)을 자동 전개하지 않고, 작성자가 '정기 일정'으로 표시만 한다.
-- 작성자 본인(또는 관리자)만 바꿀 수 있도록 기존 컬럼 단위 update 권한에 포함한다.

alter table public.events add column if not exists is_recurring boolean not null default false;

revoke update on public.events from anon, authenticated;
grant update (title, memo, is_group, is_recurring, start_date, end_date, start_time, end_time)
  on public.events to authenticated;
