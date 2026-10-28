import React, { useEffect, useRef, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { backfillBlobByKey, getCachedBlobUrlByKey, isImageMissing } from '../services/imageCache';

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
//     fallback node or a neutral missing-image placeholder.
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

const CachedImageContent: React.FC<CachedImageProps> = ({
  src,
  fallbackSrc,
  fallback,
  cacheKey,
  onError,
  ...rest
}) => {
  const [knownMissing] = useState(() => Boolean(src && isImageMissing(cacheKey, src)));
  const [renderSrc, setRenderSrc] = useState<string | undefined>(
    knownMissing ? undefined : src ?? fallbackSrc ?? undefined
  );
  const [failed, setFailed] = useState(false);
  const blobUrlRef = useRef<string | null>(null);
  const triedSources = useRef(new Set<string>());
  const triedCache = useRef(false);
  const active = useRef(true);
  const recovering = useRef(false);

  const recover = async (e?: React.SyntheticEvent<HTMLImageElement, Event>) => {
    if (recovering.current) return;
    recovering.current = true;
    try {
      if (renderSrc) {
        if (triedSources.current.has(renderSrc)) return;
        triedSources.current.add(renderSrc);
      }
      if (!triedCache.current) {
        triedCache.current = true;
        try {
          const cachedBlobUrl = await getCachedBlobUrlByKey(cacheKey);
          if (!active.current) {
            if (cachedBlobUrl) URL.revokeObjectURL(cachedBlobUrl);
            return;
          }
          if (cachedBlobUrl) {
            blobUrlRef.current = cachedBlobUrl;
            setRenderSrc(cachedBlobUrl);
            return;
          }
        } catch {
          // Continue to the inline fallback or placeholder.
        }
      }
      if (!active.current) return;
      if (fallbackSrc && !triedSources.current.has(fallbackSrc)) {
        setRenderSrc(fallbackSrc);
        return;
      }
      setFailed(true);
      if (e) onError?.(e);
    } finally {
      recovering.current = false;
    }
  };

  useEffect(() => {
    active.current = true;
    if (knownMissing) {
      if (src) triedSources.current.add(src);
      void recover();
    } else if (src && /^https?:/i.test(src)) {
      void backfillBlobByKey(cacheKey, src);
    }
    return () => {
      active.current = false;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  if (!renderSrc || failed) {
    return <>{fallback ?? (
      <span
        role="img"
        aria-label="Image unavailable"
        className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center bg-gray-100 text-slate-400 dark:bg-[#0d1117] ${rest.className || ''}`}
        style={rest.style}
      >
        <ImageOff size={20} aria-hidden="true" />
      </span>
    )}</>;
  }

  return <img src={renderSrc} onError={recover} {...rest} />;
};

// Reset recovery attempts and discard pending lookups when the source changes.
export const CachedImage: React.FC<CachedImageProps> = (props) => (
  <CachedImageContent key={JSON.stringify([props.cacheKey, props.src, props.fallbackSrc])} {...props} />
);
