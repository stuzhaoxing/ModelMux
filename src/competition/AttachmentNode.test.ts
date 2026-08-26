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
});
