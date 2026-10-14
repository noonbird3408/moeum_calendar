-- 반복 일정에서 특정 회차를 제외한다.
alter table public.events add column if not exists excluded_dates date[] not null default '{}';

revoke update on public.events from anon, authenticated;
grant update (title, memo, is_group, is_recurring, start_date, end_date, start_time, end_time,
              repeat_weekdays, repeat_until, link_url, image_paths, max_participants, excluded_dates)
  on public.events to authenticated;
