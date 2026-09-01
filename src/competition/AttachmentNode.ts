import { mergeAttributes, Node } from "@tiptap/core";

function safeName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  return name || "未命名附件";
}

export function formatAttachmentSize(value: unknown): string {
  const bytes = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "大小未知";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let amount = bytes;
  let unit = -1;
  do {
    amount /= 1024;
    unit += 1;
  } while (amount >= 1024 && unit < units.length - 1);
  return `${amount >= 10 ? amount.toFixed(1) : amount.toFixed(2)} ${units[unit]}`;
}

export function attachmentTypeLabel(nameValue: unknown, mimeValue: unknown): string {
  const name = safeName(nameValue);
  const extension = name.includes(".") ? name.split(".").at(-1)?.trim().toUpperCase() : "";
  if (extension && /^[A-Z0-9]{1,5}$/.test(extension)) return extension;
  const mimeType = typeof mimeValue === "string" ? mimeValue : "";
  const subtype = mimeType.split("/")[1]?.split(/[;+]/)[0]?.trim().toUpperCase();
  return subtype && /^[A-Z0-9.+-]{1,8}$/.test(subtype) ? subtype : "FILE";
}

export const AttachmentNode = Node.create({
  name: "attachment",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      mediaId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-attachment-id"),
        renderHTML: (attributes) => ({ "data-attachment-id": attributes.mediaId }),
      },
      name: {
        default: "未命名附件",
        parseHTML: (element) => element.getAttribute("data-attachment-name"),
        renderHTML: (attributes) => ({ "data-attachment-name": safeName(attributes.name) }),
      },
      byteSize: {
        default: "0",
        parseHTML: (element) => element.getAttribute("data-attachment-size"),
        renderHTML: (attributes) => ({ "data-attachment-size": String(attributes.byteSize ?? "0") }),
      },
      mimeType: {
        default: "application/octet-stream",
        parseHTML: (element) => element.getAttribute("data-attachment-type"),
        renderHTML: (attributes) => ({ "data-attachment-type": attributes.mimeType }),
      },
    };
  },

  parseHTML() {
    return [
      { tag: "div.rich-attachment[data-attachment-id]", priority: 1100 },
      { tag: "a.rich-attachment[data-attachment-id]", priority: 1100 },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const mediaId = String(HTMLAttributes["data-attachment-id"] ?? "");
    const name = safeName(HTMLAttributes["data-attachment-name"]);
    const byteSize = HTMLAttributes["data-attachment-size"];
    const mimeType = HTMLAttributes["data-attachment-type"];
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        class: "rich-attachment",
      }),
      ["span", { class: "attachment-type" }, attachmentTypeLabel(name, mimeType)],
      [
        "span",
        { class: "attachment-details" },
        ["strong", {}, name],
        ["small", {}, formatAttachmentSize(byteSize)],
      ],
      [
        "a",
        {
          class: "attachment-download",
          href: `/api/competition/media/${mediaId}`,
          download: name,
          title: `下载 ${name}`,
        },
        "下载",
      ],
    ];
  },
});
