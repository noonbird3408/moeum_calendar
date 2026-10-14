export type Role = 'admin' | 'member';

export type Profile = {
  id: string;
  nickname: string | null;
  color: string;
  avatar_url: string | null;
  recent_colors?: string[];
};

export type Calendar = {
  id: string;
  name: string;
  invite_code: string;
  group_color: string;
  owner_id: string;
  created_at: string;
};

export type Member = {
  calendar_id: string;
  user_id: string;
  role: Role;
  joined_at: string;
  profile: Profile | null;
};

export type CalendarEvent = {
  id: string;
  calendar_id: string;
  author_id: string;
  title: string;
  memo: string | null;
  is_group: boolean;
  is_recurring: boolean;
  start_date: string; // YYYY-MM-DD (반복 일정은 첫 날)
  end_date: string; // 반복 일정은 반복 종료일
  start_time: string | null; // HH:MM:SS, null = 하루종일
  end_time: string | null;
  repeat_weekdays: number[] | null; // 0(일)~6(토), 반복 일정만
  repeat_until: string | null;
  excluded_dates?: string[]; // 반복 일정에서 제외한 날짜
  link_url: string | null;
  image_paths?: string[]; // 전체 일정 사진 (event-images 버킷 경로)
  max_participants?: number | null; // 참여 정원 (전체 일정)
  sync_id?: string | null; // 메인에서 쓴 개인 일정: 캘린더마다 복사된 같은 일정끼리 같은 값
  event_dates?: string[] | null; // 떨어진 날짜로 만든 전체 일정: 진행하는 날짜 목록 (start_date~end_date 는 처음~마지막 날)
  created_at: string;
  updated_at: string;
  /** 화면에 펼쳐 놓은 회차의 날짜 (반복 일정을 날짜마다 펼칠 때만 채움) */
  occ?: string;
  /** 화면에 펼칠 때 보존하는 반복 일정의 실제 시작일 */
  series_start_date?: string;
};

export type EventInput = {
  title: string;
  memo: string | null;
  is_group: boolean;
  is_recurring: boolean;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  repeat_weekdays: number[] | null;
  repeat_until: string | null;
  excluded_dates?: string[];
  event_dates?: string[] | null;
  link_url: string | null;
  image_paths?: string[];
  max_participants?: number | null;
};

export type Participant = { user_id: string; profile: Profile | null };

export type Comment = {
  id: string;
  event_id: string;
  author_id: string;
  body: string;
  created_at: string;
  updated_at?: string | null; // 수정하면 채워진다
  parent_id?: string | null; // 답글이면 원 댓글 id
  author: Profile | null;
};

/** 캘린더 공지사항 (관리자만 작성) */
export type Announcement = {
  id: string;
  calendar_id: string;
  author_id: string;
  title: string;
  body: string; // 일반 텍스트
  body_html?: string | null; // 서식 본문 (그릴 때 sanitizeHtml 로 정리)
  event_id?: string | null; // 태그한 전체 일정
  created_at: string;
  updated_at: string;
  author?: Profile | null;
};
