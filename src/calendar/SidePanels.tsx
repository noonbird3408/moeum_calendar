// 캘린더 옆 패널: 멤버 목록(접속 상태). 나 → 관리자 → 나머지 순, 5명을 넘으면 +more 로 전체 보기
import { useState } from 'react';
import type { Member } from '@/types';
import { Avatar } from '@/ui/Avatar';
import { Icon } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';

const ONLINE = '#16a34a';
const OFFLINE = '#9aa1ac';
const PREVIEW = 5;

/** 나를 맨 위, 다음 관리자, 다음 접속 중, 그다음 이름순 */
export function orderMembers(members: Member[], myId: string, online: Set<string>) {
  return [...members].sort(
    (a, b) =>
      Number(b.user_id === myId) - Number(a.user_id === myId) ||
      Number(b.role === 'admin') - Number(a.role === 'admin') ||
      Number(online.has(b.user_id)) - Number(online.has(a.user_id)) ||
      (a.profile?.nickname ?? '').localeCompare(b.profile?.nickname ?? ''),
  );
}

function MemberRow({ m, myId, online }: { m: Member; myId: string; online: Set<string> }) {
  const isOn = online.has(m.user_id);
  return (
    <li className={`mini-row ${m.user_id === myId ? 'is-me' : ''}`}>
      <span className="online-dot" style={{ background: isOn ? ONLINE : OFFLINE }} role="img" aria-label={isOn ? '접속 중' : '접속 안 함'} />
      <Avatar profile={m.profile} size={24} />
      <span className="mini-name">
        {m.profile?.nickname ?? '(알 수 없음)'}
        {m.user_id === myId && <span className="muted small"> (나)</span>}
      </span>
      {m.role === 'admin' && <span className="badge badge-admin">관리자</span>}
    </li>
  );
}

export function MembersPanel({
  members,
  myId,
  online,
  isAdmin,
  onManage,
}: {
  members: Member[];
  myId: string;
  online: Set<string>;
  isAdmin: boolean;
  onManage: () => void;
}) {
  const [allOpen, setAllOpen] = useState(false);
  const sorted = orderMembers(members, myId, online);
  const shown = sorted.slice(0, PREVIEW);
  const rest = sorted.length - shown.length;
  const onlineCount = members.filter((m) => online.has(m.user_id)).length;

  return (
    <section className="panel members-panel" aria-label="멤버 목록">
      <header className="panel-head">
        <h2>멤버 목록</h2>
        <span className="online-count">
          <span className="online-dot on" aria-hidden="true" /> {onlineCount}
          <span className="muted"> / {members.length}명</span>
        </span>
      </header>
      <ul className="member-mini">
        {shown.map((m) => (
          <MemberRow key={m.user_id} m={m} myId={myId} online={online} />
        ))}
      </ul>
      {rest > 0 && (
        <button type="button" className="more-members" onClick={() => setAllOpen(true)} aria-label={`멤버 ${rest}명 더 보기`}>
          +{rest} more
        </button>
      )}
      {isAdmin && (
        <button type="button" className="btn btn-ghost btn-small btn-block" onClick={onManage}>
          <Icon name="users" size={16} /> 멤버 관리
        </button>
      )}

      <Sheet open={allOpen} onClose={() => setAllOpen(false)} title={`멤버 ${members.length}명`} size="sm">
        <ul className="member-mini member-all">
          {sorted.map((m) => (
            <MemberRow key={m.user_id} m={m} myId={myId} online={online} />
          ))}
        </ul>
      </Sheet>
    </section>
  );
}
