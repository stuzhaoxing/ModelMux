import OSS from "ali-oss";

import {
  InlineAssetRewriteError,
  type InlineAssetStore,
  type InlineAssetUpload,
} from "./inline-assets";

const EXTENSIONS: Record<string, string> = {
  "application/octet-stream": "bin",
  "application/pdf": "pdf",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

interface OssInlineAssetConfig {
  accessKeyId: string;
  accessKeySecret: string;
  bucket: string;
  prefix: string;
  publicBaseUrl: string;
  region: string;
}

function configuredValue(value: string | undefined): string | null {
  return value?.trim() || null;
}

function loadConfig(env: NodeJS.ProcessEnv): OssInlineAssetConfig | null {
  const accessKeyId = configuredValue(env.MODELMUX_OSS_ACCESS_KEY_ID);
  const accessKeySecret = configuredValue(env.MODELMUX_OSS_ACCESS_KEY_SECRET);
  if (!accessKeyId && !accessKeySecret) return null;
  if (!accessKeyId || !accessKeySecret) {
    throw new InlineAssetRewriteError(
      503,
      "asset_store_not_configured",
      "OSS 文件存储配置不完整。",
    );
  }

  const region = configuredValue(env.MODELMUX_OSS_REGION) || "oss-cn-beijing";
  const bucket = configuredValue(env.MODELMUX_OSS_BUCKET) || "modelmux";
  const prefix = (configuredValue(env.MODELMUX_OSS_INPUT_PREFIX) || "ai-inputs")
    .replace(/^\/+|\/+$/g, "");
  const publicBaseUrl = (
    configuredValue(env.MODELMUX_OSS_PUBLIC_BASE_URL) ||
    `https://${bucket}.${region}.aliyuncs.com`
  ).replace(/\/+$/, "");
  return { accessKeyId, accessKeySecret, bucket, prefix, publicBaseUrl, region };
}

function publicObjectUrl(baseUrl: string, key: string): string {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${baseUrl}/${encodedKey}`;
}

function responseEtag(result: OSS.PutObjectResult): string {
  const headers = result.res.headers as Record<string, string | string[] | undefined>;
  const value = headers.etag;
  return (Array.isArray(value) ? value[0] : value || "")
    .replace(/^"|"$/g, "")
    .toLowerCase();
}

class OssInlineAssetStore implements InlineAssetStore {
  private readonly client: OSS;

  constructor(private readonly config: OssInlineAssetConfig) {
    this.client = new OSS({
      region: config.region,
      bucket: config.bucket,
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
      secure: true,
    });
  }

  async upload(asset: InlineAssetUpload): Promise<string> {
    const mimeSubtype = asset.mimeType.split("/")[1]?.split("+")[0] || "";
    const extension = EXTENSIONS[asset.mimeType] ||
      mimeSubtype.replace(/[^a-z0-9]/g, "") ||
      "bin";
    const date = new Date().toISOString().slice(0, 10);
    const key = `${this.config.prefix}/${date}/${asset.sha256Hex}.${extension}`;
    const result = await this.client.put(key, asset.filePath, {
      mime: asset.mimeType,
      headers: {
        "Cache-Control": "public, max-age=259200, immutable",
        "Content-MD5": asset.md5Base64,
        "x-oss-meta-sha256": asset.sha256Hex,
      },
      timeout: 300_000,
    });
    if (responseEtag(result) !== asset.md5Hex) {
      throw new Error("OSS object ETag does not match the source MD5");
    }
    return publicObjectUrl(this.config.publicBaseUrl, key);
  }
}

export function ossInlineAssetStoreFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): InlineAssetStore | null {
  const config = loadConfig(env);
  return config ? new OssInlineAssetStore(config) : null;
}
