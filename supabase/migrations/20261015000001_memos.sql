-- =====================================================================
-- 014. 메모 탭 : 공용·개인 메모 두 칸 → 캘린더 멤버 모두가 보는 메모 목록
--   · + 버튼으로 새 메모를 여러 개 만든다 (메모마다 작성자 · 작성 시간)
--   · 읽기 : 캘린더 멤버 전원 / 쓰기 : 멤버 누구나
--   · 수정 : 작성자 본인 / 삭제 : 작성자 본인 또는 관리자
--   · 멤버가 나가거나 추방되면 그 사람이 쓴 메모도 함께 지워진다 (일정과 같은 규칙)
-- 여러 번 실행해도 안전합니다(멱등).
--
-- [권한 오류 원인] 예전 calendar_notes / personal_notes 는 수정 가능한 컬럼을 body 등으로만
--   제한(011 보안 보강)했는데, 화면은 upsert(INSERT … ON CONFLICT DO UPDATE)로 저장해
--   calendar_id · user_id 컬럼까지 수정하려 했기 때문에 '권한이 없어요'가 났다.
--   새 메모는 추가(insert)와 본문 수정(update body)을 따로 하므로 이 문제가 없다.
-- =====================================================================

create table if not exists public.memos (
  id          uuid primary key default gen_random_uuid(),
  calendar_id uuid not null,
  author_id   uuid not null,
  body        text not null check (char_length(btrim(body)) between 1 and 5000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,               -- null 이면 수정한 적 없음
  foreign key (calendar_id, author_id)
    references public.calendar_members (calendar_id, user_id) on delete cascade
);

create index if not exists memos_calendar_created_idx on public.memos (calendar_id, created_at desc);
create index if not exists memos_author_created_idx on public.memos (author_id, created_at);

alter table public.memos enable row level security;

drop policy if exists memos_select on public.memos;
create policy memos_select on public.memos for select to authenticated
  using (public.is_member(calendar_id));

drop policy if exists memos_insert on public.memos;
create policy memos_insert on public.memos for insert to authenticated
  with check (author_id = auth.uid() and public.is_member(calendar_id));

drop policy if exists memos_update on public.memos;
create policy memos_update on public.memos for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid() and public.is_member(calendar_id));

drop policy if exists memos_delete on public.memos;
create policy memos_delete on public.memos for delete to authenticated
  using (author_id = auth.uid() or public.is_admin(calendar_id));

revoke all on public.memos from anon, authenticated;
grant select, delete on public.memos to authenticated;
grant insert (calendar_id, author_id, body) on public.memos to authenticated;
grant update (body) on public.memos to authenticated;

-- 수정하면 updated_at 을 지금 시각으로
drop trigger if exists memos_touch on public.memos;
create trigger memos_touch before update on public.memos
  for each row execute function public.touch_updated_at();

-- 사용량 제한 : 캘린더당 1000개, 한 사람이 1분에 20개
create or replace function public.memos_quota() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if (select count(*) from memos where calendar_id = new.calendar_id) >= 1000 then
    raise exception 'QUOTA_EXCEEDED' using hint = '메모는 캘린더 하나에 1000개까지예요.';
  end if;
  if (select count(*) from memos where author_id = new.author_id and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'TOO_FAST';
  end if;
  return new;
end $$;
revoke execute on function public.memos_quota() from public, anon, authenticated;

drop trigger if exists trg_quota on public.memos;
create trigger trg_quota before insert on public.memos
  for each row execute function public.memos_quota();

-- 실시간 반영
do $$ begin
  alter publication supabase_realtime add table public.memos;
exception when duplicate_object then null;
end $$;

-- 예전 공용 메모 내용을 새 메모 하나로 옮긴다 (마지막으로 고친 사람이 작성자, 아직 멤버일 때만)
--   개인 메모는 본인만 보던 내용이라 모두에게 공개되지 않도록 옮기지 않는다.
--   예전 표(calendar_notes · personal_notes)는 지우지 않고 그대로 둔다.
do $$ begin
  if to_regclass('public.calendar_notes') is not null then
    insert into public.memos (calendar_id, author_id, body, created_at)
    select n.calendar_id, n.updated_by, left(btrim(n.body), 5000), n.updated_at
    from public.calendar_notes n
    join public.calendar_members cm on cm.calendar_id = n.calendar_id and cm.user_id = n.updated_by
    where btrim(n.body) <> ''
      and not exists (
        select 1 from public.memos m
        where m.calendar_id = n.calendar_id and m.body = left(btrim(n.body), 5000)
      );
  end if;
end $$;
