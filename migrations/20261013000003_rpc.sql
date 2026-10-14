-- =====================================================================
-- 003. RPC (supabase.rpc 로 호출)
--  create_calendar / preview_calendar / join_calendar / regenerate_invite_code
-- =====================================================================

-- 6자리 초대코드: 헷갈리는 0/O, 1/I 를 뺀 32자 (32^6 ≈ 10.7억 조합)
create or replace function public.gen_invite_code() returns text
language plpgsql volatile set search_path = public as $$
declare
  chars text  := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  -- gen_random_uuid() 는 암호학적 난수 기반, 앞 6바이트는 버전 비트가 없는 순수 난수
  b     bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  code  text  := '';
begin
  for i in 0..5 loop
    code := code || substr(chars, 1 + (get_byte(b, i) % 32), 1);
  end loop;
  return code;
end $$;

-- 캘린더 만들기: 캘린더 + 만든 사람을 admin 으로 등록 (한 트랜잭션)
create or replace function public.create_calendar(p_name text, p_color text default '#FF6B35')
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (select 1 from profiles where id = auth.uid() and nickname is not null) then
    raise exception 'PROFILE_REQUIRED';
  end if;

  loop
    begin
      insert into calendars (name, group_color, invite_code, owner_id)
      values (trim(p_name), coalesce(p_color, '#FF6B35'), gen_invite_code(), auth.uid())
      returning id into v_id;
      exit;
    exception when unique_violation then
      -- 초대코드 충돌 시 재시도
    end;
  end loop;

  insert into calendar_members (calendar_id, user_id, role) values (v_id, auth.uid(), 'admin');
  return v_id;
end $$;

-- 참여 전 미리보기 (멤버가 아니어도 이름·인원만 확인 가능)
create or replace function public.preview_calendar(p_code text)
returns table (id uuid, name text, group_color text, member_count bigint, already_member boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.group_color,
         (select count(*) from calendar_members m where m.calendar_id = c.id),
         exists (select 1 from calendar_members m where m.calendar_id = c.id and m.user_id = auth.uid())
  from calendars c
  where auth.uid() is not null and c.invite_code = upper(trim(p_code));
$$;

-- 초대코드로 참여 (이미 멤버면 그대로 통과)
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

  select id into v_id from calendars where invite_code = upper(trim(p_code));
  if v_id is null then raise exception 'INVALID_CODE'; end if;

  insert into calendar_members (calendar_id, user_id) values (v_id, auth.uid())
  on conflict do nothing;
  return v_id;
end $$;

-- 초대코드 재발급 (관리자만, 기존 링크 무효화)
create or replace function public.regenerate_invite_code(p_calendar uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
begin
  if not public.is_admin(p_calendar) then raise exception 'FORBIDDEN'; end if;
  loop
    begin
      update calendars set invite_code = gen_invite_code() where id = p_calendar
      returning invite_code into v_code;
      exit;
    exception when unique_violation then
    end;
  end loop;
  return v_code;
end $$;

-- 실행 권한: 로그인 사용자만
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.create_calendar(text, text),
  public.preview_calendar(text),
  public.join_calendar(text),
  public.regenerate_invite_code(uuid),
  public.is_member(uuid),
  public.is_admin(uuid),
  public.shares_calendar_with(uuid)
to authenticated;
