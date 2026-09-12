/**
 * Client-only helper: shrinks a user-picked image file down to a compressed JPEG data URL small
 * enough to store directly as a Firestore string field (SaaS roadmap Phase 3 — bank-transfer
 * slip uploads and the superadmin's QR code upload). This codebase has no Cloud Storage/file-
 * upload infrastructure at all (confirmed during Phase 3 planning) — for something this small
 * and this infrequent (a handful of images a month, not per-order), adding a Storage bucket +
 * its own security rules + its own deploy step was worse than just keeping the image inline.
 *
 * Firestore's per-document limit is 1 MiB; base64 adds ~37% overhead on top of the binary size.
 * `MAX_DATA_URL_LENGTH` (900,000 chars ≈ 660 KB binary) leaves comfortable headroom for the
 * document's other fields. `compressImageFile` downscales to `maxDimensionPx` and then walks
 * JPEG quality down in steps until the result fits, throwing a Thai-language error only if even
 * the lowest quality still doesn't fit (an extremely large/detailed source photo).
 */
export const MAX_DATA_URL_LENGTH = 900_000;

async function loadImage(file: File): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("ไม่สามารถอ่านไฟล์รูปภาพนี้ได้"));
    });
    img.src = objectUrl;
    await loaded;
    return img;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function compressImageFile(file: File, maxDimensionPx = 1280): Promise<string> {
  const img = await loadImage(file);
  const scale = Math.min(1, maxDimensionPx / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("เบราว์เซอร์นี้ไม่รองรับการย่อรูปภาพ");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  for (const quality of [0.7, 0.5, 0.35, 0.2]) {
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (dataUrl.length <= MAX_DATA_URL_LENGTH) return dataUrl;
  }
  throw new Error("ไฟล์รูปภาพใหญ่เกินไป กรุณาถ่ายใหม่หรือเลือกรูปอื่น");
}
