-- =====================================================================
-- 002. Row Level Security
--  - 이용자: 같은 캘린더 조회 + 본인 일정(개인) 추가/수정/삭제
--  - 관리자: 캘린더 안의 모든 일정 수정/삭제, 단체 일정 등록, 멤버 관리
--  - 캘린더 생성/참여는 RPC(003) 전용 (insert 정책 없음)
-- =====================================================================
alter table public.profiles         enable row level security;
alter table public.calendars        enable row level security;
alter table public.calendar_members enable row level security;
alter table public.events           enable row level security;

-- 헬퍼: SECURITY DEFINER 라 RLS 재귀 없이 멤버십을 판단
create or replace function public.is_member(cal uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from calendar_members where calendar_id = cal and user_id = auth.uid()
  );
$$;

create or replace function public.is_admin(cal uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from calendar_members
    where calendar_id = cal and user_id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.shares_calendar_with(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from calendar_members a
    join calendar_members b on a.calendar_id = b.calendar_id
    where a.user_id = auth.uid() and b.user_id = other
  );
$$;

-- ---------------------------------------------------------------------
-- profiles : 본인 + 같은 캘린더 멤버만 조회, 수정은 본인 닉네임/색만
-- ---------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_calendar_with(id));
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (nickname, color) on public.profiles to authenticated;

-- ---------------------------------------------------------------------
-- calendars : 멤버만 조회, 관리자만 이름/강조색 변경·삭제
-- ---------------------------------------------------------------------
drop policy if exists calendars_select on public.calendars;
create policy calendars_select on public.calendars for select to authenticated
  using (public.is_member(id));
drop policy if exists calendars_update on public.calendars;
create policy calendars_update on public.calendars for update to authenticated
  using (public.is_admin(id)) with check (public.is_admin(id));
drop policy if exists calendars_delete on public.calendars;
create policy calendars_delete on public.calendars for delete to authenticated
  using (public.is_admin(id));

revoke insert, update on public.calendars from anon, authenticated;
grant update (name, group_color) on public.calendars to authenticated;

-- ---------------------------------------------------------------------
-- calendar_members : 멤버만 조회, 관리자만 역할 변경·추방, 본인은 나가기
-- ---------------------------------------------------------------------
drop policy if exists members_select on public.calendar_members;
create policy members_select on public.calendar_members for select to authenticated
  using (public.is_member(calendar_id));
drop policy if exists members_update on public.calendar_members;
create policy members_update on public.calendar_members for update to authenticated
  using (public.is_admin(calendar_id)) with check (public.is_admin(calendar_id));
drop policy if exists members_delete on public.calendar_members;
create policy members_delete on public.calendar_members for delete to authenticated
  using (public.is_admin(calendar_id) or user_id = auth.uid());

revoke insert, update on public.calendar_members from anon, authenticated;
grant update (role) on public.calendar_members to authenticated;

-- ---------------------------------------------------------------------
-- events
-- ---------------------------------------------------------------------
drop policy if exists events_select on public.events;
create policy events_select on public.events for select to authenticated
  using (public.is_member(calendar_id));

drop policy if exists events_insert on public.events;
create policy events_insert on public.events for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.is_member(calendar_id)
    and (not is_group or public.is_admin(calendar_id))     -- 단체 일정은 관리자만
  );

drop policy if exists events_update on public.events;
create policy events_update on public.events for update to authenticated
  using (author_id = auth.uid() or public.is_admin(calendar_id))
  with check (
    (author_id = auth.uid() or public.is_admin(calendar_id))
    and (not is_group or public.is_admin(calendar_id))
  );

drop policy if exists events_delete on public.events;
create policy events_delete on public.events for delete to authenticated
  using (author_id = auth.uid() or public.is_admin(calendar_id));

-- 작성자/캘린더는 바꿀 수 없도록 컬럼 단위로 update 허용
revoke update on public.events from anon, authenticated;
grant update (title, memo, is_group, start_date, end_date, start_time, end_time)
  on public.events to authenticated;
