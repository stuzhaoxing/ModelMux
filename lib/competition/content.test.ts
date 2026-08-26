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

  it("keeps uploaded attachment cards and their download metadata", () => {
    const html = cleanRichText(
      '<a class="rich-attachment" href="/api/competition/media/21" data-attachment-id="21" data-attachment-name="考核材料.pdf" data-attachment-size="7340032" data-attachment-type="application/pdf"><span class="attachment-type">PDF</span><span class="attachment-details"><strong>考核材料.pdf</strong><small>7 MB</small></span><span class="attachment-download">下载</span></a>',
    );

    expect(html).toContain('class="rich-attachment"');
    expect(html).toContain('href="/api/competition/media/21"');
    expect(html).toContain('download="考核材料.pdf"');
    expect(html).toContain('data-attachment-size="7340032"');
    expect(richTextHasContent(html)).toBe(true);
  });

  it("does not preserve forged external attachment cards", () => {
    const html = cleanRichText(
      '<a class="rich-attachment" href="https://outside.example/payload.html" data-attachment-id="21" data-attachment-name="payload.html"><span class="attachment-download">下载</span></a>',
    );

    expect(html).not.toContain("rich-attachment");
    expect(html).not.toContain("outside.example");
  });
});
