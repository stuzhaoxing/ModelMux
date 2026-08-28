import { describe, expect, it } from "vitest";

import { cleanRichText, renderRichTextHtml, richTextHasContent } from "./content";

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

  it("renders Markdown stored as plain editor paragraphs", () => {
    const rendered = renderRichTextHtml([
      "<p>### 采样口核查</p>",
      "<p>**结论：需要结合排污许可核查。**</p>",
      "<p>1. 核查监测方案</p>",
      "<p>2. 核查排放口位置</p>",
    ].join(""));

    expect(rendered).toContain("<h3>采样口核查</h3>");
    expect(rendered).toContain("<strong>结论：需要结合排污许可核查。</strong>");
    expect(rendered).toContain("<ol>");
    expect(rendered).toContain("<li>");
    expect(rendered).not.toContain("###");
    expect(rendered).not.toContain("**");
  });

  it("preserves intentional rich HTML when it contains no Markdown", () => {
    const html = '<p><strong>已排版</strong> 保留原文</p><img src="/api/competition/media/12" alt="图">';
    expect(renderRichTextHtml(html)).toBe(cleanRichText(html));
  });

  it("renders Markdown mixed with existing inline rich text", () => {
    const rendered = renderRichTextHtml([
      "<p>### 进口采样口核查<br><br>",
      "**结论：不强制。**<br><br>",
      "1. <strong>法律层面</strong>：必须保证**设施正常运行**。<br>",
      "2. <strong>规范层面</strong>：核查末端排放。</p>",
    ].join(""));

    expect(rendered).toContain("<h3>进口采样口核查</h3>");
    expect(rendered).toContain("<strong>结论：不强制。</strong>");
    expect(rendered).toContain("<strong>法律层面</strong>");
    expect(rendered).toContain("<strong>设施正常运行</strong>");
    expect(rendered).toContain("<ol>");
    expect(rendered).not.toContain("###");
    expect(rendered).not.toContain("**");
  });

  it("sanitizes links and HTML produced from Markdown", () => {
    const rendered = renderRichTextHtml("[危险链接](javascript:alert(1))\n\n<script>alert(2)</script>\n\n**安全文本**");
    expect(rendered).not.toContain("javascript:");
    expect(rendered).not.toContain("<script");
    expect(rendered).toContain("<strong>安全文本</strong>");
  });

  it("renders common GFM table and strikethrough syntax", () => {
    const rendered = renderRichTextHtml([
      "| 项目 | 结论 |",
      "| --- | --- |",
      "| 采样口 | 已补充 |",
    ].join("\n"));

    expect(rendered).toContain("<table>");
    expect(rendered).toContain("<th>项目</th>");
    expect(rendered).toContain("<td>采样口</td>");
    expect(rendered).toContain("<td>已补充</td>");
  });
});
