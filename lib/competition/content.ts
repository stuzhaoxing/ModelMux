import { hasChildren, isTag, isText, type AnyNode } from "domhandler";
import { parseDocument } from "htmlparser2";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

import { isStoredImagePath, storedMediaId } from "./images";

const attachmentClasses = new Set([
  "attachment-type",
  "attachment-details",
  "attachment-download",
]);

const semanticRichTextPattern = /<(?:a|blockquote|code|del|em|h[1-6]|hr|img|li|ol|pre|s|small|span|strong|table|tbody|td|th|thead|tr|u|ul)\b/i;
const markdownFormattingPattern = /(^|\n)\s{0,3}(?:#{1,6}\s|>|```|~~~|[-+*]\s|\d+[.)]\s)|(?:\*\*|__|~~|`[^`]+`|!?(?:\[[^\]]+\])\([^\s)]+(?:\s+"[^"]*")?\))/m;

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
      "h4",
      "h5",
      "h6",
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
      "del",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
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

function markdownTextFromHtmlNode(node: AnyNode): string {
  if (isText(node)) return node.data;
  if (!hasChildren(node)) return "";
  if (isTag(node) && node.name === "br") return "\n";

  const content = node.children.map(markdownTextFromHtmlNode).join("");
  return isTag(node) && node.name === "p" ? `${content}\n\n` : content;
}

/**
 * Historic questions can contain Markdown pasted into the rich-text editor. Tiptap
 * stores that paste as plain paragraphs, so render those paragraphs as Markdown
 * while leaving intentional rich HTML, media, and attachments unchanged.
 */
export function renderRichTextHtml(input: string): string {
  const cleanHtml = cleanRichText(input);
  if (!cleanHtml || semanticRichTextPattern.test(cleanHtml)) return cleanHtml;

  const markdown = markdownTextFromHtmlNode(parseDocument(cleanHtml))
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!markdownFormattingPattern.test(markdown)) return cleanHtml;

  const rendered = marked.parse(markdown, { async: false, breaks: true, gfm: true });
  return cleanRichText(rendered);
}

export function richTextHasContent(html: string): boolean {
  const text = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, " ")
    .trim();
  return text.length > 0 || /<img\b/i.test(html);
}
