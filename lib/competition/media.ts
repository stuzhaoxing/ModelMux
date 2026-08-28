import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import Busboy from "busboy";
import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { competitionPool, ensureCompetitionSchema, rows } from "./db";
import type { CompetitionRole } from "./types";

const allowedImageTypes = new Map([
  ["image/jpeg", { extension: "jpg", signatures: [[0xff, 0xd8, 0xff]] }],
  ["image/png", { extension: "png", signatures: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]] }],
  ["image/gif", { extension: "gif", signatures: [[0x47, 0x49, 0x46, 0x38, 0x37, 0x61], [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]] }],
  ["image/webp", { extension: "webp", signatures: [[0x52, 0x49, 0x46, 0x46]] }],
]);

export type MediaKind = "image" | "file";

interface AttachmentRow extends RowDataPacket {
  uploader_id: number | null;
  uploader_role: CompetitionRole;
  purpose: "question" | "answer";
  kind: MediaKind;
  storage_name: string;
  original_name: string;
  mime_type: string;
  byte_size: string;
}

export interface PendingMediaUpload {
  purpose: "question" | "answer";
  kind: MediaKind;
  storageName: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
}

type DiskUploadResult =
  | { upload: Omit<PendingMediaUpload, "purpose">; error?: never }
  | { upload?: never; error: unknown };

function dataDirectory(): string {
  const configured = process.env.MODELMUX_DATA_DIR?.trim();
  return configured
    ? path.resolve(/* turbopackIgnore: true */ configured)
    : path.join(process.cwd(), ".modelmux-data");
}

function signatureMatches(buffer: Buffer, mimeType: string): boolean {
  const config = allowedImageTypes.get(mimeType);
  if (!config) return false;
  if (mimeType === "image/webp") {
    return config.signatures.some((signature) => signature.every((value, index) => buffer[index] === value))
      && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  }
  return config.signatures.some((signature) => signature.every((value, index) => buffer[index] === value));
}

function uploadPath(storageName: string): string {
  return path.join(dataDirectory(), "uploads", storageName);
}

function safeOriginalName(filename: string): string {
  const basename = path.basename(filename.replaceAll("\\", "/")).trim() || "未命名附件";
  return Array.from(basename).slice(0, 255).join("");
}

function safeMimeType(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase();
  if (normalized.length > 80 || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+*-]+$/.test(normalized)) {
    return "application/octet-stream";
  }
  return normalized;
}

export async function receiveMediaUpload(request: Request): Promise<PendingMediaUpload> {
  if (!request.body) throw new Error("missing_file");

  let parser: ReturnType<typeof Busboy>;
  try {
    parser = Busboy({
      headers: Object.fromEntries(request.headers),
      defParamCharset: "utf8",
      limits: { fields: 5, files: 1, parts: 6, fieldSize: 64 * 1024 },
    });
  } catch {
    throw new Error("invalid_multipart");
  }

  const uploadDirectory = path.join(dataDirectory(), "uploads");
  await mkdir(uploadDirectory, { recursive: true, mode: 0o700 });

  let purpose: PendingMediaUpload["purpose"] | null = null;
  let kind: MediaKind | null = null;
  let fileSeen = false;
  let parseError: Error | null = null;
  const uploadState: { promise: Promise<DiskUploadResult> | null } = { promise: null };

  parser.on("field", (name, value) => {
    if (name === "purpose") {
      if (value === "question" || value === "answer") purpose = value;
      else parseError ??= new Error("invalid_media_purpose");
    }
    if (name === "kind") {
      if (value === "image" || value === "file") kind = value;
      else parseError ??= new Error("invalid_media_kind");
    }
  });

  parser.on("file", (fieldName, file, info) => {
    if (fileSeen || fieldName !== "file") {
      parseError ??= new Error("invalid_file_count");
      file.resume();
      return;
    }
    fileSeen = true;
    const uploadKind = kind;
    if (!uploadKind) {
      parseError ??= new Error("invalid_media_kind");
      file.resume();
      return;
    }

    const mimeType = safeMimeType(info.mimeType);
    const imageConfig = allowedImageTypes.get(mimeType);
    if (uploadKind === "image" && !imageConfig) {
      parseError ??= new Error("unsupported_image");
      file.resume();
      return;
    }

    const extension = uploadKind === "image" ? imageConfig!.extension : "upload";
    const storageName = `${Date.now()}-${randomBytes(16).toString("hex")}.${extension}`;
    const filePath = uploadPath(storageName);
    let byteSize = 0;
    let prefix = Buffer.alloc(0);
    const inspect = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        byteSize += chunk.byteLength;
        if (prefix.byteLength < 12) {
          prefix = Buffer.concat([prefix, chunk.subarray(0, 12 - prefix.byteLength)]);
        }
        callback(null, chunk);
      },
    });

    uploadState.promise = pipeline(
      file,
      inspect,
      createWriteStream(filePath, { flags: "wx", mode: 0o600 }),
    )
      .then(() => {
        if (uploadKind === "image" && byteSize === 0) throw new Error("empty_image");
        if (uploadKind === "image" && !signatureMatches(prefix, mimeType)) throw new Error("invalid_image");
        return {
          upload: {
            kind: uploadKind,
            storageName,
            originalName: safeOriginalName(info.filename),
            mimeType,
            byteSize,
          },
        };
      })
      .catch(async (error) => {
        await unlink(filePath).catch(() => undefined);
        return { error };
      });
  });

  parser.on("filesLimit", () => {
    parseError ??= new Error("invalid_file_count");
  });
  parser.on("fieldsLimit", () => {
    parseError ??= new Error("invalid_multipart");
  });
  parser.on("partsLimit", () => {
    parseError ??= new Error("invalid_multipart");
  });

  let uploaded: Omit<PendingMediaUpload, "purpose"> | null = null;
  try {
    let streamError: unknown = null;
    try {
      await pipeline(
        Readable.fromWeb(request.body as unknown as NodeReadableStream<Uint8Array>),
        parser,
      );
    } catch (error) {
      streamError = error;
    }

    const diskResult = uploadState.promise ? await uploadState.promise : null;
    if (diskResult?.upload) uploaded = diskResult.upload;
    if (diskResult?.error) throw diskResult.error;
    if (streamError) throw streamError;
    if (parseError) throw parseError;
    if (!purpose) throw new Error("invalid_media_purpose");
    if (!kind) throw new Error("invalid_media_kind");
    if (!uploaded) throw new Error("missing_file");
    return { purpose, ...uploaded };
  } catch (error) {
    if (uploaded) await unlink(uploadPath(uploaded.storageName)).catch(() => undefined);
    throw error;
  }
}

export async function discardMediaUpload(upload: PendingMediaUpload): Promise<void> {
  await unlink(uploadPath(upload.storageName)).catch(() => undefined);
}

export async function registerMediaUpload(input: {
  upload: PendingMediaUpload;
  uploaderId: number | null;
  uploaderRole: CompetitionRole;
}): Promise<{
  id: number;
  url: string;
  kind: MediaKind;
  originalName: string;
  mimeType: string;
  byteSize: number;
}> {
  try {
    await ensureCompetitionSchema();
    const [result] = await competitionPool().execute<ResultSetHeader>(
      `INSERT INTO competition_attachments
        (uploader_id, uploader_role, purpose, kind, storage_name, original_name, mime_type, byte_size)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.uploaderId,
        input.uploaderRole,
        input.upload.purpose,
        input.upload.kind,
        input.upload.storageName,
        input.upload.originalName,
        input.upload.mimeType,
        input.upload.byteSize,
      ],
    );
    const id = Number(result.insertId);
    return {
      id,
      url: `/api/competition/media/${id}`,
      kind: input.upload.kind,
      originalName: input.upload.originalName,
      mimeType: input.upload.mimeType,
      byteSize: input.upload.byteSize,
    };
  } catch (error) {
    await discardMediaUpload(input.upload);
    throw error;
  }
}

export async function readMedia(id: number): Promise<{
  stream: NodeReadableStream;
  mimeType: string;
  originalName: string;
  byteSize: string;
  kind: MediaKind;
  uploaderId: number | null;
  uploaderRole: CompetitionRole;
  purpose: "question" | "answer";
} | null> {
  const result = await rows<AttachmentRow[]>(
    `SELECT uploader_id, uploader_role, purpose, kind, storage_name, original_name, mime_type,
            CAST(byte_size AS CHAR) AS byte_size
     FROM competition_attachments WHERE id = ? LIMIT 1`,
    [id],
  );
  const record = result[0];
  if (!record) return null;
  const uploadDirectory = path.join(dataDirectory(), "uploads");
  const filePath = path.resolve(uploadDirectory, record.storage_name);
  if (!filePath.startsWith(`${path.resolve(uploadDirectory)}${path.sep}`)) return null;
  try {
    const file = await open(filePath, "r");
    return {
      stream: file.readableWebStream({ autoClose: true }),
      mimeType: record.mime_type,
      originalName: record.original_name,
      byteSize: String(record.byte_size),
      kind: record.kind,
      uploaderId: record.uploader_id === null ? null : Number(record.uploader_id),
      uploaderRole: record.uploader_role,
      purpose: record.purpose,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function contestantCanReadMedia(
  mediaId: number,
  contestantId: number,
  media: { uploaderId: number | null; uploaderRole: CompetitionRole; purpose: "question" | "answer" },
): Promise<boolean> {
  if (media.uploaderRole === "contestant") return media.uploaderId === contestantId;
  if (media.purpose !== "question") return false;
  const matches = await rows<(RowDataPacket & { allowed: number })[]>(
    `SELECT EXISTS(
       SELECT 1 FROM competition_questions
       WHERE status IN ('published', 'closed')
         AND EXISTS(
           SELECT 1 FROM competition_control
           WHERE id = 1 AND status = 'running'
             AND started_at <= CURRENT_TIMESTAMP(3)
             AND ends_at > CURRENT_TIMESTAMP(3)
         )
         AND (
           LOCATE(CONCAT('src="/api/competition/media/', ?, '"'), content_html) > 0
           OR LOCATE(CONCAT('href="/api/competition/media/', ?, '"'), content_html) > 0
         )
     ) AS allowed`,
    [mediaId, mediaId],
  );
  return Boolean(matches[0]?.allowed);
}

export function mediaContentDisposition(kind: MediaKind, originalName: string): string {
  const disposition = kind === "image" ? "inline" : "attachment";
  return `${disposition}; filename="download"; filename*=UTF-8''${encodeURIComponent(originalName)}`;
}
