-- =====================================================================
-- 008. v0.5 : 공지사항 서식 본문
--   · body_html : 글씨 크기·굵기·기울기·밑줄·형광펜·색·링크가 들어간 본문 (HTML)
--   · body      : 같은 내용의 일반 텍스트 (목록 미리보기·검색용)
--   화면에 보여 줄 때는 프론트엔드가 허용된 태그·스타일만 남기고 나머지는 지운다.
-- 여러 번 실행해도 안전합니다(멱등).
-- =====================================================================

alter table public.announcements add column if not exists body_html text;

alter table public.announcements drop constraint if exists announcements_body_html_len;
alter table public.announcements add constraint announcements_body_html_len
  check (body_html is null or char_length(body_html) <= 20000);
