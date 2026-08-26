import sanitizeHtml from "sanitize-html";

import { isStoredImagePath, storedMediaId } from "./images";

const attachmentClasses = new Set([
  "attachment-type",
  "attachment-details",
  "attachment-download",
]);

function cleanAttachmentName(value: string | undefined): string {
  const name = value?.trim() || "未命名附件";
  return Array.from(name).slice(0, 255).join("");
}

const transformLink: sanitizeHtml.Transformer = (_tagName, attribs) => {
  const declaredAttachmentId = attribs["data-attachment-id"];
  const attachment = declaredAttachmentId !== undefined || attribs.class?.split(/\s+/).includes("rich-attachment");
  if (attachment) {
    const mediaId = storedMediaId(attribs.href ?? "");
    if (!mediaId || String(mediaId) !== declaredAttachmentId) {
      return { tagName: "span", attribs: {} as sanitizeHtml.Attributes };
    }
    const name = cleanAttachmentName(attribs["data-attachment-name"]);
    const byteSize = /^\d{1,20}$/.test(attribs["data-attachment-size"] ?? "")
      ? attribs["data-attachment-size"]
      : "0";
    const mimeType = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+*-]+$/i.test(attribs["data-attachment-type"] ?? "")
      ? attribs["data-attachment-type"].toLowerCase().slice(0, 80)
      : "application/octet-stream";
    return {
      tagName: "a",
      attribs: {
        href: `/api/competition/media/${mediaId}`,
        class: "rich-attachment",
        download: name,
        title: `下载 ${name}`,
        "data-attachment-id": String(mediaId),
        "data-attachment-name": name,
        "data-attachment-size": byteSize,
        "data-attachment-type": mimeType,
      },
    };
  }
  return {
    tagName: "a",
    attribs: {
      ...attribs,
      target: "_blank",
      rel: "noopener noreferrer",
    },
  };
};

export function cleanRichText(input: string): string {
  return sanitizeHtml(input, {
    allowedTags: [
      "p",
      "br",
      "strong",
      "em",
      "s",
      "u",
      "h1",
      "h2",
      "h3",
      "ul",
      "ol",
      "li",
      "blockquote",
      "pre",
      "code",
      "hr",
      "img",
      "a",
      "span",
      "small",
    ],
    allowedAttributes: {
      a: [
        "href",
        "target",
        "rel",
        "class",
        "download",
        "title",
        "data-attachment-id",
        "data-attachment-name",
        "data-attachment-size",
        "data-attachment-type",
      ],
      img: ["src", "alt", "title"],
      span: ["class"],
    },
    allowedClasses: {
      a: ["rich-attachment"],
      span: [...attachmentClasses],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: [] },
    allowProtocolRelative: false,
    exclusiveFilter(frame) {
      return frame.tag === "img" && !isStoredImagePath(frame.attribs.src ?? "");
    },
    transformTags: {
      a: transformLink,
    },
  }).trim();
}

export function richTextHasContent(html: string): boolean {
  const text = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, " ")
    .trim();
  return text.length > 0 || /<img\b/i.test(html);
}
