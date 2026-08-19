import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { discardImageUpload, receiveImageUpload } from "./media";

function uploadRequest(bytes: Uint8Array, type = "image/png"): Request {
  const form = new FormData();
  form.set("purpose", "answer");
  const body = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  form.set("file", new File([body], "answer.png", { type }));
  return new Request("http://localhost/api/competition/media", {
    method: "POST",
    body: form,
  });
}

describe("disk-backed image uploads", () => {
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

    const upload = await receiveImageUpload(uploadRequest(bytes));
    const stored = await stat(path.join(dataDirectory, "uploads", upload.storageName));

    expect(upload).toMatchObject({
      purpose: "answer",
      originalName: "answer.png",
      mimeType: "image/png",
      byteSize: bytes.byteLength,
    });
    expect(stored.size).toBe(bytes.byteLength);

    await discardImageUpload(upload);
  });

  it("removes the disk file when the declared image signature is invalid", async () => {
    await expect(receiveImageUpload(uploadRequest(new Uint8Array([1, 2, 3]))))
      .rejects.toThrow("invalid_image");

    expect(await readdir(path.join(dataDirectory, "uploads"))).toEqual([]);
  });
});
