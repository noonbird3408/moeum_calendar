-- =====================================================================
-- 004. Realtime : 캘린더·일정·멤버·프로필 변경을 구독할 수 있게 publication 에 추가
--  (RLS 가 적용되므로 같은 캘린더 멤버에게만 전달됩니다)
-- =====================================================================
do $$ begin
  alter publication supabase_realtime add table public.calendars, public.events, public.calendar_members, public.profiles;
exception when duplicate_object then null;
end $$;
