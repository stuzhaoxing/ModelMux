import sanitizeHtml from "sanitize-html";

import { isStoredImagePath } from "./images";

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
    ],
    allowedAttributes: {
      a: ["href", "target", "rel"],
      img: ["src", "alt", "title"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: [] },
    allowProtocolRelative: false,
    exclusiveFilter(frame) {
      return frame.tag === "img" && !isStoredImagePath(frame.attribs.src ?? "");
    },
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: "a",
        attribs: {
          ...attribs,
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
    },
  }).trim();
}

export function richTextHasContent(html: string): boolean {
  const text = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, " ")
    .trim();
  return text.length > 0 || /<img\b/i.test(html);
}
