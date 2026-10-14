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
