// 프로필 사진: 브라우저에서 정사각형(256px)으로 줄인 뒤 본인 폴더(<uid>/)에 업로드한다.
import { supabase } from './supabase';

const SIZE = 256;

export async function resizeToSquare(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const sx = (bmp.width - side) / 2;
  const sy = (bmp.height - side) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('이미지를 처리할 수 없어요.');
  ctx.drawImage(bmp, sx, sy, side, side, 0, 0, SIZE, SIZE);
  bmp.close?.();
  return new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('이미지를 저장할 수 없어요.'))), 'image/jpeg', 0.9),
  );
}

/** 새 사진을 올리고 공개 URL 을 돌려준다 (캐시 방지를 위해 파일 이름마다 시각을 넣는다) */
export async function uploadAvatar(uid: string, file: File): Promise<string> {
  const blob = await resizeToSquare(file);
  const path = `${uid}/${crypto.randomUUID()}.jpg`; // 무작위 이름: 주소를 짐작해서 볼 수 없게
  const { error } = await supabase.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;
  return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
}

/** 내 폴더의 사진 파일을 모두 지운다 (계정 삭제 전에 호출) */
export async function removeMyAvatars(uid: string) {
  const { data } = await supabase.storage.from('avatars').list(uid, { limit: 100 });
  const paths = (data ?? []).map((f) => `${uid}/${f.name}`);
  if (paths.length) await supabase.storage.from('avatars').remove(paths);
}
