// 전체 일정 사진: 비공개 버킷(event-images)에 '<calendar_id>/<uuid>.jpg' 로 올리고, 볼 때는 1시간짜리 서명 URL 을 쓴다.
// 올리기 전에 브라우저에서 긴 변을 1600px 로 줄이고 JPEG 로 다시 저장한다 (위치 정보 등 EXIF 도 이때 사라진다).
import { supabase } from './supabase';

const BUCKET = 'event-images';
const MAX_SIDE = 1600;
export const MAX_IMAGES = 4;
const MAX_INPUT = 20 * 1024 * 1024; // 고르기 전 원본 최대 20MB

async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('이미지를 처리할 수 없어요.');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('이미지를 저장할 수 없어요.'))), 'image/jpeg', 0.85));
}

export function checkImageFile(f: File): string | null {
  if (!/^image\/(jpeg|png|webp|gif)$/.test(f.type)) return 'JPG·PNG·WEBP 사진만 올릴 수 있어요.';
  if (f.size > MAX_INPUT) return '20MB 이하의 사진을 골라 주세요.';
  return null;
}

/** 사진 하나를 올리고 저장 경로를 돌려준다 */
export async function uploadEventImage(calendarId: string, file: File): Promise<string> {
  const blob = await shrink(file);
  const path = `${calendarId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;
  return path;
}

export async function removeEventImages(paths: string[]) {
  if (!paths.length) return;
  await supabase.storage.from(BUCKET).remove(paths);
}

/** 캘린더 폴더의 사진을 모두 지운다 (캘린더 삭제 전에 호출) */
/** 다른 일정이 아직 쓰고 있지 않은 사진만 지운다 (떨어진 날짜로 만든 전체 일정들은 같은 사진을 함께 쓴다) */
export async function removeUnusedEventImages(paths: string[]) {
  if (!paths.length) return;
  const { data } = await supabase.from('events').select('image_paths').overlaps('image_paths', paths);
  const used = new Set(((data ?? []) as { image_paths: string[] | null }[]).flatMap((r) => r.image_paths ?? []));
  const unused = paths.filter((p) => !used.has(p));
  if (unused.length) await removeEventImages(unused);
}

export async function removeCalendarImages(calendarId: string) {
  const { data } = await supabase.storage.from(BUCKET).list(calendarId, { limit: 1000 });
  const paths = (data ?? []).map((f: { name: string }) => `${calendarId}/${f.name}`);
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
}

const cache = new Map<string, { url: string; until: number }>();

/** 경로 → 서명 URL (50분 동안 재사용) */
export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  const now = Date.now();
  const out: Record<string, string> = {};
  const need = paths.filter((p) => {
    const hit = cache.get(p);
    if (hit && hit.until > now) {
      out[p] = hit.url;
      return false;
    }
    return true;
  });
  if (need.length) {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrls(need, 3600);
    (data ?? []).forEach((d: { path: string | null; signedUrl: string | null }) => {
      if (d.path && d.signedUrl) {
        out[d.path] = d.signedUrl;
        cache.set(d.path, { url: d.signedUrl, until: now + 50 * 60 * 1000 });
      }
    });
  }
  return out;
}
