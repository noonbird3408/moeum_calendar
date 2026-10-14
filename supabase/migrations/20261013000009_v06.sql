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
              repeat_weekdays, repeat_until, link_url, body_rich, image_paths, max_participants)
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
