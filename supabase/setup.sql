-- =====================================================================
-- 모음달력: 전체 설치 SQL (migrations 를 순서대로 합친 파일)
-- Supabase 대시보드 > SQL Editor > New query 에 전부 붙여넣고 Run 하세요.
-- 여러 번 실행해도 안전합니다(이미 있는 테이블·정책·트리거는 건너뛰거나 다시 만듭니다).
-- =====================================================================

-- ---- 20261013000001_schema.sql ----
-- =====================================================================
-- 001. 스키마: profiles / calendars / calendar_members / events
-- Supabase 대시보드 > SQL Editor 에 001 → 004 순서대로 붙여넣어 실행하세요.
-- (한 번에 실행하려면 supabase/setup.sql 을 사용)
-- =====================================================================

-- 1) profiles : 구글 계정 1개 = 프로필 1개 (auth.users 와 1:1)
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nickname    text check (char_length(nickname) between 1 and 12),
  color       text not null default '#8E8E93' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on column public.profiles.nickname is 'null 이면 온보딩(프로필 설정) 미완료';

-- 2) calendars : 공유 캘린더 방
create table if not exists public.calendars (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 1 and 30),
  invite_code  text not null unique check (invite_code ~ '^[A-Z2-9]{6}$'),
  group_color  text not null default '#FF6B35' check (group_color ~ '^#[0-9A-Fa-f]{6}$'),
  owner_id     uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now()
);

-- 3) calendar_members : 소속과 역할
create table if not exists public.calendar_members (
  calendar_id  uuid not null references public.calendars(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  role         text not null default 'member' check (role in ('admin', 'member')),
  joined_at    timestamptz not null default now(),
  primary key (calendar_id, user_id)
);
create index if not exists calendar_members_user_idx on public.calendar_members (user_id);

-- 4) events : 일정
create table if not exists public.events (
  id           uuid primary key default gen_random_uuid(),
  calendar_id  uuid not null,
  author_id    uuid not null,
  title        text not null check (char_length(title) between 1 and 40),
  memo         text check (char_length(memo) <= 500),
  is_group     boolean not null default false,
  start_date   date not null,
  end_date     date not null,
  start_time   time,              -- null = 종일
  end_time     time,              -- '24:00' 허용 (자정까지)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- 멤버가 추방/탈퇴하면 그 캘린더에 쓴 그 사람의 일정도 자동 삭제
  constraint events_author_member_fk foreign key (calendar_id, author_id)
    references public.calendar_members (calendar_id, user_id) on delete cascade,
  constraint events_date_order check (end_date >= start_date),
  constraint events_time_pair check ((start_time is null) = (end_time is null)),
  constraint events_time_order check (start_time is null or end_date > start_date or end_time > start_time),
  constraint events_max_span check (end_date - start_date <= 62)
);
create index if not exists events_calendar_start_idx on public.events (calendar_id, start_date);
create index if not exists events_calendar_end_idx   on public.events (calendar_id, end_date);
create index if not exists events_author_idx         on public.events (calendar_id, author_id);

-- updated_at 자동 갱신
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_events_touch on public.events;
create trigger trg_events_touch before update on public.events
  for each row execute function public.touch_updated_at();

-- 구글 최초 로그인 시 프로필 행 자동 생성 (닉네임은 온보딩에서 입력)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, avatar_url)
  values (new.id, new.raw_user_meta_data ->> 'avatar_url')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 마지막 관리자는 강등·탈퇴·추방 불가 (캘린더 삭제로 인한 연쇄 삭제는 허용)
create or replace function public.guard_last_admin() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.role = 'admin'
     and (tg_op = 'DELETE' or new.role <> 'admin')
     and exists (select 1 from public.calendars where id = old.calendar_id)
     and not exists (
       select 1 from public.calendar_members
       where calendar_id = old.calendar_id and role = 'admin' and user_id <> old.user_id
     ) then
    raise exception 'LAST_ADMIN' using hint = '다른 멤버를 관리자로 지정한 뒤 다시 시도하세요.';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_guard_last_admin on public.calendar_members;
create trigger trg_guard_last_admin before update or delete on public.calendar_members
  for each row execute function public.guard_last_admin();

-- ---- 20261013000002_rls.sql ----
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

-- ---- 20261013000003_rpc.sql ----
-- =====================================================================
-- 003. RPC (supabase.rpc 로 호출)
--  create_calendar / preview_calendar / join_calendar / regenerate_invite_code
-- =====================================================================

-- 6자리 초대코드: 헷갈리는 0/O, 1/I 를 뺀 32자 (32^6 ≈ 10.7억 조합)
create or replace function public.gen_invite_code() returns text
language plpgsql volatile set search_path = public as $$
declare
  chars text  := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  -- gen_random_uuid() 는 암호학적 난수 기반, 앞 6바이트는 버전 비트가 없는 순수 난수
  b     bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  code  text  := '';
begin
  for i in 0..5 loop
    code := code || substr(chars, 1 + (get_byte(b, i) % 32), 1);
  end loop;
  return code;
end $$;

-- 캘린더 만들기: 캘린더 + 만든 사람을 admin 으로 등록 (한 트랜잭션)
create or replace function public.create_calendar(p_name text, p_color text default '#FF6B35')
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (select 1 from profiles where id = auth.uid() and nickname is not null) then
    raise exception 'PROFILE_REQUIRED';
  end if;

  loop
    begin
      insert into calendars (name, group_color, invite_code, owner_id)
      values (trim(p_name), coalesce(p_color, '#FF6B35'), gen_invite_code(), auth.uid())
      returning id into v_id;
      exit;
    exception when unique_violation then
      -- 초대코드 충돌 시 재시도
    end;
  end loop;

  insert into calendar_members (calendar_id, user_id, role) values (v_id, auth.uid(), 'admin');
  return v_id;
end $$;

-- 참여 전 미리보기 (멤버가 아니어도 이름·인원만 확인 가능)
create or replace function public.preview_calendar(p_code text)
returns table (id uuid, name text, group_color text, member_count bigint, already_member boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.group_color,
         (select count(*) from calendar_members m where m.calendar_id = c.id),
         exists (select 1 from calendar_members m where m.calendar_id = c.id and m.user_id = auth.uid())
  from calendars c
  where auth.uid() is not null and c.invite_code = upper(trim(p_code));
$$;

-- 초대코드로 참여 (이미 멤버면 그대로 통과)
create or replace function public.join_calendar(p_code text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (select 1 from profiles where id = auth.uid() and nickname is not null) then
    raise exception 'PROFILE_REQUIRED';
  end if;

  select id into v_id from calendars where invite_code = upper(trim(p_code));
  if v_id is null then raise exception 'INVALID_CODE'; end if;

  insert into calendar_members (calendar_id, user_id) values (v_id, auth.uid())
  on conflict do nothing;
  return v_id;
end $$;

-- 초대코드 재발급 (관리자만, 기존 링크 무효화)
create or replace function public.regenerate_invite_code(p_calendar uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
begin
  if not public.is_admin(p_calendar) then raise exception 'FORBIDDEN'; end if;
  loop
    begin
      update calendars set invite_code = gen_invite_code() where id = p_calendar
      returning invite_code into v_code;
      exit;
    exception when unique_violation then
    end;
  end loop;
  return v_code;
end $$;

-- 실행 권한: 로그인 사용자만
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.create_calendar(text, text),
  public.preview_calendar(text),
  public.join_calendar(text),
  public.regenerate_invite_code(uuid),
  public.is_member(uuid),
  public.is_admin(uuid),
  public.shares_calendar_with(uuid)
to authenticated;

-- ---- 20261013000004_realtime.sql ----
-- =====================================================================
-- 004. Realtime : 캘린더·일정·멤버·프로필 변경을 구독할 수 있게 publication 에 추가
--  (RLS 가 적용되므로 같은 캘린더 멤버에게만 전달됩니다)
-- =====================================================================
do $$ begin
  alter publication supabase_realtime add table public.calendars, public.events, public.calendar_members, public.profiles;
exception when duplicate_object then null;
end $$;

-- ---- 20261013000005_recurring.sql ----
-- 005 : 정기 일정 표시 플래그
-- 반복 규칙(매주/매달 등)을 자동 전개하지 않고, 작성자가 '정기 일정'으로 표시만 한다.
-- 작성자 본인(또는 관리자)만 바꿀 수 있도록 기존 컬럼 단위 update 권한에 포함한다.

alter table public.events add column if not exists is_recurring boolean not null default false;

revoke update on public.events from anon, authenticated;
grant update (title, memo, is_group, is_recurring, start_date, end_date, start_time, end_time)
  on public.events to authenticated;

-- ---- 20261013000006_v3.sql ----
-- =====================================================================
-- 006 : v0.3 — 프로필 사진·최근 색, 반복(요일) 일정, 단체 일정 상세(본문·링크·참여·댓글),
--       계정 삭제 RPC.  모든 구문은 여러 번 실행해도 안전합니다(멱등).
-- =====================================================================

-- ---------------------------------------------------------------------
-- profiles : 최근 사용 색상 (+ 버튼으로 다시 고를 수 있게 저장)
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists recent_colors text[] not null default '{}';

revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (nickname, color, avatar_url, recent_colors) on public.profiles to authenticated;

-- ---------------------------------------------------------------------
-- events : 반복 요일, 반복 종료일, 링크, 리치 본문
--   · 반복 일정(repeat_weekdays 있음): start_date = 첫 날, end_date = repeat_until, 하루짜리 회차가 요일마다 생긴다
--     개인 일정과 전체(단체) 일정 모두 요일 반복을 쓸 수 있다
--   · 단체 일정은 반복하지 않는다
-- ---------------------------------------------------------------------
alter table public.events add column if not exists repeat_weekdays smallint[];
alter table public.events add column if not exists repeat_until date;
alter table public.events add column if not exists excluded_dates date[] not null default '{}';
alter table public.events add column if not exists link_url text;
alter table public.events add column if not exists body_rich jsonb;

alter table public.events drop constraint if exists events_max_span;
alter table public.events add constraint events_max_span check (end_date - start_date <= 400);

alter table public.events drop constraint if exists events_repeat_rule;
alter table public.events add constraint events_repeat_rule check (
  repeat_weekdays is null
  or (
    repeat_until is not null
    and repeat_until >= start_date
    and cardinality(repeat_weekdays) between 1 and 7
    and repeat_weekdays <@ array[0,1,2,3,4,5,6]::smallint[]
  )
);

alter table public.events drop constraint if exists events_link_len;
alter table public.events add constraint events_link_len check (link_url is null or char_length(link_url) <= 500);

revoke update on public.events from anon, authenticated;
grant update (title, memo, is_group, is_recurring, start_date, end_date, start_time, end_time,
              repeat_weekdays, repeat_until, excluded_dates, link_url, body_rich)
  on public.events to authenticated;

-- ---------------------------------------------------------------------
-- event_participants : 단체 일정 참여 멤버
-- event_comments     : 단체 일정 댓글
-- ---------------------------------------------------------------------
create table if not exists public.event_participants (
  event_id   uuid not null references public.events(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table if not exists public.event_comments (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  author_id  uuid not null references public.profiles(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists event_comments_event_idx on public.event_comments (event_id, created_at);

alter table public.event_participants enable row level security;
alter table public.event_comments     enable row level security;

drop policy if exists participants_select on public.event_participants;
create policy participants_select on public.event_participants for select to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and public.is_member(e.calendar_id)));

drop policy if exists participants_insert on public.event_participants;
create policy participants_insert on public.event_participants for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.events e where e.id = event_id and e.is_group and public.is_member(e.calendar_id))
  );

drop policy if exists participants_delete on public.event_participants;
create policy participants_delete on public.event_participants for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists comments_select on public.event_comments;
create policy comments_select on public.event_comments for select to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and public.is_member(e.calendar_id)));

drop policy if exists comments_insert on public.event_comments;
create policy comments_insert on public.event_comments for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (select 1 from public.events e where e.id = event_id and public.is_member(e.calendar_id))
  );

drop policy if exists comments_delete on public.event_comments;
create policy comments_delete on public.event_comments for delete to authenticated
  using (
    author_id = auth.uid()
    or exists (select 1 from public.events e where e.id = event_id and public.is_admin(e.calendar_id))
  );

-- 실시간 반영
do $$ begin
  alter publication supabase_realtime add table public.event_participants, public.event_comments;
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------
-- 프로필 사진 저장소 (공개 읽기, 본인 폴더(<uid>/...)만 쓰기)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true)
  on conflict (id) do nothing;

drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'avatars');

drop policy if exists avatars_insert on storage.objects;
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_update on storage.objects;
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_delete on storage.objects;
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------
-- 계정 삭제
--  1) 내가 유일한 관리자인 캘린더: 다른 멤버가 있으면 가장 먼저 들어온 사람에게 관리자·소유권 넘김, 없으면 캘린더 삭제
--  2) 내 멤버십 삭제 → 그 캘린더에서 내가 쓴 일정·댓글·참여 기록도 함께 삭제(FK cascade)
--  3) auth 사용자 삭제 → 프로필 삭제
--  프로필 사진 파일은 클라이언트가 Storage API 로 먼저 지운다(SQL 로 storage 를 직접 지우는 것은 막혀 있음)
-- ---------------------------------------------------------------------
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
declare
  uid uuid := auth.uid();
  c record;
  nxt uuid;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  for c in select calendar_id from public.calendar_members where user_id = uid loop
    select user_id into nxt
      from public.calendar_members
     where calendar_id = c.calendar_id and user_id <> uid
     order by (role = 'admin') desc, joined_at
     limit 1;

    if nxt is null then
      -- 혼자 남은 캘린더는 함께 사라진다
      delete from public.calendars where id = c.calendar_id;
    else
      if not exists (
        select 1 from public.calendar_members
         where calendar_id = c.calendar_id and role = 'admin' and user_id <> uid
      ) then
        update public.calendar_members set role = 'admin'
         where calendar_id = c.calendar_id and user_id = nxt;
      end if;
      update public.calendars set owner_id = nxt
       where id = c.calendar_id and owner_id = uid;
    end if;
  end loop;

  delete from public.calendar_members where user_id = uid;
  delete from auth.users where id = uid;
end $$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---- 20261013000007_notices_admin_participants.sql ----
-- =====================================================================
-- 007. v0.4 : 캘린더 공지사항 · 관리자가 단체 일정 참여 멤버를 지정
-- 여러 번 실행해도 안전합니다(멱등).
-- =====================================================================

-- 1) 공지사항: 모든 멤버가 읽고, 관리자만 작성·수정·삭제
create table if not exists public.announcements (
  id          uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references public.calendars(id) on delete cascade,
  author_id   uuid not null references public.profiles(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 60),
  body        text not null default '' check (char_length(body) <= 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists announcements_calendar_idx on public.announcements (calendar_id, created_at desc);

drop trigger if exists announcements_touch on public.announcements;
create trigger announcements_touch before update on public.announcements
  for each row execute function public.touch_updated_at();

alter table public.announcements enable row level security;

drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements for select to authenticated
  using (public.is_member(calendar_id));

drop policy if exists announcements_insert on public.announcements;
create policy announcements_insert on public.announcements for insert to authenticated
  with check (author_id = auth.uid() and public.is_admin(calendar_id));

drop policy if exists announcements_update on public.announcements;
create policy announcements_update on public.announcements for update to authenticated
  using (public.is_admin(calendar_id))
  with check (public.is_admin(calendar_id));

drop policy if exists announcements_delete on public.announcements;
create policy announcements_delete on public.announcements for delete to authenticated
  using (public.is_admin(calendar_id));

grant select, insert, update, delete on public.announcements to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.announcements;
exception when duplicate_object then null;
end $$;

-- 2) 단체 일정 참여 멤버: 관리자는 같은 캘린더의 멤버를 지정·해제할 수 있다 (기존 '본인 참여' 규칙은 그대로)
drop policy if exists participants_admin_insert on public.event_participants;
create policy participants_admin_insert on public.event_participants for insert to authenticated
  with check (
    exists (
      select 1 from public.events e
      where e.id = event_id and e.is_group and public.is_admin(e.calendar_id)
    )
    and exists (
      select 1 from public.events e
      join public.calendar_members m on m.calendar_id = e.calendar_id
      where e.id = event_id and m.user_id = event_participants.user_id
    )
  );

drop policy if exists participants_admin_delete on public.event_participants;
create policy participants_admin_delete on public.event_participants for delete to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and public.is_admin(e.calendar_id)));

-- ---- 20261013000008_notice_rich.sql ----
-- =====================================================================
-- 008. v0.5 : 공지사항 서식 본문
--   · body_html : 글씨 크기·굵기·기울기·밑줄·형광펜·색·링크가 들어간 본문 (HTML)
--   · body      : 같은 내용의 일반 텍스트 (목록 미리보기·검색용)
--   화면에 보여 줄 때는 프론트엔드가 허용된 태그·스타일만 남기고 나머지는 지운다.
-- 여러 번 실행해도 안전합니다(멱등).
-- =====================================================================

alter table public.announcements add column if not exists body_html text;

alter table public.announcements drop constraint if exists announcements_body_html_len;
alter table public.announcements add constraint announcements_body_html_len
  check (body_html is null or char_length(body_html) <= 20000);

-- ---- 20261013000009_v06.sql ----
-- =====================================================================
-- 009. v0.6 : 캘린더 탭(설명·헤더), 댓글 수정·대댓글, 전체 일정 사진·참여 정원,
--             공용·개인 메모, 보안 보강(초대코드 대입 방지, 사진 저장소 제한)
-- 여러 번 실행해도 안전합니다(멱등).
-- =====================================================================

-- 문자열 → uuid (형식이 틀리면 null). Storage 경로의 폴더 이름을 안전하게 바꿀 때 쓴다
create or replace function public.try_uuid(t text) returns uuid
language plpgsql immutable set search_path = public as $$
begin
  return t::uuid;
exception when others then
  return null;
end $$;

-- ---------------------------------------------------------------------
-- 1) calendars : 설명(헤더 아래 한 줄), 헤더 모양
-- ---------------------------------------------------------------------
alter table public.calendars add column if not exists description text not null default '';
alter table public.calendars add column if not exists header_style text not null default 'plain';

alter table public.calendars drop constraint if exists calendars_description_len;
alter table public.calendars add constraint calendars_description_len check (char_length(description) <= 200);
alter table public.calendars drop constraint if exists calendars_header_style;
alter table public.calendars add constraint calendars_header_style check (header_style in ('plain', 'color'));

revoke update on public.calendars from anon, authenticated;
grant update (name, group_color, description, header_style) on public.calendars to authenticated;

-- ---------------------------------------------------------------------
-- 2) 댓글 : 수정(본인만) · 대댓글(한 단계)
-- ---------------------------------------------------------------------
alter table public.event_comments add column if not exists parent_id uuid references public.event_comments(id) on delete cascade;
alter table public.event_comments add column if not exists updated_at timestamptz;
create index if not exists event_comments_parent_idx on public.event_comments (parent_id);

-- 답글은 같은 일정의 '원 댓글'에만 달 수 있다. 수정할 때 작성자·일정·부모는 바뀌지 않는다
create or replace function public.check_comment() returns trigger
language plpgsql set search_path = public as $$
declare
  p record;
begin
  if tg_op = 'UPDATE' then
    if new.event_id <> old.event_id or new.author_id <> old.author_id
       or new.parent_id is distinct from old.parent_id or new.created_at <> old.created_at then
      raise exception 'FORBIDDEN';
    end if;
    new.updated_at := now();
    return new;
  end if;
  if new.parent_id is not null then
    select event_id, parent_id into p from public.event_comments where id = new.parent_id;
    if not found or p.event_id <> new.event_id or p.parent_id is not null then
      raise exception 'BAD_PARENT';
    end if;
  end if;
  new.updated_at := null;
  return new;
end $$;

drop trigger if exists trg_check_comment on public.event_comments;
create trigger trg_check_comment before insert or update on public.event_comments
  for each row execute function public.check_comment();

drop policy if exists comments_update on public.event_comments;
create policy comments_update on public.event_comments for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

revoke update on public.event_comments from anon, authenticated;
grant update (body) on public.event_comments to authenticated;

-- ---------------------------------------------------------------------
-- 3) events : 전체 일정 사진(최대 4장) · 참여 정원
--    사진 경로는 '<calendar_id>/<uuid>.jpg' 형식만 허용 (다른 캘린더의 사진을 끌어올 수 없게)
-- ---------------------------------------------------------------------
-- 전체 일정 설명은 2000자까지 (개인 메모는 화면에서 500자로 제한)
alter table public.events drop constraint if exists events_memo_check;
alter table public.events drop constraint if exists events_memo_len;
alter table public.events add constraint events_memo_len check (memo is null or char_length(memo) <= 2000);

alter table public.events add column if not exists image_paths text[] not null default '{}';
alter table public.events add column if not exists max_participants integer;

create or replace function public.event_images_ok(paths text[], cal uuid) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(cardinality(paths), 0) <= 4
     and coalesce(bool_and(p ~ ('^' || cal::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$')), true)
  from unnest(paths) as p;
$$;

alter table public.events drop constraint if exists events_images_ok;
alter table public.events add constraint events_images_ok check (public.event_images_ok(image_paths, calendar_id));
alter table public.events drop constraint if exists events_max_participants;
alter table public.events add constraint events_max_participants
  check (max_participants is null or max_participants between 1 and 1000);
alter table public.events drop constraint if exists events_group_only_extras;
alter table public.events add constraint events_group_only_extras
  check (is_group or (cardinality(image_paths) = 0 and max_participants is null));

revoke update on public.events from anon, authenticated;
grant update (title, memo, is_group, is_recurring, start_date, end_date, start_time, end_time,
              repeat_weekdays, repeat_until, excluded_dates, link_url, body_rich, image_paths, max_participants)
  on public.events to authenticated;

-- 정원이 찬 일정에는 관리자만 더 넣을 수 있다 (동시에 눌러도 넘치지 않도록 일정 행을 잠근다)
create or replace function public.check_capacity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_cal uuid;
  v_max integer;
begin
  select calendar_id, max_participants into v_cal, v_max from events where id = new.event_id for update;
  if v_max is not null and not public.is_admin(v_cal)
     and (select count(*) from event_participants where event_id = new.event_id) >= v_max then
    raise exception 'EVENT_FULL';
  end if;
  return new;
end $$;

drop trigger if exists trg_check_capacity on public.event_participants;
create trigger trg_check_capacity before insert on public.event_participants
  for each row execute function public.check_capacity();

-- ---------------------------------------------------------------------
-- 4) 전체 일정 사진 저장소 : 비공개 버킷, 멤버만 보기(서명 URL), 관리자만 올리기·지우기
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-images', 'event-images', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists event_images_read on storage.objects;
create policy event_images_read on storage.objects for select to authenticated
  using (bucket_id = 'event-images' and public.is_member(public.try_uuid((storage.foldername(name))[1])));

drop policy if exists event_images_insert on storage.objects;
create policy event_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'event-images' and public.is_admin(public.try_uuid((storage.foldername(name))[1])));

drop policy if exists event_images_delete on storage.objects;
create policy event_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'event-images' and public.is_admin(public.try_uuid((storage.foldername(name))[1])));

-- ---------------------------------------------------------------------
-- 5) 프로필 사진 : 용량·형식 제한, 다른 사람의 폴더 목록은 볼 수 없게 (공개 URL 로 보는 것은 그대로)
-- ---------------------------------------------------------------------
update storage.buckets
   set file_size_limit = 1048576, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'avatars';

drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- 가입 시 구글 프로필 사진 주소는 https 형식일 때만 옮긴다 (이상한 값 때문에 가입이 막히지 않게)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_url text := new.raw_user_meta_data ->> 'avatar_url';
begin
  if v_url is null or v_url !~ '^https://[^[:space:]"''<>]+$' or char_length(v_url) > 500 then
    v_url := null;
  end if;
  insert into public.profiles (id, avatar_url) values (new.id, v_url)
  on conflict (id) do nothing;
  return new;
end $$;

alter table public.profiles drop constraint if exists profiles_avatar_url;
alter table public.profiles add constraint profiles_avatar_url
  check (avatar_url is null or (avatar_url ~ '^https://[^[:space:]"''<>]+$' and char_length(avatar_url) <= 500)) not valid;

-- ---------------------------------------------------------------------
-- 6) 메모 : 공용(캘린더 멤버 모두 읽고 고침) · 개인(본인만)
-- ---------------------------------------------------------------------
create table if not exists public.calendar_notes (
  calendar_id uuid primary key references public.calendars(id) on delete cascade,
  body        text not null default '' check (char_length(body) <= 5000),
  updated_by  uuid references public.profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);

create table if not exists public.personal_notes (
  calendar_id uuid not null,
  user_id     uuid not null,
  body        text not null default '' check (char_length(body) <= 5000),
  updated_at  timestamptz not null default now(),
  primary key (calendar_id, user_id),
  foreign key (calendar_id, user_id) references public.calendar_members (calendar_id, user_id) on delete cascade
);

alter table public.calendar_notes enable row level security;
alter table public.personal_notes enable row level security;

drop policy if exists cal_notes_select on public.calendar_notes;
create policy cal_notes_select on public.calendar_notes for select to authenticated
  using (public.is_member(calendar_id));
drop policy if exists cal_notes_insert on public.calendar_notes;
create policy cal_notes_insert on public.calendar_notes for insert to authenticated
  with check (public.is_member(calendar_id) and updated_by = auth.uid());
drop policy if exists cal_notes_update on public.calendar_notes;
create policy cal_notes_update on public.calendar_notes for update to authenticated
  using (public.is_member(calendar_id))
  with check (public.is_member(calendar_id) and updated_by = auth.uid());

drop policy if exists my_notes_all on public.personal_notes;
create policy my_notes_all on public.personal_notes for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_member(calendar_id));

revoke all on public.calendar_notes, public.personal_notes from anon;
grant select, insert, update on public.calendar_notes to authenticated;
grant select, insert, update, delete on public.personal_notes to authenticated;

drop trigger if exists cal_notes_touch on public.calendar_notes;
create trigger cal_notes_touch before update on public.calendar_notes
  for each row execute function public.touch_updated_at();
drop trigger if exists my_notes_touch on public.personal_notes;
create trigger my_notes_touch before update on public.personal_notes
  for each row execute function public.touch_updated_at();

do $$ begin
  alter publication supabase_realtime add table public.calendar_notes;
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------
-- 7) 초대코드 대입 방지 : 15분 동안 틀린 코드 10번이면 잠시 막는다
-- ---------------------------------------------------------------------
create table if not exists public.join_attempts (
  user_id uuid not null,
  at      timestamptz not null default now()
);
create index if not exists join_attempts_user_idx on public.join_attempts (user_id, at);
alter table public.join_attempts enable row level security; -- 정책 없음: 함수로만 접근
revoke all on public.join_attempts from anon, authenticated;

create or replace function public.join_throttle() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from join_attempts where at < now() - interval '1 day';
  if (select count(*) from join_attempts where user_id = auth.uid() and at > now() - interval '15 minutes') >= 10 then
    raise exception 'TOO_MANY_ATTEMPTS';
  end if;
end $$;

create or replace function public.preview_calendar(p_code text)
returns table (id uuid, name text, group_color text, member_count bigint, already_member boolean)
language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  perform public.join_throttle();
  return query
    select c.id, c.name, c.group_color,
           (select count(*) from calendar_members m where m.calendar_id = c.id),
           exists (select 1 from calendar_members m where m.calendar_id = c.id and m.user_id = auth.uid())
      from calendars c
     where c.invite_code = upper(trim(p_code));
  if not found then
    insert into join_attempts (user_id) values (auth.uid());
  end if;
end $$;

-- 틀린 코드는 오류 대신 null 을 돌려준다 (오류를 내면 시도 기록까지 되돌려지므로)
create or replace function public.join_calendar(p_code text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (select 1 from profiles where id = auth.uid() and nickname is not null) then
    raise exception 'PROFILE_REQUIRED';
  end if;
  perform public.join_throttle();

  select id into v_id from calendars where invite_code = upper(trim(p_code));
  if v_id is null then
    insert into join_attempts (user_id) values (auth.uid());
    return null;
  end if;

  insert into calendar_members (calendar_id, user_id) values (v_id, auth.uid())
  on conflict do nothing;
  return v_id;
end $$;

revoke execute on function public.join_throttle() from public, anon, authenticated;
revoke execute on function public.try_uuid(text), public.event_images_ok(text[], uuid) from public, anon;
grant execute on function public.try_uuid(text), public.event_images_ok(text[], uuid) to authenticated;
grant execute on function public.preview_calendar(text), public.join_calendar(text) to authenticated;

-- ---- 20261013000010_notice_event_tag.sql ----
-- =====================================================================
-- 010. v0.7 : 공지사항에 전체 일정 하나를 태그
--   · 같은 캘린더의 전체(단체) 일정만 태그할 수 있다
--   · 태그한 일정이 지워지면 태그만 빠진다 (공지는 남는다)
-- 여러 번 실행해도 안전합니다(멱등).
-- =====================================================================

alter table public.announcements add column if not exists event_id uuid references public.events(id) on delete set null;
create index if not exists announcements_event_idx on public.announcements (event_id);

create or replace function public.check_notice_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.event_id is not null and not exists (
    select 1 from events e where e.id = new.event_id and e.calendar_id = new.calendar_id and e.is_group
  ) then
    raise exception 'BAD_EVENT_TAG';
  end if;
  -- 공지를 다른 캘린더로 옮기거나 작성자를 바꾸지 못하게
  if tg_op = 'UPDATE' and (new.calendar_id <> old.calendar_id or new.author_id <> old.author_id) then
    raise exception 'FORBIDDEN';
  end if;
  return new;
end $$;

drop trigger if exists trg_check_notice_event on public.announcements;
create trigger trg_check_notice_event before insert or update on public.announcements
  for each row execute function public.check_notice_event();

revoke update on public.announcements from anon, authenticated;
grant update (title, body, body_html, event_id) on public.announcements to authenticated;

-- ---- 20261013000011_security_hardening.sql ----
-- =====================================================================
-- 011. v0.8 : 보안 점검 후 보강
--   1) 권한 정리   : anon 은 아무 테이블·함수도 못 쓰게, 로그인 사용자는 필요한 것만
--   2) 값 검사     : 최근 색·링크·옛 리치 본문 크기 제한
--   3) 사용량 제한 : 캘린더·멤버·일정·댓글·공지 개수와 짧은 시간의 반복 작성(스팸) 제한
--   4) 접속 표시   : Realtime Presence 를 비공개 채널로, 같은 캘린더 멤버만 보고 보낼 수 있게
-- 여러 번 실행해도 안전합니다(멱등).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) 권한 정리
--    Supabase 는 새 테이블·함수에 anon·authenticated 권한을 기본으로 준다.
--    이 앱은 로그인 없이 쓰는 기능이 없으므로 anon 은 모두 막고, TRUNCATE 처럼 RLS 를 거치지 않는 권한도 뺀다.
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke truncate, references, trigger on tables from authenticated;

-- (함수 실행 권한은 이 파일 맨 끝에서, 새로 만든 함수까지 포함해 한 번에 정리한다)

-- 컬럼 단위 수정 권한을 화면에서 실제로 쓰는 것만 남긴다
revoke update on public.calendars from authenticated;
grant update (name, group_color) on public.calendars to authenticated;

revoke update on public.events from authenticated;
grant update (title, memo, is_group, is_recurring, start_date, end_date, start_time, end_time,
              repeat_weekdays, repeat_until, excluded_dates, link_url, image_paths, max_participants)
  on public.events to authenticated;

revoke update on public.event_participants from authenticated; -- 참여는 추가·삭제만

revoke update on public.calendar_notes from authenticated;
grant update (body, updated_by) on public.calendar_notes to authenticated;

revoke update on public.personal_notes from authenticated;
grant update (body) on public.personal_notes to authenticated;

-- ---------------------------------------------------------------------
-- 2) 값 검사 (기존 행은 건드리지 않도록 NOT VALID)
-- ---------------------------------------------------------------------
create or replace function public.colors_ok(cs text[]) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(cardinality(cs), 0) <= 12
     and coalesce(bool_and(c ~ '^#[0-9A-Fa-f]{6}$'), true)
  from unnest(cs) as c;
$$;

alter table public.profiles drop constraint if exists profiles_recent_colors_ok;
alter table public.profiles add constraint profiles_recent_colors_ok check (public.colors_ok(recent_colors)) not valid;

alter table public.events drop constraint if exists events_link_scheme;
alter table public.events add constraint events_link_scheme check (link_url is null or link_url ~* '^https?://') not valid;

alter table public.events drop constraint if exists events_body_rich_size;
alter table public.events add constraint events_body_rich_size
  check (body_rich is null or octet_length(body_rich::text) <= 20000) not valid;

-- ---------------------------------------------------------------------
-- 3) 사용량 제한 (QUOTA_EXCEEDED / TOO_FAST)
-- ---------------------------------------------------------------------
create or replace function public.enforce_quota() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  -- 서비스 키·관리 작업(auth.uid() 없음)은 제한하지 않는다
  if uid is null then
    return new;
  end if;

  if tg_table_name = 'calendars' then
    if (select count(*) from calendars where owner_id = uid) >= 50 then
      raise exception 'QUOTA_EXCEEDED' using hint = '캘린더는 한 사람당 50개까지 만들 수 있어요.';
    end if;

  elsif tg_table_name = 'calendar_members' then
    if (select count(*) from calendar_members where calendar_id = new.calendar_id) >= 300 then
      raise exception 'QUOTA_EXCEEDED' using hint = '캘린더 멤버는 300명까지예요.';
    end if;
    if (select count(*) from calendar_members where user_id = new.user_id) >= 100 then
      raise exception 'QUOTA_EXCEEDED' using hint = '참여할 수 있는 캘린더는 100개까지예요.';
    end if;

  elsif tg_table_name = 'events' then
    if (select count(*) from events where calendar_id = new.calendar_id and author_id = new.author_id) >= 3000 then
      raise exception 'QUOTA_EXCEEDED' using hint = '한 캘린더에 쓸 수 있는 일정은 3000개까지예요.';
    end if;
    if (select count(*) from events where author_id = new.author_id and created_at > now() - interval '1 minute') >= 200 then
      raise exception 'TOO_FAST';
    end if;

  elsif tg_table_name = 'event_comments' then
    if (select count(*) from event_comments where event_id = new.event_id) >= 1000 then
      raise exception 'QUOTA_EXCEEDED' using hint = '댓글은 일정 하나에 1000개까지예요.';
    end if;
    if (select count(*) from event_comments where author_id = new.author_id and created_at > now() - interval '1 minute') >= 20 then
      raise exception 'TOO_FAST';
    end if;

  elsif tg_table_name = 'announcements' then
    if (select count(*) from announcements where calendar_id = new.calendar_id) >= 500 then
      raise exception 'QUOTA_EXCEEDED' using hint = '공지는 캘린더 하나에 500개까지예요.';
    end if;
    if (select count(*) from announcements where author_id = new.author_id and created_at > now() - interval '1 minute') >= 10 then
      raise exception 'TOO_FAST';
    end if;
  end if;
  return new;
end $$;

create index if not exists calendars_owner_idx on public.calendars (owner_id);
create index if not exists events_author_created_idx on public.events (author_id, created_at);
create index if not exists event_comments_author_created_idx on public.event_comments (author_id, created_at);
create index if not exists announcements_author_created_idx on public.announcements (author_id, created_at);

drop trigger if exists trg_quota on public.calendars;
create trigger trg_quota before insert on public.calendars for each row execute function public.enforce_quota();
drop trigger if exists trg_quota on public.calendar_members;
create trigger trg_quota before insert on public.calendar_members for each row execute function public.enforce_quota();
drop trigger if exists trg_quota on public.events;
create trigger trg_quota before insert on public.events for each row execute function public.enforce_quota();
drop trigger if exists trg_quota on public.event_comments;
create trigger trg_quota before insert on public.event_comments for each row execute function public.enforce_quota();
drop trigger if exists trg_quota on public.announcements;
create trigger trg_quota before insert on public.announcements for each row execute function public.enforce_quota();

-- ---------------------------------------------------------------------
-- 4) 접속 표시(Presence) : 비공개 채널 'presence:<calendar_id>' 는 그 캘린더 멤버만 듣고(select) 보낼(insert) 수 있다
--    (Supabase 의 realtime.messages 테이블이 있을 때만 적용)
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists smc_presence_read on realtime.messages';
    execute 'drop policy if exists smc_presence_write on realtime.messages';
    execute $p$
      create policy smc_presence_read on realtime.messages for select to authenticated
      using (
        realtime.messages.extension = 'presence'
        and split_part(realtime.topic(), ':', 1) = 'presence'
        and public.is_member(public.try_uuid(split_part(realtime.topic(), ':', 2)))
      )$p$;
    execute $p$
      create policy smc_presence_write on realtime.messages for insert to authenticated
      with check (
        realtime.messages.extension = 'presence'
        and split_part(realtime.topic(), ':', 1) = 'presence'
        and public.is_member(public.try_uuid(split_part(realtime.topic(), ':', 2)))
      )$p$;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 마지막: 함수 실행 권한 정리 (위에서 만든 함수 포함)
--   트리거 함수는 실행 권한이 없어도 트리거로는 동작한다.
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from public, anon;
grant execute on function
  public.is_member(uuid),
  public.is_admin(uuid),
  public.shares_calendar_with(uuid),
  public.try_uuid(text),
  public.event_images_ok(text[], uuid),
  public.colors_ok(text[]),
  public.create_calendar(text, text),
  public.preview_calendar(text),
  public.join_calendar(text),
  public.regenerate_invite_code(uuid),
  public.delete_my_account()
to authenticated;

-- ---- 20261014000003_main_sync.sql ----
-- =====================================================================
-- 012. 메인 화면에서 쓴 개인 일정 동기화
--   · 메인에서 추가한 개인 일정은 내 캘린더 전체에 같은 sync_id 로 복사된다
--   · 새 캘린더를 만들거나 참여하면, 그 사람의 (아직 안 끝난) 동기화 일정이 새 캘린더에도 복사된다
--   · 한 곳에서 고치거나 지우면 (본인이 한 경우) 다른 캘린더의 같은 일정도 함께 바뀐다
--   · 캘린더에서 나가거나 추방될 때 지워지는 일정은 다른 캘린더로 번지지 않는다
-- 여러 번 실행해도 안전합니다(멱등).
-- =====================================================================

alter table public.events add column if not exists sync_id uuid;
create index if not exists events_sync_idx on public.events (sync_id) where sync_id is not null;

-- 이미 메인에서 여러 캘린더에 한 번에 넣었던 일정(같은 사람·같은 시각에 함께 만들어진 같은 일정)에 sync_id 를 붙인다
with g as (
  select author_id, created_at, title, start_date, start_time, gen_random_uuid() as sid
  from public.events
  where not is_group and sync_id is null
  group by author_id, created_at, title, start_date, start_time
  having count(*) > 1 and count(distinct calendar_id) = count(*)
)
update public.events e
set sync_id = g.sid
from g
where e.sync_id is null and not e.is_group
  and e.author_id = g.author_id and e.created_at = g.created_at and e.title = g.title
  and e.start_date = g.start_date and e.start_time is not distinct from g.start_time;

-- 1) 캘린더에 들어오면 (만들기·참여 모두) 내 동기화 일정을 복사
create or replace function public.sync_events_on_join() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    insert into events (calendar_id, author_id, title, memo, is_group, is_recurring, start_date, end_date,
                        start_time, end_time, repeat_weekdays, repeat_until, excluded_dates, link_url, sync_id)
    select new.calendar_id, s.author_id, s.title, s.memo, false, s.is_recurring, s.start_date, s.end_date,
           s.start_time, s.end_time, s.repeat_weekdays, s.repeat_until, s.excluded_dates, s.link_url, s.sync_id
    from (
      select distinct on (sync_id) *
      from events
      where author_id = new.user_id and sync_id is not null and not is_group
        and end_date >= current_date and calendar_id <> new.calendar_id
      order by sync_id, updated_at desc
    ) s
    where not exists (select 1 from events x where x.calendar_id = new.calendar_id and x.sync_id = s.sync_id)
    limit 150;
  exception when others then
    -- 복사가 실패해도 참여 자체는 막지 않는다
    raise warning 'sync_events_on_join: %', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists trg_sync_events_on_join on public.calendar_members;
create trigger trg_sync_events_on_join after insert on public.calendar_members
  for each row execute function public.sync_events_on_join();

-- 2) 수정 전파: 본인이 직접 고친 경우만
create or replace function public.sync_events_on_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 or new.sync_id is null or new.is_group or auth.uid() is distinct from new.author_id then
    return new;
  end if;
  update events set
    title = new.title, memo = new.memo, is_recurring = new.is_recurring,
    start_date = new.start_date, end_date = new.end_date, start_time = new.start_time, end_time = new.end_time,
    repeat_weekdays = new.repeat_weekdays, repeat_until = new.repeat_until, excluded_dates = new.excluded_dates,
    link_url = new.link_url
  where sync_id = new.sync_id and author_id = new.author_id and id <> new.id;
  return new;
end $$;

drop trigger if exists trg_sync_events_on_update on public.events;
create trigger trg_sync_events_on_update after update on public.events
  for each row execute function public.sync_events_on_update();

-- 3) 삭제 전파: 본인이 직접 지운 경우만 (나가기·추방으로 연쇄 삭제될 때는 번지지 않음)
create or replace function public.sync_events_on_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 or old.sync_id is null or auth.uid() is distinct from old.author_id
     or not exists (select 1 from calendar_members m where m.calendar_id = old.calendar_id and m.user_id = old.author_id) then
    return old;
  end if;
  delete from events where sync_id = old.sync_id and author_id = old.author_id and id <> old.id;
  return old;
end $$;

drop trigger if exists trg_sync_events_on_delete on public.events;
create trigger trg_sync_events_on_delete after delete on public.events
  for each row execute function public.sync_events_on_delete();

revoke execute on function public.sync_events_on_join(), public.sync_events_on_update(), public.sync_events_on_delete() from public, anon, authenticated;

-- ---- 20261014000004_event_dates.sql ----
-- =====================================================================
-- 013. 떨어진 날짜로 만드는 전체 일정 (하나의 일정)
--   · event_dates : 진행하는 날짜 목록. start_date / end_date 는 그중 첫 날 / 마지막 날
--   · 화면에서는 날짜마다 하루짜리 회차로 보이지만 일정·참여 멤버·댓글·사진은 하나로 관리된다
-- 여러 번 실행해도 안전합니다(멱등).
-- =====================================================================

alter table public.events add column if not exists event_dates date[];

create or replace function public.event_dates_ok(ds date[], s date, e date) returns boolean
language sql immutable as $$
  select ds is null or (
    cardinality(ds) between 2 and 62
    and (select min(x) from unnest(ds) x) = s
    and (select max(x) from unnest(ds) x) = e
    and (select count(distinct x) from unnest(ds) x) = cardinality(ds)
  );
$$;

alter table public.events drop constraint if exists events_dates_rule;
alter table public.events add constraint events_dates_rule check (
  event_dates is null
  or (is_group and repeat_weekdays is null and public.event_dates_ok(event_dates, start_date, end_date))
);

revoke update on public.events from anon, authenticated;
grant update (title, memo, is_group, is_recurring, start_date, end_date, start_time, end_time,
              repeat_weekdays, repeat_until, excluded_dates, event_dates, link_url, image_paths, max_participants)
  on public.events to authenticated;

-- ---- 20261015000001_memos.sql ----
-- =====================================================================
-- 014. 메모 탭 : 공용·개인 메모 두 칸 → 캘린더 멤버 모두가 보는 메모 목록
--   · + 버튼으로 새 메모를 여러 개 만든다 (메모마다 작성자 · 작성 시간)
--   · 읽기 : 캘린더 멤버 전원 / 쓰기 : 멤버 누구나
--   · 수정 : 작성자 본인 / 삭제 : 작성자 본인 또는 관리자
--   · 멤버가 나가거나 추방되면 그 사람이 쓴 메모도 함께 지워진다 (일정과 같은 규칙)
-- 여러 번 실행해도 안전합니다(멱등).
--
-- [권한 오류 원인] 예전 calendar_notes / personal_notes 는 수정 가능한 컬럼을 body 등으로만
--   제한(011 보안 보강)했는데, 화면은 upsert(INSERT … ON CONFLICT DO UPDATE)로 저장해
--   calendar_id · user_id 컬럼까지 수정하려 했기 때문에 '권한이 없어요'가 났다.
--   새 메모는 추가(insert)와 본문 수정(update body)을 따로 하므로 이 문제가 없다.
-- =====================================================================

create table if not exists public.memos (
  id          uuid primary key default gen_random_uuid(),
  calendar_id uuid not null,
  author_id   uuid not null,
  body        text not null check (char_length(btrim(body)) between 1 and 5000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,               -- null 이면 수정한 적 없음
  foreign key (calendar_id, author_id)
    references public.calendar_members (calendar_id, user_id) on delete cascade
);

create index if not exists memos_calendar_created_idx on public.memos (calendar_id, created_at desc);
create index if not exists memos_author_created_idx on public.memos (author_id, created_at);

alter table public.memos enable row level security;

drop policy if exists memos_select on public.memos;
create policy memos_select on public.memos for select to authenticated
  using (public.is_member(calendar_id));

drop policy if exists memos_insert on public.memos;
create policy memos_insert on public.memos for insert to authenticated
  with check (author_id = auth.uid() and public.is_member(calendar_id));

drop policy if exists memos_update on public.memos;
create policy memos_update on public.memos for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid() and public.is_member(calendar_id));

drop policy if exists memos_delete on public.memos;
create policy memos_delete on public.memos for delete to authenticated
  using (author_id = auth.uid() or public.is_admin(calendar_id));

revoke all on public.memos from anon, authenticated;
grant select, delete on public.memos to authenticated;
grant insert (calendar_id, author_id, body) on public.memos to authenticated;
grant update (body) on public.memos to authenticated;

-- 수정하면 updated_at 을 지금 시각으로
drop trigger if exists memos_touch on public.memos;
create trigger memos_touch before update on public.memos
  for each row execute function public.touch_updated_at();

-- 사용량 제한 : 캘린더당 1000개, 한 사람이 1분에 20개
create or replace function public.memos_quota() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if (select count(*) from memos where calendar_id = new.calendar_id) >= 1000 then
    raise exception 'QUOTA_EXCEEDED' using hint = '메모는 캘린더 하나에 1000개까지예요.';
  end if;
  if (select count(*) from memos where author_id = new.author_id and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'TOO_FAST';
  end if;
  return new;
end $$;
revoke execute on function public.memos_quota() from public, anon, authenticated;

drop trigger if exists trg_quota on public.memos;
create trigger trg_quota before insert on public.memos
  for each row execute function public.memos_quota();

-- 실시간 반영
do $$ begin
  alter publication supabase_realtime add table public.memos;
exception when duplicate_object then null;
end $$;

-- 예전 공용 메모 내용을 새 메모 하나로 옮긴다 (마지막으로 고친 사람이 작성자, 아직 멤버일 때만)
--   개인 메모는 본인만 보던 내용이라 모두에게 공개되지 않도록 옮기지 않는다.
--   예전 표(calendar_notes · personal_notes)는 지우지 않고 그대로 둔다.
do $$ begin
  if to_regclass('public.calendar_notes') is not null then
    insert into public.memos (calendar_id, author_id, body, created_at)
    select n.calendar_id, n.updated_by, left(btrim(n.body), 5000), n.updated_at
    from public.calendar_notes n
    join public.calendar_members cm on cm.calendar_id = n.calendar_id and cm.user_id = n.updated_by
    where btrim(n.body) <> ''
      and not exists (
        select 1 from public.memos m
        where m.calendar_id = n.calendar_id and m.body = left(btrim(n.body), 5000)
      );
  end if;
end $$;
