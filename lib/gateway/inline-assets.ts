import { createHash, randomUUID, type Hash } from "node:crypto";
import { mkdir, open, rm, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import Assembler from "stream-json/core/assembler.js";
import { parser, type Token } from "stream-json/parser.js";

const DATA_URL_HEADER_LIMIT = 512;
const ASSET_STRING_KEYS = new Set([
  "file_data",
  "image_url",
  "url",
  "video_url",
]);

export interface InlineAssetUpload {
  filePath: string;
  mimeType: string;
  byteLength: number;
  md5Base64: string;
  md5Hex: string;
  sha256Hex: string;
}

export interface InlineAssetStore {
  upload(asset: InlineAssetUpload): Promise<string>;
}

export class InlineAssetRewriteError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "InlineAssetRewriteError";
  }
}

interface ActiveString {
  eligible: boolean;
  key: string | null;
  mode: "base64" | "plain" | "undecided";
  chunks: string[];
  prefix: string;
  decoder: StreamingBase64File | null;
}

function dataDirectory(env: NodeJS.ProcessEnv): string {
  const configured = env.MODELMUX_DATA_DIR?.trim() || ".modelmux-data";
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(/* turbopackIgnore: true */ process.cwd(), configured);
}

function parseDataUrlHeader(value: string): string | null {
  if (!value.toLowerCase().startsWith("data:")) return null;
  const parts = value.slice(5).split(";");
  if (parts.at(-1)?.toLowerCase() !== "base64") return null;
  const mimeType = (parts[0] || "application/octet-stream").toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mimeType)
    ? mimeType
    : null;
}

function invalidBase64(): InlineAssetRewriteError {
  return new InlineAssetRewriteError(
    400,
    "invalid_inline_asset",
    "内联文件不是有效的 Base64 数据。",
  );
}

class StreamingBase64File {
  private carry = "";
  private byteLength = 0;
  private closed = false;
  private readonly md5: Hash = createHash("md5");
  private readonly sha256: Hash = createHash("sha256");

  private constructor(
    readonly filePath: string,
    readonly mimeType: string,
    private readonly handle: FileHandle,
  ) {}

  static async create(
    directory: string,
    mimeType: string,
  ): Promise<StreamingBase64File> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const filePath = path.join(directory, `${randomUUID()}.upload`);
    const handle = await open(filePath, "wx", 0o600);
    return new StreamingBase64File(filePath, mimeType, handle);
  }

  private async writeBuffer(buffer: Buffer): Promise<void> {
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesWritten } = await this.handle.write(
        buffer,
        offset,
        buffer.length - offset,
        null,
      );
      if (bytesWritten <= 0) {
        throw new Error("temporary asset write made no progress");
      }
      offset += bytesWritten;
    }
    this.md5.update(buffer);
    this.sha256.update(buffer);
    this.byteLength += buffer.length;
  }

  async append(value: string): Promise<void> {
    const clean = value.replace(/[\t\n\f\r ]+/g, "");
    const combined = this.carry + clean;
    const completeLength = Math.floor(combined.length / 4) * 4;
    const decodeLength = Math.max(0, completeLength - 4);
    const ready = combined.slice(0, decodeLength);
    if (ready && !/^[A-Za-z0-9+/]+$/.test(ready)) throw invalidBase64();
    if (ready) await this.writeBuffer(Buffer.from(ready, "base64"));
    this.carry = combined.slice(decodeLength);
  }

  async finish(): Promise<InlineAssetUpload> {
    try {
      if (this.carry.length % 4 === 1) throw invalidBase64();
      const normalized = this.carry.length % 4 === 0
        ? this.carry
        : this.carry.padEnd(this.carry.length + (4 - (this.carry.length % 4)), "=");
      if (
        normalized &&
        !/^(?:[A-Za-z0-9+/]{4}|[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)$/.test(normalized)
      ) {
        throw invalidBase64();
      }
      if (normalized) await this.writeBuffer(Buffer.from(normalized, "base64"));
      await this.handle.close();
      this.closed = true;
      const md5 = this.md5.digest();
      return {
        filePath: this.filePath,
        mimeType: this.mimeType,
        byteLength: this.byteLength,
        md5Base64: md5.toString("base64"),
        md5Hex: md5.toString("hex"),
        sha256Hex: this.sha256.digest("hex"),
      };
    } catch (error) {
      await this.discard();
      throw error;
    }
  }

  async discard(): Promise<void> {
    if (!this.closed) {
      await this.handle.close().catch(() => undefined);
      this.closed = true;
    }
    await rm(this.filePath, { force: true }).catch(() => undefined);
  }
}

function activeString(assembler: Assembler<unknown>): ActiveString {
  return {
    eligible: assembler.key !== null && ASSET_STRING_KEYS.has(assembler.key),
    key: assembler.key,
    mode: "undecided",
    chunks: [],
    prefix: "",
    decoder: null,
  };
}

async function appendStringChunk(
  active: ActiveString,
  value: string,
  temporaryDirectory: string,
): Promise<void> {
  if (!active.eligible || active.mode === "plain") {
    active.mode = "plain";
    active.chunks.push(value);
    return;
  }
  if (active.mode === "base64") {
    await active.decoder?.append(value);
    return;
  }

  active.prefix += value;
  const commaIndex = active.prefix.indexOf(",");
  if (commaIndex < 0) {
    if (
      active.prefix.length > DATA_URL_HEADER_LIMIT ||
      !"data:".startsWith(active.prefix.slice(0, Math.min(active.prefix.length, 5)).toLowerCase())
    ) {
      active.mode = "plain";
      active.chunks.push(active.prefix);
      active.prefix = "";
    }
    return;
  }

  const mimeType = parseDataUrlHeader(active.prefix.slice(0, commaIndex));
  if (!mimeType || commaIndex > DATA_URL_HEADER_LIMIT) {
    active.mode = "plain";
    active.chunks.push(active.prefix);
    active.prefix = "";
    return;
  }

  active.decoder = await StreamingBase64File.create(temporaryDirectory, mimeType);
  active.mode = "base64";
  const initialBase64 = active.prefix.slice(commaIndex + 1);
  active.prefix = "";
  await active.decoder.append(initialBase64);
}

async function finishString(
  active: ActiveString,
  store: InlineAssetStore,
): Promise<{ offloaded: boolean; value: string }> {
  if (active.mode !== "base64" || !active.decoder) {
    return { offloaded: false, value: active.chunks.join("") + active.prefix };
  }

  try {
    const asset = await active.decoder.finish();
    try {
      return { offloaded: true, value: await store.upload(asset) };
    } catch (error) {
      throw new InlineAssetRewriteError(
        502,
        "asset_upload_failed",
        "内联文件上传失败，请稍后重试。",
        { cause: error },
      );
    }
  } finally {
    await active.decoder.discard();
  }
}

export async function rewriteInlineBase64Assets(
  request: Request,
  store: InlineAssetStore,
  env: NodeJS.ProcessEnv = process.env,
): Promise<unknown> {
  if (!request.body) {
    throw new InlineAssetRewriteError(400, "invalid_json", "请求体不能为空。");
  }

  const assembler = new Assembler<unknown>();
  const requestBody = request.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>;
  const tokenStream = Readable.fromWeb(requestBody).pipe(parser.asStream({
    packKeys: true,
    streamKeys: false,
    packStrings: false,
    streamStrings: true,
    packNumbers: true,
    streamNumbers: false,
  }));
  const temporaryDirectory = path.join(dataDirectory(env), "tmp", "ai-assets");
  let currentString: ActiveString | null = null;

  try {
    for await (const token of tokenStream as AsyncIterable<Token>) {
      if (token.name === "startString") {
        currentString = activeString(assembler);
      } else if (token.name === "stringChunk") {
        if (!currentString) throw new Error("string chunk outside a string");
        await appendStringChunk(currentString, token.value, temporaryDirectory);
      } else if (token.name === "endString") {
        if (!currentString) throw new Error("string end outside a string");
        const finished = await finishString(currentString, store);
        if (finished.offloaded && currentString.key === "file_data") {
          assembler.key = "file_url";
        }
        assembler.stringValue(finished.value);
        currentString = null;
      } else {
        assembler.consume(token);
      }
    }
  } catch (error) {
    await currentString?.decoder?.discard();
    if (error instanceof InlineAssetRewriteError) throw error;
    throw new InlineAssetRewriteError(
      400,
      "invalid_json",
      "请求体必须是有效的 JSON 对象。",
      { cause: error },
    );
  }

  if (!assembler.done) {
    throw new InlineAssetRewriteError(
      400,
      "invalid_json",
      "请求体必须是有效的 JSON 对象。",
    );
  }
  return assembler.current;
}
