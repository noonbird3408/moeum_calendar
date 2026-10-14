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
