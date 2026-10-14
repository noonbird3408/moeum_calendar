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
