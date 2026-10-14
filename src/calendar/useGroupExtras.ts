// 단체 일정의 참여 멤버와 댓글 (실시간 반영)
import { useCallback, useEffect, useState } from 'react';
import { errorMessage, supabase } from '@/lib/supabase';
import type { Comment, Participant } from '@/types';

const uniq = () => Math.random().toString(36).slice(2, 8);

export function useGroupExtras(eventId: string | null, myId: string) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);

  const loadParticipants = useCallback(async () => {
    if (!eventId) return;
    const { data } = await supabase
      .from('event_participants')
      .select('user_id, profile:profiles(id, nickname, color, avatar_url)')
      .eq('event_id', eventId)
      .order('created_at');
    setParticipants((data ?? []) as unknown as Participant[]);
  }, [eventId]);

  const loadComments = useCallback(async () => {
    if (!eventId) return;
    const { data } = await supabase
      .from('event_comments')
      .select('id, event_id, author_id, body, created_at, updated_at, parent_id, author:profiles(id, nickname, color, avatar_url)')
      .eq('event_id', eventId)
      .order('created_at');
    setComments((data ?? []) as unknown as Comment[]);
  }, [eventId]);

  useEffect(() => {
    setParticipants([]);
    setComments([]);
    loadParticipants();
    loadComments();
    if (!eventId) return;
    const ch = supabase
      .channel(`extras:${eventId}:${uniq()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_participants', filter: `event_id=eq.${eventId}` }, () => loadParticipants())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_comments', filter: `event_id=eq.${eventId}` }, () => loadComments())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [eventId, loadParticipants, loadComments]);

  const joined = participants.some((p) => p.user_id === myId);

  const toggleJoin = async () => {
    if (!eventId) return;
    if (joined) {
      const { error } = await supabase.from('event_participants').delete().eq('event_id', eventId).eq('user_id', myId);
      if (error) throw new Error(errorMessage(error));
    } else {
      const { error } = await supabase.from('event_participants').insert({ event_id: eventId, user_id: myId });
      if (error) throw new Error(errorMessage(error));
    }
    await loadParticipants();
  };

  const addComment = async (body: string, parentId: string | null = null) => {
    if (!eventId) return;
    const { error } = await supabase.from('event_comments').insert({ event_id: eventId, author_id: myId, body, parent_id: parentId });
    if (error) throw new Error(errorMessage(error));
    await loadComments();
  };

  const editComment = async (id: string, body: string) => {
    const { data, error } = await supabase.from('event_comments').update({ body }).eq('id', id).select('id');
    if (error) throw new Error(errorMessage(error));
    if (!data?.length) throw new Error(errorMessage(new Error('NO_ROWS')));
    await loadComments();
  };

  const removeComment = async (id: string) => {
    const { error } = await supabase.from('event_comments').delete().eq('id', id);
    if (error) throw new Error(errorMessage(error));
    // 원 댓글을 지우면 답글도 함께 지워진다 (DB cascade)
    setComments((list) => list.filter((c) => c.id !== id && c.parent_id !== id));
  };

  return { participants, comments, joined, toggleJoin, addComment, editComment, removeComment, reloadParticipants: loadParticipants };
}
