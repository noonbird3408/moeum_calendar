-- 전체(단체) 일정도 특정 요일 반복을 쓸 수 있게 한다.
-- 이미 excluded_dates 컬럼이 없다면 함께 만든다 (20261014000001 을 아직 돌리지 않은 경우 대비).
alter table public.events add column if not exists excluded_dates date[] not null default '{}';

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

revoke update on public.events from anon, authenticated;
grant update (title, memo, is_group, is_recurring, start_date, end_date, start_time, end_time,
              repeat_weekdays, repeat_until, excluded_dates, link_url, image_paths, max_participants)
  on public.events to authenticated;
