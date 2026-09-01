import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";

import { AttachmentNode, attachmentTypeLabel, formatAttachmentSize } from "./AttachmentNode";

describe("rich-text attachment labels", () => {
  it("formats names, types and large byte sizes", () => {
    expect(attachmentTypeLabel("监测方案.pdf", "application/pdf")).toBe("PDF");
    expect(attachmentTypeLabel("README", "text/plain")).toBe("PLAIN");
    expect(formatAttachmentSize(0)).toBe("0 B");
    expect(formatAttachmentSize(5 * 1024 * 1024 * 1024)).toBe("5.00 GB");
  });

  it("keeps an empty editor as a paragraph instead of creating a placeholder attachment", () => {
    const schema = getSchema([StarterKit, AttachmentNode]);

    expect(schema.topNodeType.createAndFill()?.toJSON()).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });

  it("renders the card as a selectable container with a dedicated download link", () => {
    const schema = getSchema([StarterKit, AttachmentNode]);
    const attachment = schema.nodes.attachment.create({
      mediaId: "42",
      name: "监测视频.mp4",
      byteSize: "20552090",
      mimeType: "video/mp4",
    });
    const rendered = schema.nodes.attachment.spec.toDOM?.(attachment);

    expect(Array.isArray(rendered)).toBe(true);
    if (!Array.isArray(rendered)) throw new Error("附件节点没有输出 DOM 结构");
    expect(rendered[0]).toBe("div");
    expect(rendered[1]).toMatchObject({
      class: "rich-attachment",
      "data-attachment-id": "42",
    });
    expect(rendered[1]).not.toHaveProperty("href");
    expect(rendered[4]).toEqual([
      "a",
      expect.objectContaining({
        class: "attachment-download",
        href: "/api/competition/media/42",
        download: "监测视频.mp4",
      }),
      "下载",
    ]);
  });
});
