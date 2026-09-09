import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rows: vi.fn() }));

vi.mock("./db", () => ({
  competitionPool: vi.fn(),
  ensureCompetitionSchema: vi.fn(),
  rows: mocks.rows,
}));

import {
  deleteStoredMediaFiles,
  discardMediaUpload,
  mediaContentDisposition,
  readMedia,
  receiveMediaUpload,
} from "./media";

function uploadRequest(
  bytes: Uint8Array,
  { type = "image/png", kind = "image", name = "answer.png" } = {},
): Request {
  const form = new FormData();
  form.set("purpose", "answer");
  form.set("kind", kind);
  const body = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  form.set("file", new File([body], name, { type }));
  return new Request("http://localhost/api/competition/media", {
    method: "POST",
    body: form,
  });
}

describe("disk-backed media uploads", () => {
  let dataDirectory: string;

  beforeEach(async () => {
    dataDirectory = await mkdtemp(path.join(tmpdir(), "modelmux-media-test-"));
    process.env.MODELMUX_DATA_DIR = dataDirectory;
  });

  afterEach(async () => {
    delete process.env.MODELMUX_DATA_DIR;
    await rm(dataDirectory, { force: true, recursive: true });
  });

  it("streams an image larger than the former 8 MiB limit to disk", async () => {
    const bytes = new Uint8Array(9 * 1024 * 1024);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const upload = await receiveMediaUpload(uploadRequest(bytes));
    const stored = await stat(path.join(dataDirectory, "uploads", upload.storageName));

    expect(upload).toMatchObject({
      purpose: "answer",
      kind: "image",
      originalName: "answer.png",
      mimeType: "image/png",
      byteSize: bytes.byteLength,
    });
    expect(stored.size).toBe(bytes.byteLength);

    await discardMediaUpload(upload);
  });

  it("removes the disk file when the declared image signature is invalid", async () => {
    await expect(receiveMediaUpload(uploadRequest(new Uint8Array([1, 2, 3]))))
      .rejects.toThrow("invalid_image");

    expect(await readdir(path.join(dataDirectory, "uploads"))).toEqual([]);
  });

  it("accepts arbitrary large attachments without an application size cap", async () => {
    const bytes = new Uint8Array(12 * 1024 * 1024);
    bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d]);

    const upload = await receiveMediaUpload(uploadRequest(bytes, {
      type: "application/pdf",
      kind: "file",
      name: "现场材料.pdf",
    }));
    const stored = await stat(path.join(dataDirectory, "uploads", upload.storageName));

    expect(upload).toMatchObject({
      purpose: "answer",
      kind: "file",
      originalName: "现场材料.pdf",
      mimeType: "application/pdf",
      byteSize: bytes.byteLength,
    });
    expect(stored.size).toBe(bytes.byteLength);
    expect(mediaContentDisposition(upload.kind, upload.originalName)).toContain("attachment;");

    await discardMediaUpload(upload);
  });

  it("allows an empty ordinary file and forces it to download", async () => {
    const upload = await receiveMediaUpload(uploadRequest(new Uint8Array(), {
      type: "text/plain",
      kind: "file",
      name: "空白模板.txt",
    }));

    expect(upload.byteSize).toBe(0);
    expect(mediaContentDisposition(upload.kind, upload.originalName)).toMatch(/^attachment;/);
    await discardMediaUpload(upload);
  });

  it("removes persisted upload files during account deletion", async () => {
    const first = path.join(dataDirectory, "uploads", "first.upload");
    const second = path.join(dataDirectory, "uploads", "second.png");
    await mkdir(path.dirname(first), { recursive: true });
    await writeFile(first, "first");
    await writeFile(second, "second");

    await deleteStoredMediaFiles(["first.upload", "second.png", "already-missing.upload"]);

    expect(await readdir(path.join(dataDirectory, "uploads"))).toEqual([]);
  });
});

describe("reading stored media back", () => {
  let dataDirectory: string;

  beforeEach(async () => {
    dataDirectory = await mkdtemp(path.join(tmpdir(), "modelmux-media-read-test-"));
    process.env.MODELMUX_DATA_DIR = dataDirectory;
    mocks.rows.mockReset();
  });

  afterEach(async () => {
    delete process.env.MODELMUX_DATA_DIR;
    await rm(dataDirectory, { force: true, recursive: true });
  });

  it("streams Uint8Array chunks the Node response writer can pipe", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    await mkdir(path.join(dataDirectory, "uploads"), { recursive: true });
    await writeFile(path.join(dataDirectory, "uploads", "stored.png"), bytes);
    mocks.rows.mockResolvedValue([{
      uploader_id: 7,
      uploader_role: "judge",
      purpose: "question",
      kind: "image",
      storage_name: "stored.png",
      original_name: "image.png",
      mime_type: "image/png",
      byte_size: String(bytes.byteLength),
    }]);

    const media = await readMedia(1);
    expect(media).not.toBeNull();

    const chunks: Uint8Array[] = [];
    for await (const chunk of media!.stream as AsyncIterable<unknown>) {
      // An ArrayBuffer chunk breaks the response pipe with ERR_INVALID_ARG_TYPE.
      expect(chunk).toBeInstanceOf(Uint8Array);
      chunks.push(chunk as Uint8Array);
    }

    expect(Buffer.concat(chunks)).toEqual(Buffer.from(bytes));
    expect(media!.byteSize).toBe(String(bytes.byteLength));
  });

  it("reports a missing disk file as absent media", async () => {
    mocks.rows.mockResolvedValue([{
      uploader_id: null,
      uploader_role: "judge",
      purpose: "question",
      kind: "file",
      storage_name: "gone.upload",
      original_name: "gone.pdf",
      mime_type: "application/pdf",
      byte_size: "12",
    }]);

    expect(await readMedia(1)).toBeNull();
  });
});
