import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  rewriteInlineBase64Assets,
  type InlineAssetStore,
} from "./inline-assets";

function requestWithBody(body: string, chunkSize = 8 * 1024): Request {
  const encoded = new TextEncoder().encode(body);
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= encoded.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoded.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
  return new Request("http://localhost:4000/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: stream,
    duplex: "half",
  } as RequestInit);
}

describe("inline Base64 asset rewriting", () => {
  let dataDirectory: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    dataDirectory = await mkdtemp(path.join(tmpdir(), "modelmux-inline-assets-"));
    env = { NODE_ENV: "test", MODELMUX_DATA_DIR: dataDirectory };
  });

  afterEach(async () => {
    await rm(dataDirectory, { force: true, recursive: true });
  });

  it("decodes a large data URL to disk and replaces it with the uploaded URL", async () => {
    const original = Buffer.alloc(2 * 1024 * 1024, 0x5a);
    const publicUrl = "https://modelmux.oss-cn-beijing.aliyuncs.com/ai-inputs/test.png";
    const upload = vi.fn<InlineAssetStore["upload"]>(async (asset) => {
      const stored = await readFile(asset.filePath);
      expect(stored.equals(original)).toBe(true);
      expect(asset.byteLength).toBe(original.length);
      expect(asset.mimeType).toBe("image/png");
      expect(asset.md5Hex).toBe(createHash("md5").update(original).digest("hex"));
      expect(asset.sha256Hex).toBe(createHash("sha256").update(original).digest("hex"));
      return publicUrl;
    });
    const payload = {
      model: "qwen3.7-max",
      messages: [{
        role: "user",
        content: [{
          type: "image_url",
          image_url: { url: `data:image/png;base64,${original.toString("base64")}` },
        }],
      }],
    };

    const rewritten = await rewriteInlineBase64Assets(
      requestWithBody(JSON.stringify(payload)),
      { upload },
      env,
    ) as typeof payload;

    expect(rewritten.messages[0].content[0].image_url.url).toBe(publicUrl);
    expect(upload).toHaveBeenCalledOnce();
    expect(await readdir(path.join(dataDirectory, "tmp", "ai-assets"))).toEqual([]);
  });

  it("leaves remote URLs and ordinary message text unchanged", async () => {
    const upload = vi.fn<InlineAssetStore["upload"]>();
    const payload = {
      model: "qwen3.7-plus",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "literal data:image/png;base64,SGVsbG8=" },
          { type: "image_url", image_url: { url: "https://example.com/image.png" } },
        ],
      }],
    };

    const rewritten = await rewriteInlineBase64Assets(
      requestWithBody(JSON.stringify(payload), 7),
      { upload },
      env,
    );

    expect(rewritten).toEqual(payload);
    expect(upload).not.toHaveBeenCalled();
  });

  it("rewrites input_file file_data to file_url after offload", async () => {
    const publicUrl = "https://modelmux.oss-cn-beijing.aliyuncs.com/ai-inputs/test.pdf";
    const upload = vi.fn<InlineAssetStore["upload"]>(async (asset) => {
      expect(asset.mimeType).toBe("application/pdf");
      expect(await readFile(asset.filePath, "utf8")).toBe("PDF test");
      return publicUrl;
    });
    const payload = {
      model: "qwen3.7-max",
      messages: [{
        role: "user",
        content: [{
          type: "input_file",
          filename: "test.pdf",
          file_data: `data:application/pdf;base64,${Buffer.from("PDF test").toString("base64")}`,
        }],
      }],
    };

    const rewritten = await rewriteInlineBase64Assets(
      requestWithBody(JSON.stringify(payload), 5),
      { upload },
      env,
    ) as {
      messages: Array<{ content: Array<Record<string, unknown>> }>;
    };
    const file = rewritten.messages[0].content[0];

    expect(file.file_data).toBeUndefined();
    expect(file.file_url).toBe(publicUrl);
    expect(file.filename).toBe("test.pdf");
    expect(upload).toHaveBeenCalledOnce();
  });

  it("rejects malformed Base64 before any upstream request can be made", async () => {
    const upload = vi.fn<InlineAssetStore["upload"]>();
    const payload = {
      model: "qwen3.7-plus",
      messages: [{
        role: "user",
        content: [{
          type: "image_url",
          image_url: { url: "data:image/png;base64,abc$" },
        }],
      }],
    };

    await expect(rewriteInlineBase64Assets(
      requestWithBody(JSON.stringify(payload), 3),
      { upload },
      env,
    )).rejects.toMatchObject({
      status: 400,
      code: "invalid_inline_asset",
    });
    expect(upload).not.toHaveBeenCalled();
    expect(await readdir(path.join(dataDirectory, "tmp", "ai-assets"))).toEqual([]);
  });

  it("removes temporary files when the OSS upload fails", async () => {
    const payload = {
      model: "qwen3.7-plus",
      messages: [{
        role: "user",
        content: [{
          type: "image_url",
          image_url: { url: "data:image/png;base64,SGVsbG8=" },
        }],
      }],
    };

    await expect(rewriteInlineBase64Assets(
      requestWithBody(JSON.stringify(payload)),
      { upload: async () => { throw new Error("OSS unavailable"); } },
      env,
    )).rejects.toMatchObject({
      status: 502,
      code: "asset_upload_failed",
    });
    expect(await readdir(path.join(dataDirectory, "tmp", "ai-assets"))).toEqual([]);
  });
});
