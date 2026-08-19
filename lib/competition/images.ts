/** 富文本里唯一能长期保存的图片地址：上传后由 /api/competition/media 提供。 */
const storedImagePath = /^\/api\/competition\/media\/\d+$/;

/** 编辑器允许上传、服务端也接受的图片类型。 */
export const uploadableImageTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
]);

export function isStoredImagePath(src: string): boolean {
  return storedImagePath.test(src);
}

/**
 * 解析粘贴内容里内联的 base64 图片，返回可以直接上传的原始数据。
 * 不认识的格式返回 null，交由调用方丢弃。
 */
export function inlineImageData(src: string): { mimeType: string; extension: string; base64: string } | null {
  const match = /^data:(image\/[a-z+.-]+);base64,([\s\S]*)$/i.exec(src.trim());
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  const extension = uploadableImageTypes.get(mimeType);
  const base64 = match[2].replace(/\s+/g, "");
  if (!extension || base64.length === 0) return null;
  return { mimeType, extension, base64 };
}
