import { storage } from './firebase';
import { ref, uploadBytes, getDownloadURL, listAll, deleteObject } from 'firebase/storage';
import { buildProfileImageCacheKey, cacheBlobByKey } from './imageCache';

const PROFILE_THUMBNAIL_SIZE = 96;
const PROFILE_THUMBNAIL_QUALITY = 0.82;
const PROFILE_THUMBNAIL_FETCH_TIMEOUT_MS = 12_000;

const extensionForMime = (mimeType: string): string => {
  const normalized = mimeType.toLowerCase();
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg';
  if (normalized === 'image/gif') return 'gif';
  if (normalized === 'image/svg+xml') return 'svg';
  return 'bin';
};

const stripDataUrlPrefix = (base64Data: string): string => {
  const match = base64Data.match(/^data:[^,]+,(.+)$/i);
  return (match ? match[1] : base64Data).replace(/\s+/g, '');
};

const base64ToBlob = (base64Data: string, mimeType: string): Blob => {
  const cleanBase64 = stripDataUrlPrefix(base64Data);
  const binary = atob(cleanBase64);
  const chunkSize = 8192;
  const chunks: Uint8Array[] = [];

  for (let offset = 0; offset < binary.length; offset += chunkSize) {
    const slice = binary.slice(offset, offset + chunkSize);
    const bytes = new Uint8Array(slice.length);
    for (let i = 0; i < slice.length; i += 1) {
      bytes[i] = slice.charCodeAt(i);
    }
    chunks.push(bytes);
  }

  return new Blob(chunks, { type: mimeType });
};

const loadImageElement = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Profile image could not be decoded.'));
    img.src = src;
  });

const createProfileThumbnailDataUrl = async (blob: Blob): Promise<string> => {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await loadImageElement(objectUrl);
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    const sourceSize = Math.min(sourceWidth, sourceHeight);
    if (!sourceSize) throw new Error('Profile image has no dimensions.');

    const canvas = document.createElement('canvas');
    canvas.width = PROFILE_THUMBNAIL_SIZE;
    canvas.height = PROFILE_THUMBNAIL_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context unavailable.');
    ctx.drawImage(
      image,
      Math.max(0, (sourceWidth - sourceSize) / 2),
      Math.max(0, (sourceHeight - sourceSize) / 2),
      sourceSize,
      sourceSize,
      0,
      0,
      PROFILE_THUMBNAIL_SIZE,
      PROFILE_THUMBNAIL_SIZE
    );
    return canvas.toDataURL('image/webp', PROFILE_THUMBNAIL_QUALITY);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

export const fetchProfileThumbnailDataUrl = async (imageUrl: string): Promise<string | null> => {
  if (!imageUrl || !/^https?:/i.test(imageUrl)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROFILE_THUMBNAIL_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(imageUrl, {
      signal: controller.signal,
      mode: 'cors',
      credentials: 'omit'
    });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!blob.size || !blob.type.startsWith('image/')) return null;
    return await createProfileThumbnailDataUrl(blob);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

export interface UploadedGenerationImage {
  path: string;
  downloadUrl: string;
  size: number;
}

export interface UploadedProfileImage {
  downloadUrl: string;
  thumbnailDataUrl: string;
}

export const uploadProfileImage = async (file: File, userId: string): Promise<UploadedProfileImage> => {
  // Validate file type
  if (!file.type.startsWith('image/')) {
    throw new Error('Please upload an image file (JPEG, PNG, etc.)');
  }

  // Validate file size (max 2MB for profile photos)
  if (file.size > 2 * 1024 * 1024) {
    throw new Error('Image size must be less than 2MB');
  }

  try {
    const thumbnailDataUrl = await createProfileThumbnailDataUrl(file);

    // Create a storage reference: users/{userId}/profile.jpg
    // We use a fixed name so it overwrites the old one automatically
    const fileExtension = file.name.split('.').pop() || 'jpg';
    const storageRef = ref(storage, `users/${userId}/profile.${fileExtension}`);

    // Upload the file
    // Add a timeout to preventing hanging if storage is unreachable
    const uploadPromise = uploadBytes(storageRef, file);
    const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Upload timed out. Check your network or storage config.")), 15000)
    );
    
    await Promise.race([uploadPromise, timeoutPromise]);

    // Get the download URL
    const downloadURL = await getDownloadURL(storageRef);

    // Seed the IndexedDB cache with the original file blob so the avatar
    // still renders when Firebase Storage is unreachable (VPN, corp proxy,
    // etc.). We already have the bytes locally — no point re-fetching them.
    await cacheBlobByKey(buildProfileImageCacheKey(userId), file);

    return { downloadUrl: downloadURL, thumbnailDataUrl };
  } catch (error: any) {
    console.error("Error uploading image:", error);
    if (error.code === 'storage/unauthorized') {
      throw new Error("Permission denied. Please check your Storage Security Rules.");
    } else if (error.code === 'storage/canceled') {
      throw new Error("Upload canceled.");
    } else if (error.code === 'storage/unknown') {
       throw new Error("Unknown error occurred, inspect error.serverResponse");
    }
    throw new Error(error.message || "Failed to upload image. Please try again.");
  }
};

export const uploadGenerationImage = async ({
  userId,
  generationId,
  versionId,
  base64Data,
  mimeType,
}: {
  userId: string;
  generationId: string;
  versionId: string;
  base64Data: string;
  mimeType: string;
}): Promise<UploadedGenerationImage> => {
  if (!base64Data?.trim()) {
    throw new Error('No image data available to upload.');
  }

  const safeMimeType = mimeType || 'image/webp';
  const extension = extensionForMime(safeMimeType);
  const path = `users/${userId}/history/${generationId}/${versionId}.${extension}`;
  const blob = base64ToBlob(base64Data, safeMimeType);
  const storageRef = ref(storage, path);

  try {
    await uploadBytes(storageRef, blob, {
      contentType: safeMimeType,
      customMetadata: {
        generationId,
        versionId,
      },
    });
    const downloadUrl = await getDownloadURL(storageRef);
    return { path, downloadUrl, size: blob.size };
  } catch (error: any) {
    // VPN / corporate proxy / captive portal commonly blocks
    // `firebasestorage.googleapis.com` outright. The retry layer surfaces this
    // as `storage/retry-limit-exceeded` after several `net::ERR_NAME_NOT_RESOLVED`
    // attempts. The IndexedDB cache (seeded BEFORE this call by
    // `serializeGenerationForRemote`) still has the bytes, and `saveGeneration`
    // falls back to localStorage for the metadata — so this is a handled state,
    // not a fatal one. Downgrade to a clearly-labeled warning so the console
    // isn't full of red while the app is still working as designed.
    const code: string | undefined = error?.code;
    const message: string = error?.message || '';
    const looksLikeNetworkBlock =
      code === 'storage/retry-limit-exceeded' ||
      code === 'storage/unknown' ||
      code === 'storage/server-file-wrong-size' ||
      /ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|Network error|Failed to fetch|retry-limit-exceeded/i.test(
        message
      );

    if (looksLikeNetworkBlock) {
      console.warn(
        '[Storage unreachable] Generated image stayed in IndexedDB cache; metadata kept in local history. ' +
          'Often caused by VPN/proxy blocking firebasestorage.googleapis.com. See CLAUDE.md.',
        { generationId, versionId, code, message }
      );
      throw new Error(
        'Network blocked Firebase Storage. Image is cached locally; sign in off-VPN to sync to the cloud.'
      );
    }

    console.error('Error uploading generation image:', error);
    if (code === 'storage/unauthorized') {
      throw new Error('Permission denied syncing generated image. Please check your Storage Security Rules.');
    }
    throw new Error(message || 'Failed to sync generated image to cloud storage.');
  }
};

export const deleteGenerationImages = async (userId: string, generationId: string): Promise<void> => {
  try {
    const folderRef = ref(storage, `users/${userId}/history/${generationId}`);
    const listed = await listAll(folderRef);
    await Promise.all(
      listed.items.map((itemRef) =>
        deleteObject(itemRef).catch((error) => {
          console.warn('Failed to delete generated image from storage:', itemRef.fullPath, error);
        })
      )
    );
  } catch (error) {
    console.warn('Failed to list generated images for deletion:', error);
  }
};
