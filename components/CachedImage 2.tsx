import React, { useEffect, useRef, useState } from 'react';
import { backfillBlobByKey, getCachedBlobUrlByKey } from '../services/imageCache';

// Drop-in replacement for `<img>` that survives the remote URL going dark.
//
// Two failure modes we care about:
//   1. Network blocks the host (VPN / corp proxy / Firebase Storage outage).
//      Default `<img>` shows broken state with no recovery path.
//   2. Cold-cache reload while offline. Same outcome.
//
// Strategy:
//   - If the remote `src` succeeds, browse it as normal AND opportunistically
//     cache it via `backfillBlobByKey` so future reloads have a local copy.
//   - If the remote `src` errors, swap to a `blob:` URL produced from
//     IndexedDB. If nothing is cached yet, fall back to the consumer's
//     `onError` handler (or render nothing further).
//
// `cacheKey` MUST be a stable identifier for this asset (e.g.
// `buildProfileImageCacheKey(userId)`) so different views see the same blob.
export interface CachedImageProps
  extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src?: string | null;
  fallbackSrc?: string | null;
  fallback?: React.ReactNode;
  cacheKey: string;
}

export const CachedImage: React.FC<CachedImageProps> = ({
  src,
  fallbackSrc,
  fallback = null,
  cacheKey,
  onError,
  ...rest
}) => {
  const [renderSrc, setRenderSrc] = useState<string | undefined>(src ?? fallbackSrc ?? undefined);
  const [failed, setFailed] = useState(false);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    setFailed(false);
    setRenderSrc(src ?? fallbackSrc ?? undefined);
    if (src && /^https?:/i.test(src)) {
      void backfillBlobByKey(cacheKey, src);
    }
  }, [src, fallbackSrc, cacheKey]);

  useEffect(() => () => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  const handleError = async (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    // A stale/corrupt blob can fail too. If an inline fallback exists, try it
    // before giving up to the caller's fallback node.
    if (renderSrc?.startsWith('blob:')) {
      if (fallbackSrc && renderSrc !== fallbackSrc) {
        setRenderSrc(fallbackSrc);
        return;
      }
      setFailed(true);
      onError?.(e);
      return;
    }
    try {
      const cachedBlobUrl = await getCachedBlobUrlByKey(cacheKey);
      if (cachedBlobUrl) {
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = cachedBlobUrl;
        setRenderSrc(cachedBlobUrl);
        return;
      }
    } catch {
      // Swallow — falling through to the consumer's onError below.
    }
    if (fallbackSrc && renderSrc !== fallbackSrc) {
      setRenderSrc(fallbackSrc);
      return;
    }
    setFailed(true);
    onError?.(e);
  };

  if (!renderSrc || failed) return <>{fallback}</>;

  return <img src={renderSrc} onError={handleError} {...rest} />;
};
