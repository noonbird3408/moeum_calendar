// /join/:code — 공유 링크로 들어오면 자동 참여 후 캘린더로 이동
import { useEffect, useRef, useState } from 'react';
import { errorMessage, supabase } from '@/lib/supabase';
import { Link, useRouter } from '@/lib/router';
import { Splash } from '@/ui/controls';
import { useFeedback } from '@/ui/Feedback';

type Preview = { id: string; name: string; group_color: string; member_count: number; already_member: boolean };

export function JoinPage({ code }: { code: string }) {
  const { navigate } = useRouter();
  const { toast } = useFeedback();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // 개발 모드 StrictMode 중복 실행 방지
    started.current = true;
    (async () => {
      const { data, error: pErr } = await supabase.rpc('preview_calendar', { p_code: code });
      const preview = ((data ?? []) as Preview[])[0];
      if (pErr || !preview) {
        setError(pErr ? errorMessage(pErr) : '유효하지 않거나 만료된 초대코드예요.');
        return;
      }
      if (preview.already_member) {
        navigate(`/c/${preview.id}`, { replace: true });
        return;
      }
      const { data: id, error: jErr } = await supabase.rpc('join_calendar', { p_code: code });
      if (jErr || !id) {
        setError(jErr ? errorMessage(jErr) : '유효하지 않거나 만료된 초대코드예요.');
        return;
      }
      toast(`「${preview.name}」에 참여했어요.`, 'success');
      navigate(`/c/${id as string}`, { replace: true });
    })();
  }, [code, navigate, toast]);

  if (!error) return <Splash message="캘린더에 참여하는 중…" />;
  return (
    <main className="center-page">
      <div className="login-card">
        <h1>참여할 수 없어요</h1>
        <p className="muted">{error}</p>
        <p className="muted small">관리자에게 새 초대 링크를 받아 주세요.</p>
        <Link to="/" className="btn btn-primary">
          내 캘린더로
        </Link>
      </div>
    </main>
  );
}
