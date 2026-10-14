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
--   · 단체 일정은 반복하지 않는다
-- ---------------------------------------------------------------------
alter table public.events add column if not exists repeat_weekdays smallint[];
alter table public.events add column if not exists repeat_until date;
alter table public.events add column if not exists link_url text;
alter table public.events add column if not exists body_rich jsonb;

alter table public.events drop constraint if exists events_max_span;
alter table public.events add constraint events_max_span check (end_date - start_date <= 400);

alter table public.events drop constraint if exists events_repeat_rule;
alter table public.events add constraint events_repeat_rule check (
  repeat_weekdays is null
  or (
    not is_group
    and repeat_until is not null
    and repeat_until >= start_date
    and cardinality(repeat_weekdays) between 1 and 7
    and repeat_weekdays <@ array[0,1,2,3,4,5,6]::smallint[]
  )
);

alter table public.events drop constraint if exists events_link_len;
alter table public.events add constraint events_link_len check (link_url is null or char_length(link_url) <= 500);

revoke update on public.events from anon, authenticated;
grant update (title, memo, is_group, is_recurring, start_date, end_date, start_time, end_time,
              repeat_weekdays, repeat_until, link_url, body_rich)
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
