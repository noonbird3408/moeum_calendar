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
              repeat_weekdays, repeat_until, link_url, image_paths, max_participants)
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
