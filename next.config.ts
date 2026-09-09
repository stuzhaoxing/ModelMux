import { hostname } from "node:os";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js 不接受单独的 *；**.* 覆盖任意 IPv4 和带点的域名。
  allowedDevOrigins: ["**.*", hostname(), hostname().split(".")[0], "[::1]"],
  output: "standalone",
  serverExternalPackages: ["ali-oss"],
  // 运行期数据目录不属于构建产物：文件追踪会把 uploads 和网关状态整份复制进
  // .next/standalone，既让每次构建随附件体积变慢，又在产物里留下一份会被误认成
  // 实时数据的旧快照。运行时通过绝对路径的 MODELMUX_DATA_DIR 访问，与追踪无关。
  outputFileTracingExcludes: {
    "/*": [".modelmux-data/**/*"],
  },
  outputFileTracingIncludes: {
    "/api/competition/judge/answers/export": [
      "node_modules/.pnpm/@img+sharp-linux-x64@*/node_modules/@img/sharp-linux-x64/**/*",
      "node_modules/.pnpm/@img+sharp-libvips-linux-x64@*/node_modules/@img/sharp-libvips-linux-x64/**/*",
    ],
  },
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
