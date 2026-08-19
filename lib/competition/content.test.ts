import { describe, expect, it } from "vitest";

import { cleanRichText, richTextHasContent } from "./content";

describe("competition rich text", () => {
  it("keeps supported formatting and local media", () => {
    const html = cleanRichText('<h2>题目</h2><p><strong>重点</strong></p><img src="/api/competition/media/12" alt="图">');
    expect(html).toContain("<h2>题目</h2>");
    expect(html).toContain("<strong>重点</strong>");
    expect(html).toContain('/api/competition/media/12');
  });

  it("removes scripts, event handlers and external images", () => {
    const html = cleanRichText('<script>alert(1)</script><p onclick="alert(2)">正文</p><img src="https://outside.example/x.png">');
    expect(html).toBe("<p>正文</p>");
  });

  it("detects text and image-only answers", () => {
    expect(richTextHasContent("<p> </p>")).toBe(false);
    expect(richTextHasContent("<p>回答</p>")).toBe(true);
    expect(richTextHasContent('<img src="/api/competition/media/1">')).toBe(true);
  });
});
