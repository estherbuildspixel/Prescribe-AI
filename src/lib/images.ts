export const MAX_IMAGES = 4;
export const MAX_IMAGE_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_BASE64_LENGTH = 14 * 1024 * 1024;
export const MAX_IMAGE_TOTAL_BASE64_LENGTH = 24 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 1600;

export const IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export const IMAGE_ACCEPT = IMAGE_MIME_TYPES.join(",");

export type ChatImage = {
  mimeType: string;
  data: string;
};

export function isAllowedImageMimeType(value: string): boolean {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

export function toDataUrl(image: ChatImage): string {
  return `data:${image.mimeType};base64,${image.data}`;
}

export type ImageLimits = {
  maxImages?: number;
  maxBytes?: number;
  maxTotalBytes?: number;
};

export function parseChatImages(value: unknown, limits: ImageLimits = {}): ChatImage[] {
  if (!Array.isArray(value)) return [];
  const maxImages = limits.maxImages ?? Infinity;
  const maxBytes = limits.maxBytes ?? Infinity;
  const maxTotalBytes = limits.maxTotalBytes ?? Infinity;
  const images: ChatImage[] = [];
  let total = 0;

  for (const item of value) {
    if (images.length >= maxImages) break;
    if (!item || typeof item !== "object") continue;
    const { mimeType, data } = item as { mimeType?: unknown; data?: unknown };
    if (typeof mimeType !== "string" || !isAllowedImageMimeType(mimeType)) continue;
    if (typeof data !== "string" || data.length === 0 || data.length > maxBytes) continue;
    total += data.length;
    if (total > maxTotalBytes) break;
    images.push({ mimeType, data });
  }

  return images;
}

export function parseStoredImages(value: unknown): ChatImage[] {
  return parseChatImages(value);
}
