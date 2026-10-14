\set ON_ERROR_STOP on
create schema test;
grant usage on schema test to anon, authenticated;
create function test.act(uid text) returns void language sql as $$ select set_config('request.jwt.claim.sub', uid, false) $$;
create function test.affected(q text) returns int language plpgsql as $$
declare n int; begin execute q; get diagnostics n = row_count; return n; end $$;
create function test.expect_error(q text, pat text default '%') returns text language plpgsql as $$
begin
  execute q;
  raise exception 'EXPECTED FAILURE but succeeded: %', q;
exception when others then
  if sqlerrm like 'EXPECTED FAILURE%' then raise; end if;
  if sqlerrm not like pat then raise exception 'wrong error for [%]: %', q, sqlerrm; end if;
  return 'blocked: ' || sqlerrm;
end $$;
create function test.eq(label text, got anyelement, want anyelement) returns text language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL %: got %, want %', label, got, want; end if;
  return 'ok ' || label;
end $$;
grant execute on all functions in schema test to anon, authenticated;
create table test.ids (k text primary key, v text);
grant all on test.ids to anon, authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
 ('aaaaaaaa-0000-0000-0000-000000000001','a@x.com','{"avatar_url":"http://a"}'),
 ('bbbbbbbb-0000-0000-0000-000000000002','b@x.com','{}'),
 ('cccccccc-0000-0000-0000-000000000003','c@x.com','{}'),
 ('dddddddd-0000-0000-0000-000000000004','n@x.com','{}');
select test.eq('profiles auto-created', (select count(*) from public.profiles), 4::bigint);

set role authenticated;
-- A onboarding
select test.act('aaaaaaaa-0000-0000-0000-000000000001');
select test.eq('A sets own profile', test.affected($$update profiles set nickname='민수', color='#3B82F6' where id=auth.uid()$$), 1);
select test.eq('A cannot edit other profile', test.affected($$update profiles set nickname='x' where id='bbbbbbbb-0000-0000-0000-000000000002'$$), 0);
select test.expect_error($$update profiles set id=gen_random_uuid() where id=auth.uid()$$, '%permission denied%');
select test.act('bbbbbbbb-0000-0000-0000-000000000002');
update profiles set nickname='지현', color='#10B981' where id=auth.uid();
select test.act('cccccccc-0000-0000-0000-000000000003');
update profiles set nickname='외부인' where id=auth.uid();

-- N (no nickname) cannot create
select test.act('dddddddd-0000-0000-0000-000000000004');
select test.expect_error($$select create_calendar('x')$$, 'PROFILE_REQUIRED');

-- A creates calendar
select test.act('aaaaaaaa-0000-0000-0000-000000000001');
insert into test.ids select 'cal', create_calendar('  스터디 모임 ', '#FF6B35')::text;
insert into test.ids select 'code', invite_code from calendars where id = (select v::uuid from test.ids where k='cal');
select test.eq('code format', (select v ~ '^[A-Z2-9]{6}$' from test.ids where k='code'), true);
select test.eq('name trimmed', (select name from calendars), '스터디 모임');
select test.eq('A is admin', (select role from calendar_members where user_id=auth.uid()), 'admin');
select test.expect_error($$insert into calendars(name, invite_code, owner_id) values ('h','ABCDEF',auth.uid())$$, '%permission denied%');
select test.expect_error($$insert into calendar_members(calendar_id, user_id) select v::uuid, 'cccccccc-0000-0000-0000-000000000003' from test.ids where k='cal'$$, '%permission denied%');

-- C outsider: preview only
select test.act('cccccccc-0000-0000-0000-000000000003');
select test.eq('C sees no calendar', (select count(*) from calendars), 0::bigint);
select test.eq('C preview', (select member_count from preview_calendar((select lower(v) from test.ids where k='code'))), 1::bigint);
select test.eq('C cannot see A profile', (select count(*) from profiles where id='aaaaaaaa-0000-0000-0000-000000000001'), 0::bigint);

-- B joins (lowercase + spaces)
select test.act('bbbbbbbb-0000-0000-0000-000000000002');
select test.eq('B join', join_calendar((select ' '||lower(v)||' ' from test.ids where k='code'))::text, (select v from test.ids where k='cal'));
select test.eq('B join twice is idempotent', join_calendar((select v from test.ids where k='code'))::text, (select v from test.ids where k='cal'));
select test.eq('B role member', (select role from calendar_members where user_id=auth.uid()), 'member');
select test.eq('B sees A profile', (select nickname from profiles where id='aaaaaaaa-0000-0000-0000-000000000001'), '민수');
select test.eq('wrong code returns null', join_calendar('ZZZZZZ') is null, true);

-- Events
select test.eq('B personal event', test.affected($$insert into events(calendar_id, author_id, title, start_date, end_date, start_time, end_time)
  select v::uuid, auth.uid(), '알바', '2026-10-24', '2026-10-24', '18:00', '22:00' from test.ids where k='cal'$$), 1);
select test.expect_error($$insert into events(calendar_id, author_id, title, start_date, end_date, is_group)
  select v::uuid, auth.uid(), '회식', '2026-10-25', '2026-10-25', true from test.ids where k='cal'$$, '%row-level security%');
select test.expect_error($$insert into events(calendar_id, author_id, title, start_date, end_date)
  select v::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', '사칭', '2026-10-25', '2026-10-25' from test.ids where k='cal'$$, '%row-level security%');
select test.expect_error($$insert into events(calendar_id, author_id, title, start_date, end_date, start_time, end_time)
  select v::uuid, auth.uid(), '역순', '2026-10-25', '2026-10-25', '18:00', '17:00' from test.ids where k='cal'$$, '%events_time_order%');
select test.eq('until midnight 24:00 ok', test.affected($$insert into events(calendar_id, author_id, title, start_date, end_date, start_time, end_time)
  select v::uuid, auth.uid(), '야간', '2026-10-26', '2026-10-26', '22:00', '24:00' from test.ids where k='cal'$$), 1);

select test.act('aaaaaaaa-0000-0000-0000-000000000001');
select test.eq('A group event', test.affected($$insert into events(calendar_id, author_id, title, start_date, end_date, is_group)
  select v::uuid, auth.uid(), '정기 모임', '2026-10-25', '2026-10-25', true from test.ids where k='cal'$$), 1);
select test.eq('A edits B event', test.affected($$update events set title='알바(수정)' where title='알바'$$), 1);

select test.act('bbbbbbbb-0000-0000-0000-000000000002');
select test.eq('B sees all events', (select count(*) from events), 3::bigint);
select test.eq('B cannot edit A event', test.affected($$update events set title='x' where title='정기 모임'$$), 0);
select test.eq('B cannot delete A event', test.affected($$delete from events where title='정기 모임'$$), 0);
select test.expect_error($$update events set author_id='aaaaaaaa-0000-0000-0000-000000000001' where title='야간'$$, '%permission denied%');
select test.expect_error($$update events set is_group=true where title='야간'$$, '%row-level security%');
select test.eq('B edits own', test.affected($$update events set memo='늦게 끝남' where title='야간'$$), 1);
select test.eq('B cannot promote self', test.affected($$update calendar_members set role='admin' where user_id=auth.uid()$$), 0);
select test.eq('B cannot kick A', test.affected($$delete from calendar_members where user_id='aaaaaaaa-0000-0000-0000-000000000001'$$), 0);
select test.expect_error($$select regenerate_invite_code((select v::uuid from test.ids where k='cal'))$$, 'FORBIDDEN');
select test.eq('B cannot rename calendar', test.affected($$update calendars set name='x'$$), 0);

-- C cannot touch
select test.act('cccccccc-0000-0000-0000-000000000003');
select test.eq('C sees no events', (select count(*) from events), 0::bigint);
select test.eq('C cannot delete', test.affected($$delete from events$$), 0);

-- Last admin guard
select test.act('aaaaaaaa-0000-0000-0000-000000000001');
select test.expect_error($$delete from calendar_members where user_id=auth.uid()$$, 'LAST_ADMIN');
select test.expect_error($$update calendar_members set role='member' where user_id=auth.uid()$$, 'LAST_ADMIN');

-- Kick B -> B events cascade
select test.eq('A kicks B', test.affected($$delete from calendar_members where user_id='bbbbbbbb-0000-0000-0000-000000000002'$$), 1);
select test.eq('B events cascaded', (select count(*) from events where author_id='bbbbbbbb-0000-0000-0000-000000000002'), 0::bigint);
select test.eq('A events remain', (select count(*) from events), 1::bigint);

-- Regenerate code invalidates old
insert into test.ids select 'code2', regenerate_invite_code((select v::uuid from test.ids where k='cal'));
select test.eq('code changed', (select v from test.ids where k='code2') <> (select v from test.ids where k='code'), true);
select test.act('bbbbbbbb-0000-0000-0000-000000000002');
select test.eq('old code no longer works', join_calendar((select v from test.ids where k='code')) is null, true);
select test.eq('B rejoins with new code', join_calendar((select v from test.ids where k='code2'))::text, (select v from test.ids where k='cal'));

-- Promote B, then A can leave; B leaves own? (B is now admin)
select test.act('aaaaaaaa-0000-0000-0000-000000000001');
select test.eq('A promotes B', test.affected($$update calendar_members set role='admin' where user_id='bbbbbbbb-0000-0000-0000-000000000002'$$), 1);
select test.eq('A renames', test.affected($$update calendars set name='새 이름', group_color='#123456'$$), 1);
select test.eq('A leaves (B admin)', test.affected($$delete from calendar_members where user_id=auth.uid()$$), 1);
select test.eq('A events cascade on leave', (select count(*) from events), 0::bigint);

-- Admin deletes calendar (cascade through last admin is allowed)
select test.act('bbbbbbbb-0000-0000-0000-000000000002');
insert into events(calendar_id, author_id, title, start_date, end_date) select v::uuid, auth.uid(), '마지막', '2026-11-01','2026-11-01' from test.ids where k='cal';
select test.eq('B deletes calendar', test.affected($$delete from calendars$$), 1);
reset role;
select test.eq('members gone', (select count(*) from calendar_members), 0::bigint);
select test.eq('events gone', (select count(*) from events), 0::bigint);

-- anon
set role anon;
select test.act('');
select test.expect_error($$select count(*) from profiles$$, '%permission denied%');
select test.expect_error($$select create_calendar('x')$$, '%permission denied%');
reset role;

-- invite code distribution sanity
select test.eq('1000 codes unique-ish & valid', (select count(distinct c) from (select gen_invite_code() c from generate_series(1,1000)) s where c ~ '^[A-Z2-9]{6}$') >= 999, true);

-- ===== v0.3: 단체 일정 상세 · 반복 규칙 · 계정 삭제 =====
set role authenticated;
select test.act('aaaaaaaa-0000-0000-0000-000000000001');
insert into test.ids select 'v3cal', create_calendar('v3')::text;
insert into test.ids select 'v3code', invite_code from calendars where id=(select v::uuid from test.ids where k='v3cal');
with e as (insert into events(calendar_id, author_id, title, is_group, start_date, end_date, link_url, body_rich)
  values ((select v::uuid from test.ids where k='v3cal'), auth.uid(), '단체 모임', true, '2026-12-01','2026-12-01', 'https://youtu.be/abc', '[]'::jsonb) returning id)
  insert into test.ids select 'v3grp', id::text from e;
with e as (insert into events(calendar_id, author_id, title, start_date, end_date, start_time, end_time, repeat_weekdays, repeat_until)
  values ((select v::uuid from test.ids where k='v3cal'), auth.uid(), '주간 스터디', '2026-12-01','2027-01-31','19:00','21:00', array[1,3]::smallint[], '2027-01-31') returning id)
  insert into test.ids select 'v3rec', id::text from e;
select test.expect_error($$insert into events(calendar_id, author_id, title, is_group, start_date, end_date, repeat_weekdays, repeat_until) values ((select v::uuid from test.ids where k='v3cal'), auth.uid(), '단체반복', true, '2026-12-01','2026-12-01', array[1]::smallint[], '2026-12-31')$$, '%events_repeat_rule%');
select test.expect_error($$insert into events(calendar_id, author_id, title, start_date, end_date, repeat_weekdays, repeat_until) values ((select v::uuid from test.ids where k='v3cal'), auth.uid(), '잘못된요일', '2026-12-01','2026-12-01', array[9]::smallint[], '2026-12-31')$$, '%events_repeat_rule%');

select test.act('bbbbbbbb-0000-0000-0000-000000000002');
select test.eq('B joins v3', join_calendar((select v from test.ids where k='v3code'))::text, (select v from test.ids where k='v3cal'));
select test.eq('B joins group', test.affected($$insert into event_participants(event_id,user_id) values ((select v::uuid from test.ids where k='v3grp'), auth.uid())$$), 1);
select test.expect_error($$insert into event_participants(event_id,user_id) values ((select v::uuid from test.ids where k='v3grp'), 'aaaaaaaa-0000-0000-0000-000000000001')$$, '%row-level security%');
select test.eq('B comments on group', test.affected($$insert into event_comments(event_id,author_id,body) values ((select v::uuid from test.ids where k='v3grp'), auth.uid(), '안녕')$$), 1);
select test.expect_error($$insert into event_comments(event_id,author_id,body) values ((select v::uuid from test.ids where k='v3grp'), 'aaaaaaaa-0000-0000-0000-000000000001', '대리')$$, '%row-level security%');

select test.act('cccccccc-0000-0000-0000-000000000003');
select test.eq('outsider sees no comments', (select count(*) from event_comments), 0::bigint);
select test.eq('outsider sees no recurring', (select count(*) from events), 0::bigint);

-- ===== v0.4: 공지사항 · 관리자의 단체 일정 참여 지정 =====
select test.act('aaaaaaaa-0000-0000-0000-000000000001');
select test.eq('admin posts notice', test.affected($$insert into announcements(calendar_id, author_id, title, body) values ((select v::uuid from test.ids where k='v3cal'), auth.uid(), '공지', '내용')$$), 1);
select test.eq('admin removes B from group', test.affected($$delete from event_participants where user_id='bbbbbbbb-0000-0000-0000-000000000002' and event_id=(select v::uuid from test.ids where k='v3grp')$$), 1);
select test.eq('admin adds B back to group', test.affected($$insert into event_participants(event_id,user_id) values ((select v::uuid from test.ids where k='v3grp'), 'bbbbbbbb-0000-0000-0000-000000000002')$$), 1);
select test.expect_error($$insert into event_participants(event_id,user_id) values ((select v::uuid from test.ids where k='v3grp'), 'cccccccc-0000-0000-0000-000000000003')$$, '%row-level security%');
-- v0.5: 서식 본문
select test.eq('admin saves rich notice body', test.affected($$update announcements set body_html='<b>굵게</b> <a href="https://example.com">링크</a>'$$), 1);
select test.expect_error($$update announcements set body_html=repeat('x', 20001)$$, '%announcements_body_html_len%');

select test.act('bbbbbbbb-0000-0000-0000-000000000002');
select test.eq('member reads notice', (select count(*) from announcements), 1::bigint);
select test.expect_error($$insert into announcements(calendar_id, author_id, title) values ((select v::uuid from test.ids where k='v3cal'), auth.uid(), '멤버 공지')$$, '%row-level security%');
select test.eq('member cannot edit notice', test.affected($$update announcements set title='해킹'$$), 0);
select test.eq('member cannot edit notice body', test.affected($$update announcements set body_html='<b>x</b>'$$), 0);
select test.eq('member cannot delete notice', test.affected($$delete from announcements$$), 0);
select test.expect_error($$insert into event_participants(event_id,user_id) values ((select v::uuid from test.ids where k='v3grp'), 'cccccccc-0000-0000-0000-000000000003')$$, '%row-level security%');

-- ===== v0.6: 캘린더 설정 · 댓글 수정/답글 · 사진 · 정원 · 메모 · 초대코드 대입 방지 =====
select test.act('aaaaaaaa-0000-0000-0000-000000000001');
select test.expect_error($$update calendars set header_style='color' where id=(select v::uuid from test.ids where k='v3cal')$$, '%permission denied%');
select test.eq('admin sets capacity + image', test.affected($$update events set max_participants=1, image_paths=array[(select v from test.ids where k='v3cal') || '/11111111-1111-1111-1111-111111111111.jpg'] where id=(select v::uuid from test.ids where k='v3grp')$$), 1);
select test.expect_error($$update events set image_paths=array['00000000-0000-0000-0000-000000000000/11111111-1111-1111-1111-111111111111.jpg'] where id=(select v::uuid from test.ids where k='v3grp')$$, '%events_images_ok%');
select test.expect_error($$update events set max_participants=3 where title='주간 스터디'$$, '%events_group_only_extras%');

select test.act('bbbbbbbb-0000-0000-0000-000000000002');
select test.eq('B member cannot change calendar', test.affected($$update calendars set name='x'$$), 0);
select test.eq('B leaves group', test.affected($$delete from event_participants where user_id=auth.uid()$$), 1);
select test.eq('B rejoins (room)', test.affected($$insert into event_participants(event_id,user_id) values ((select v::uuid from test.ids where k='v3grp'), auth.uid())$$), 1);
select test.act('aaaaaaaa-0000-0000-0000-000000000001');
select test.eq('admin may exceed capacity', test.affected($$insert into event_participants(event_id,user_id) values ((select v::uuid from test.ids where k='v3grp'), auth.uid())$$), 1);
select test.act('bbbbbbbb-0000-0000-0000-000000000002');
select test.eq('B leaves again', test.affected($$delete from event_participants where user_id=auth.uid()$$), 1);
select test.expect_error($$insert into event_participants(event_id,user_id) values ((select v::uuid from test.ids where k='v3grp'), auth.uid())$$, '%EVENT_FULL%');

-- 댓글
insert into test.ids select 'cmtB', id::text from event_comments where author_id='bbbbbbbb-0000-0000-0000-000000000002' limit 1;
select test.eq('B edits own comment', test.affected($$update event_comments set body='수정됨' where id=(select v::uuid from test.ids where k='cmtB')$$), 1);
select test.eq('edited flag set', (select updated_at is not null from event_comments where id=(select v::uuid from test.ids where k='cmtB')), true);
select test.expect_error($$update event_comments set parent_id=null, event_id=event_id where id=(select v::uuid from test.ids where k='cmtB')$$, '%permission denied%');
select test.eq('B replies', test.affected($$insert into event_comments(event_id,author_id,body,parent_id) values ((select v::uuid from test.ids where k='v3grp'), auth.uid(), '답글', (select v::uuid from test.ids where k='cmtB'))$$), 1);
select test.expect_error($$insert into event_comments(event_id,author_id,body,parent_id) values ((select v::uuid from test.ids where k='v3grp'), auth.uid(), '답글의 답글', (select id from event_comments where parent_id is not null limit 1))$$, '%BAD_PARENT%');
select test.act('aaaaaaaa-0000-0000-0000-000000000001');
select test.eq('admin cannot edit others comment', test.affected($$update event_comments set body='관리자' where id=(select v::uuid from test.ids where k='cmtB')$$), 0);

-- 메모
select test.act('bbbbbbbb-0000-0000-0000-000000000002');
select test.eq('B writes shared note', test.affected($$insert into calendar_notes(calendar_id, body, updated_by) values ((select v::uuid from test.ids where k='v3cal'), '공용', auth.uid())$$), 1);
select test.expect_error($$update calendar_notes set body='위장', updated_by='aaaaaaaa-0000-0000-0000-000000000001'$$, '%row-level security%');
select test.eq('B writes personal note', test.affected($$insert into personal_notes(calendar_id, user_id, body) values ((select v::uuid from test.ids where k='v3cal'), auth.uid(), '비밀')$$), 1);
select test.act('aaaaaaaa-0000-0000-0000-000000000001');
select test.eq('A edits shared note', test.affected($$update calendar_notes set body='공용2', updated_by=auth.uid()$$), 1);
select test.eq('A cannot read B personal note', (select count(*) from personal_notes), 0::bigint);
select test.act('cccccccc-0000-0000-0000-000000000003');
select test.eq('outsider cannot read shared note', (select count(*) from calendar_notes), 0::bigint);
select test.expect_error($$insert into personal_notes(calendar_id, user_id, body) values ((select v::uuid from test.ids where k='v3cal'), auth.uid(), 'x')$$, '%');

-- 사진 저장소
select test.act('aaaaaaaa-0000-0000-0000-000000000001');
select test.eq('admin uploads event image', test.affected($$insert into storage.objects(bucket_id, name) values ('event-images', (select v from test.ids where k='v3cal') || '/11111111-1111-1111-1111-111111111111.jpg')$$), 1);
select test.expect_error($$insert into storage.objects(bucket_id, name) values ('event-images', 'not-a-uuid/x.jpg')$$, '%row-level security%');
select test.act('bbbbbbbb-0000-0000-0000-000000000002');
select test.expect_error($$insert into storage.objects(bucket_id, name) values ('event-images', (select v from test.ids where k='v3cal') || '/22222222-1111-1111-1111-111111111111.jpg')$$, '%row-level security%');
select test.eq('member reads event image', (select count(*) from storage.objects where bucket_id='event-images'), 1::bigint);
select test.act('cccccccc-0000-0000-0000-000000000003');
select test.eq('outsider cannot read event image', (select count(*) from storage.objects where bucket_id='event-images'), 0::bigint);

-- 초대코드 대입 방지
select test.eq('wrong code returns null', join_calendar('ZZZZZZ') is null, true);
select join_calendar('ZZZZZZ') from generate_series(1, 8);
select test.eq('10th wrong code still null', join_calendar('ZZZZZY') is null, true);
select test.expect_error($$select join_calendar('ZZZZZX')$$, '%TOO_MANY_ATTEMPTS%');
select test.expect_error($$select * from preview_calendar('ZZZZZX')$$, '%TOO_MANY_ATTEMPTS%');
select test.expect_error($$select * from join_attempts$$, '%permission denied%');
select test.act('aaaaaaaa-0000-0000-0000-000000000001');
select test.eq('other users not throttled', (select count(*) from preview_calendar((select v from test.ids where k='v3code'))), 1::bigint);

-- ===== v0.7: 공지에 전체 일정 태그 =====
select test.act('aaaaaaaa-0000-0000-0000-000000000001');
select test.eq('admin tags group event on notice', test.affected($$update announcements set event_id=(select v::uuid from test.ids where k='v3grp')$$), 1);
select test.expect_error($$update announcements set event_id=(select id from events where title='주간 스터디')$$, '%BAD_EVENT_TAG%');
select test.expect_error($$update announcements set calendar_id=calendar_id, author_id='bbbbbbbb-0000-0000-0000-000000000002'$$, '%permission denied%');
select test.act('bbbbbbbb-0000-0000-0000-000000000002');
select test.eq('member cannot retag', test.affected($$update announcements set event_id=null$$), 0);
select test.act('aaaaaaaa-0000-0000-0000-000000000001');

-- ===== v0.8: 보안 보강 =====
reset role;
set role anon;
select test.expect_error($$select count(*) from public.events$$, '%permission denied%');
select test.expect_error($$select public.preview_calendar('ABCDEF')$$, '%permission denied%');
reset role;
set role authenticated;
select test.act('bbbbbbbb-0000-0000-0000-000000000002');
select test.expect_error($$truncate public.events$$, '%permission denied%');
select test.expect_error($$select public.check_capacity()$$, '%permission denied%');
select test.expect_error($$update profiles set recent_colors=array['red'] where id=auth.uid()$$, '%profiles_recent_colors_ok%');
select test.expect_error($$insert into events(calendar_id, author_id, title, start_date, end_date, link_url) values ((select v::uuid from test.ids where k='v3cal'), auth.uid(), 'x', '2026-12-01', '2026-12-01', 'javascript:alert(1)')$$, '%events_link_scheme%');
select test.expect_error($$update events set body_rich='[]'::jsonb where author_id=auth.uid()$$, '%permission denied%');
select test.expect_error($$update calendar_notes set calendar_id=calendar_id$$, '%permission denied%');
select test.expect_error($$update calendars set description='x'$$, '%permission denied%');
-- 댓글 도배 제한: 1분에 20개
select test.expect_error($$insert into event_comments(event_id, author_id, body) select (select v::uuid from test.ids where k='v3grp'), auth.uid(), 'spam ' || g from generate_series(1, 25) g$$, '%TOO_FAST%');
-- Presence 비공개 채널
select set_config('realtime.topic', 'presence:' || (select v from test.ids where k='v3cal'), false);
select test.eq('member can send presence', test.affected($$insert into realtime.messages(topic, extension, payload) values (realtime.topic(), 'presence', '{}')$$), 1);
select test.eq('member reads presence', (select count(*) from realtime.messages), 1::bigint);
select test.act('cccccccc-0000-0000-0000-000000000003');
select test.eq('outsider reads no presence', (select count(*) from realtime.messages), 0::bigint);
select test.expect_error($$insert into realtime.messages(topic, extension, payload) values (realtime.topic(), 'presence', '{}')$$, '%row-level security%');
select set_config('realtime.topic', 'presence:not-a-uuid', false);
select test.expect_error($$insert into realtime.messages(topic, extension, payload) values (realtime.topic(), 'presence', '{}')$$, '%row-level security%');
select test.act('aaaaaaaa-0000-0000-0000-000000000001');

-- 멤버 B 가 계정 삭제 → 멤버십·댓글·참여가 사라지고 A 의 캘린더는 남는다
select test.act('bbbbbbbb-0000-0000-0000-000000000002');
select delete_my_account();
reset role;
select test.eq('B comments removed', (select count(*) from event_comments), 0::bigint);
select test.eq('B participation removed', (select count(*) from event_participants where user_id='bbbbbbbb-0000-0000-0000-000000000002'), 0::bigint);
select test.eq('B auth user removed', (select count(*) from auth.users where id='bbbbbbbb-0000-0000-0000-000000000002'), 0::bigint);
select test.eq('v3 calendar survives', (select count(*) from calendars where id=(select v::uuid from test.ids where k='v3cal')), 1::bigint);

-- 마지막 멤버 A 가 계정 삭제 → 혼자 남은 캘린더는 함께 사라진다
set role authenticated;
select test.act('aaaaaaaa-0000-0000-0000-000000000001');
select delete_my_account();
reset role;
select test.eq('A auth user removed', (select count(*) from auth.users where id='aaaaaaaa-0000-0000-0000-000000000001'), 0::bigint);
select test.eq('v3 calendar removed with last member', (select count(*) from calendars where id=(select v::uuid from test.ids where k='v3cal')), 0::bigint);
select test.eq('no orphan events', (select count(*) from events), 0::bigint);

select test.eq('realtime tables', (select count(*) from pg_publication_tables where pubname='supabase_realtime'), 8::bigint);
select test.eq('no notice left after calendar removal', (select count(*) from announcements), 0::bigint);
\echo ALL TESTS PASSED
