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
