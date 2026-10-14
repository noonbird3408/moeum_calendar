// 외부 링크 미리보기 카드 (YouTube·X 는 제목/작성자/썸네일, 그 밖은 주소 카드)
import { useEffect, useState } from 'react';
import { previewLink, type LinkInfo } from '@/lib/links';
import { Icon } from '@/ui/Icon';

export function LinkPreview({ url }: { url: string }) {
  const [info, setInfo] = useState<LinkInfo | null>(null);

  useEffect(() => {
    let alive = true;
    previewLink(url).then((i) => alive && setInfo(i));
    return () => {
      alive = false;
    };
  }, [url]);

  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  })();

  return (
    <a className="link-card" href={url} target="_blank" rel="noopener noreferrer nofollow">
      {info?.kind === 'youtube' && info.thumb && <img className="link-thumb" src={info.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" />}
      <span className="link-body">
        <span className="link-host">
          <Icon name="link" size={14} /> {info?.kind === 'youtube' ? 'YouTube' : info?.kind === 'x' ? 'X' : host}
        </span>
        <span className="link-title">{info && info.kind !== 'site' ? info.title : url}</span>
        {info && info.kind !== 'site' && info.author && <span className="link-author">{info.author}</span>}
      </span>
    </a>
  );
}
