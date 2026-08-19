import type { Metadata, Viewport } from "next";

import { SYSTEM_NAME } from "@/lib/branding";

import "../src/App.css";
import "../src/competition/competition.css";

export const metadata: Metadata = {
  title: SYSTEM_NAME,
  description: `${SYSTEM_NAME}，支持竞赛现场出题、答题和统一管理。`,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light",
  themeColor: "#202428",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
