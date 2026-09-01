import { createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { ZipArchive } from "archiver";
import { parseDocument } from "htmlparser2";
import type { ChildNode, Element, Text } from "domhandler";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  HeadingLevel,
  Header,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  TextRun,
} from "docx";
import PDFDocument from "pdfkit";
import sharp from "sharp";

import { SYSTEM_NAME } from "../branding";
import { storedMediaId } from "./images";
import { readMedia } from "./media";
import type { CompetitionQuestion, JudgeAnswerRow } from "./types";
import type { JudgeAnswerExportSnapshot } from "./repository";

const PAGE_MARGIN_TWIPS = 1440;
const PDF_MARGIN = 54;
const EXPORT_ROOT_NAME = "评委答卷导出";
const DOCX_FONT = { ascii: "Times New Roman", hAnsi: "Times New Roman", eastAsia: "SimSun", cs: "Times New Roman" };
const DOCX_CODE_FONT = { ascii: "Consolas", hAnsi: "Consolas", eastAsia: "SimSun", cs: "Consolas" };
const DOCX_IMAGE_MAX_WIDTH = 560;
const DOCX_IMAGE_MAX_HEIGHT = 620;
const PDF_IMAGE_MAX_HEIGHT = 520;
const EXPORT_IMAGE_PROCESS_MAX_WIDTH = 1600;
const EXPORT_IMAGE_PROCESS_MAX_HEIGHT = 1800;

export interface JudgeExportArchive {
  filePath: string;
  directory: string;
  filename: string;
}

type Inline =
  | { kind: "text"; value: string; bold?: boolean; italic?: boolean; strike?: boolean; underline?: boolean }
  | { kind: "link"; value: string; href: string }
  | { kind: "attachment"; name: string; byteSize: number; mimeType: string; mediaId: number };

export type ExportBlock =
  | { kind: "paragraph"; inlines: Inline[] }
  | { kind: "heading"; level: 1 | 2 | 3; inlines: Inline[] }
  | { kind: "bullet" | "number"; inlines: Inline[] }
  | { kind: "quote"; inlines: Inline[] }
  | { kind: "code"; value: string }
  | { kind: "rule" }
  | { kind: "image"; alt: string; mediaId: number | null };

export interface JudgeExportDocumentInput {
  question: CompetitionQuestion;
  contestant: { id: number; username: string; displayName: string };
  answer: JudgeAnswerRow | null;
  images?: ReadonlyMap<number, ExportImage>;
}

export interface ExportImage {
  data: Uint8Array;
  width: number;
  height: number;
  alt: string;
}

function dataDirectory(): string {
  const configured = process.env.MODELMUX_DATA_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(process.cwd(), ".modelmux-data");
}

export function safeExportName(value: string, fallback: string, maxLength = 100): string {
  const normalized = Array.from(value.trim() || fallback)
    .map((character) => /[\\/:*?"<>|\u0000-\u001f]/.test(character) ? "_" : character)
    .join("")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  return Array.from(normalized || fallback).slice(0, maxLength).join("") || fallback;
}

export function formatExportSize(bytes: number): string {
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

function textContent(node: ChildNode): string {
  if (node.type === "text") return (node as Text).data;
  if (node.type === "tag" || node.type === "script" || node.type === "style") {
    return (node as Element).children.map(textContent).join("");
  }
  return "";
}

function elementMediaId(element: Element): number | null {
  const id = Number(element.attribs["data-attachment-id"] ?? "");
  if (Number.isSafeInteger(id) && id > 0) return id;
  return storedMediaId(element.attribs.src ?? element.attribs.href ?? "");
}

function isAttachmentElement(element: Element): boolean {
  return element.attribs.class?.split(/\s+/).includes("rich-attachment") ?? false;
}

function inlineNodes(nodes: ChildNode[], marks: Omit<Extract<Inline, { kind: "text" }>, "kind" | "value"> = {}): Inline[] {
  const result: Inline[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      const value = (node as Text).data.replace(/\s+/g, " ");
      if (value) result.push({ kind: "text", value, ...marks });
      continue;
    }
    if (node.type !== "tag") continue;
    const element = node as Element;
    const tag = element.name.toLowerCase();
    if (tag === "br") {
      result.push({ kind: "text", value: "\n", ...marks });
    } else if (isAttachmentElement(element)) {
      const mediaId = elementMediaId(element);
      if (mediaId) {
        result.push({
          kind: "attachment",
          mediaId,
          name: element.attribs["data-attachment-name"]?.trim() || textContent(element) || "未命名附件",
          byteSize: Number(element.attribs["data-attachment-size"] ?? 0),
          mimeType: element.attribs["data-attachment-type"] || "application/octet-stream",
        });
      }
    } else if (tag === "a") {
      const value = textContent(element).trim();
      const href = element.attribs.href?.trim();
      if (value && href) result.push({ kind: "link", value, href });
    } else {
      result.push(...inlineNodes(element.children, {
        bold: marks.bold || tag === "strong" || tag === "b",
        italic: marks.italic || tag === "em" || tag === "i",
        strike: marks.strike || tag === "s" || tag === "del",
        underline: marks.underline || tag === "u",
      }));
    }
  }
  return result;
}

export function parseExportBlocks(html: string): ExportBlock[] {
  const root = parseDocument(html, { decodeEntities: true });
  const blocks: ExportBlock[] = [];
  const visit = (nodes: ChildNode[], listKind: "bullet" | "number" | null = null) => {
    for (const node of nodes) {
      if (node.type === "text") {
        if ((node as Text).data.trim()) blocks.push({ kind: "paragraph", inlines: inlineNodes([node]) });
        continue;
      }
      if (node.type !== "tag") continue;
      const element = node as Element;
      const tag = element.name.toLowerCase();
      if (tag === "ul" || tag === "ol") {
        visit(element.children, tag === "ul" ? "bullet" : "number");
      } else if (tag === "li") {
        const inlines = inlineNodes(element.children);
        if (inlines.length) blocks.push({ kind: listKind ?? "bullet", inlines });
      } else if (/^h[1-3]$/.test(tag)) {
        blocks.push({ kind: "heading", level: Number(tag.slice(1)) as 1 | 2 | 3, inlines: inlineNodes(element.children) });
      } else if (tag === "pre") {
        blocks.push({ kind: "code", value: textContent(element) });
      } else if (tag === "blockquote") {
        const inlines = inlineNodes(element.children);
        if (inlines.length) blocks.push({ kind: "quote", inlines });
      } else if (tag === "hr") {
        blocks.push({ kind: "rule" });
      } else if (tag === "img") {
        blocks.push({ kind: "image", alt: element.attribs.alt?.trim() || "图片", mediaId: elementMediaId(element) });
      } else if (isAttachmentElement(element)) {
        const inlines = inlineNodes([element]);
        if (inlines.length) blocks.push({ kind: "paragraph", inlines });
      } else if (["p", "div", "section"].includes(tag)) {
        const inlines = inlineNodes(element.children);
        if (inlines.length) blocks.push({ kind: "paragraph", inlines });
        else visit(element.children, listKind);
      } else {
        visit(element.children, listKind);
      }
    }
  };
  visit(root.children);
  return blocks;
}

function answerStatus(answer: JudgeAnswerRow | null): string {
  if (!answer || answer.status === "not_started") return "未开始作答";
  return answer.status === "submitted" ? "已提交" : "草稿";
}

function answerTime(answer: JudgeAnswerRow | null): string {
  const value = answer?.submittedAt ?? answer?.updatedAt;
  if (!value) return "--";
  return value.replace("T", " ").replace(/\.\d{3}Z?$/, "");
}

function makeInlineTextRun(inline: Extract<Inline, { kind: "text" }>): TextRun {
  return new TextRun({
    text: inline.value,
    bold: inline.bold,
    italics: inline.italic,
    strike: inline.strike,
    underline: inline.underline ? {} : undefined,
    color: "24323A",
    font: DOCX_FONT,
    size: 22,
  });
}

function attachmentLabel(inline: Extract<Inline, { kind: "attachment" }>): string {
  return `附件：${inline.name}（${formatExportSize(inline.byteSize)}，${inline.mimeType}，下载：/api/competition/media/${inline.mediaId}）`;
}

function docxInlines(inlines: Inline[]): Array<TextRun | ExternalHyperlink> {
  return inlines.map((inline) => {
    if (inline.kind === "text") return makeInlineTextRun(inline);
    if (inline.kind === "link") {
      return new ExternalHyperlink({
        link: inline.href,
        children: [new TextRun({ text: inline.value, color: "276048", underline: {}, font: DOCX_FONT, size: 22 })],
      });
    }
    return new ExternalHyperlink({
      link: `/api/competition/media/${inline.mediaId}`,
      children: [new TextRun({ text: attachmentLabel(inline), color: "276048", bold: true, underline: {}, font: DOCX_FONT, size: 22 })],
    });
  });
}

function fitImageDimensions(width: number, height: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function docxBlock(block: ExportBlock, images: ReadonlyMap<number, ExportImage> | undefined): Paragraph {
  if (block.kind === "heading") {
    return new Paragraph({
      heading: block.level === 1 ? HeadingLevel.HEADING_1 : block.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
      spacing: { before: block.level === 1 ? 280 : 180, after: 100 },
      children: docxInlines(block.inlines),
    });
  }
  if (block.kind === "bullet" || block.kind === "number") {
    return new Paragraph({
      bullet: block.kind === "bullet" ? { level: 0 } : undefined,
      numbering: block.kind === "number" ? { reference: "answer-numbering", level: 0 } : undefined,
      indent: { left: 720, hanging: 360 },
      spacing: { after: 100, line: 276 },
      children: docxInlines(block.inlines),
    });
  }
  if (block.kind === "quote") {
    return new Paragraph({
      indent: { left: 420, right: 240 },
      border: { left: { style: BorderStyle.SINGLE, size: 16, color: "5F8C78" } },
      shading: { type: ShadingType.CLEAR, fill: "F1F5F2" },
      spacing: { before: 80, after: 140, line: 276 },
      children: docxInlines(block.inlines),
    });
  }
  if (block.kind === "code") {
    return new Paragraph({
      shading: { type: ShadingType.CLEAR, fill: "F4F6F7" },
      spacing: { before: 80, after: 140, line: 240 },
      children: [new TextRun({ text: block.value, font: DOCX_CODE_FONT, size: 19, color: "34424A" })],
    });
  }
  if (block.kind === "rule") return new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "D9E0E2" } }, spacing: { after: 160 } });
  if (block.kind === "image") {
    const image = block.mediaId ? images?.get(block.mediaId) : undefined;
    if (!image) return new Paragraph({ children: [new TextRun({ text: `图片：${block.alt}（原图无法读取）`, italics: true, color: "65737A", size: 20 })], spacing: { after: 120 } });
    const dimensions = fitImageDimensions(image.width, image.height, DOCX_IMAGE_MAX_WIDTH, DOCX_IMAGE_MAX_HEIGHT);
    return new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 80, after: 160 },
      children: [new ImageRun({
        type: "png",
        data: image.data,
        transformation: dimensions,
        altText: { name: image.alt, title: image.alt, description: image.alt },
      })],
    });
  }
  return new Paragraph({ spacing: { after: 120, line: 276 }, children: docxInlines(block.inlines) });
}

function documentHeader(title: string, contestant: JudgeExportDocumentInput["contestant"]): Header {
  return new Header({ children: [new Paragraph({
    alignment: AlignmentType.RIGHT,
    spacing: { after: 80 },
    children: [new TextRun({ text: `${SYSTEM_NAME} | ${contestant.displayName} | ${title}`, font: DOCX_FONT, size: 16, color: "748188" })],
  })] });
}

function documentFooter(): Footer {
  return new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "评委答卷归档文件", font: DOCX_FONT, size: 16, color: "8A9499" })] })] });
}

export async function buildDocx(input: JudgeExportDocumentInput): Promise<Uint8Array> {
  const answerBlocks = input.answer?.status === "not_started" ? [] : parseExportBlocks(input.answer?.contentHtml ?? "");
  const children: Paragraph[] = [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [new TextRun({ text: input.question.title, bold: true, font: DOCX_FONT, size: 34, color: "1F3A35" })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new TextRun({ text: `${input.contestant.displayName} (${input.contestant.username})`, font: DOCX_FONT, size: 22, color: "647177" })] }),
    new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: "答卷状态：", bold: true, font: DOCX_FONT, size: 22 }), new TextRun({ text: `${answerStatus(input.answer)} · ${answerTime(input.answer)}`, font: DOCX_FONT, size: 22 })] }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 260, after: 120 }, children: [new TextRun({ text: "选手回答", font: DOCX_FONT, size: 28, bold: true })] }),
  ];
  if (input.answer?.status === "not_started" || !input.answer) {
    children.push(new Paragraph({ shading: { type: ShadingType.CLEAR, fill: "FFF7E7" }, spacing: { before: 80, after: 160 }, children: [new TextRun({ text: "该选手尚未开始作答。", bold: true, color: "7A5A00", font: DOCX_FONT, size: 22 })] }));
  } else {
    children.push(...answerBlocks.map((block) => docxBlock(block, input.images)));
  }

  const document = new Document({
    creator: SYSTEM_NAME,
    title: `${input.question.title} - ${input.contestant.displayName}`,
    styles: {
      default: {
        document: { run: { font: DOCX_FONT, size: 22, color: "24323A" }, paragraph: { spacing: { after: 120, line: 276 } } },
        heading1: { run: { font: DOCX_FONT, size: 28, bold: true, color: "2E6853" }, paragraph: { spacing: { before: 280, after: 120 } } },
        heading2: { run: { font: DOCX_FONT, size: 26, bold: true, color: "2E6853" }, paragraph: { spacing: { before: 220, after: 100 } } },
        heading3: { run: { font: DOCX_FONT, size: 24, bold: true, color: "1F4D78" }, paragraph: { spacing: { before: 160, after: 80 } } },
      },
    },
    numbering: { config: [{ reference: "answer-numbering", levels: [{ level: 0, format: "decimal", text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }] },
    sections: [{
      properties: { page: { margin: { top: PAGE_MARGIN_TWIPS, right: PAGE_MARGIN_TWIPS, bottom: PAGE_MARGIN_TWIPS, left: PAGE_MARGIN_TWIPS } } },
      headers: { default: documentHeader(input.question.title, input.contestant) },
      footers: { default: documentFooter() },
      children,
    }],
  });
  return Packer.toBuffer(document);
}

interface CjkFontChoice {
  path: string;
  family?: string;
}

function cjkFontChoice(): CjkFontChoice | null {
  const configuredPath = process.env.MODELMUX_EXPORT_FONT_PATH?.trim();
  const configuredFamily = process.env.MODELMUX_EXPORT_FONT_FAMILY?.trim();
  const candidates: Array<CjkFontChoice | null> = [
    configuredPath ? { path: configuredPath, family: configuredFamily || undefined } : null,
    { path: path.join(process.cwd(), "public/fonts/NotoSerifSC-Regular.otf") },
    { path: path.join(process.cwd(), "public/fonts/NotoSerifCJKsc-Regular.otf") },
    { path: "/System/Library/Fonts/Supplemental/Songti.ttc", family: "STSongti-SC-Regular" },
    { path: "/System/Library/Fonts/STSong.ttf" },
    { path: "/Library/Fonts/Songti.ttc", family: "STSongti-SC-Regular" },
    { path: "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.otf" },
    { path: "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc", family: "NotoSerifCJKsc-Regular" },
    { path: "/usr/share/fonts/opentype/noto/NotoSerifCJKsc-Regular.otf" },
    { path: "/usr/share/fonts/opentype/noto/NotoSerifCJKsc-Regular.ttc", family: "NotoSerifCJKsc-Regular" },
    { path: "/usr/share/fonts/truetype/noto/NotoSerifCJK-Regular.ttc", family: "NotoSerifCJKsc-Regular" },
    { path: path.join(process.cwd(), "public/fonts/NotoSansSC-Regular.otf") },
    { path: "/System/Library/Fonts/Supplemental/Arial Unicode.ttf" },
    { path: "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.otf" },
    { path: "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", family: "NotoSansCJKsc-Regular" },
    { path: "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc", family: "NotoSansCJKsc-Regular" },
    { path: "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttf" },
  ];
  return candidates.find((candidate): candidate is CjkFontChoice => Boolean(candidate && existsSync(candidate.path))) ?? null;
}

function pdfBootstrapFontPath(choice: CjkFontChoice): string | null {
  if (!choice.family) return choice.path;
  const candidates = [
    path.join(process.cwd(), "public/fonts/NotoSerifSC-Regular.otf"),
    path.join(process.cwd(), "public/fonts/NotoSansSC-Regular.otf"),
    path.join(process.cwd(), "public/fonts/douyuFont.otf"),
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.otf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.otf",
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function pdfInlines(inlines: Inline[]): string {
  return inlines.map((inline) => inline.kind === "text" ? inline.value : inline.kind === "link" ? `${inline.value} (${inline.href})` : attachmentLabel(inline)).join("");
}

function writePdfBlocks(pdf: PDFKit.PDFDocument, blocks: ExportBlock[], images: ReadonlyMap<number, ExportImage> | undefined): void {
  for (const block of blocks) {
    if (block.kind === "rule") {
      const y = pdf.y + 4;
      pdf.moveTo(PDF_MARGIN, y).lineTo(pdf.page.width - PDF_MARGIN, y).strokeColor("#D9E0E2").stroke();
      pdf.moveDown(1);
    } else if (block.kind === "heading") {
      pdf.moveDown(block.level === 1 ? 0.65 : 0.35).fontSize(block.level === 1 ? 16 : block.level === 2 ? 13 : 11.5).fillColor("#2E6853").text(pdfInlines(block.inlines), { paragraphGap: 3 });
    } else if (block.kind === "quote") {
      pdf.moveDown(0.15).fillColor("#44545B").fontSize(10.5).text(`> ${pdfInlines(block.inlines)}`, { indent: 12, paragraphGap: 6 });
    } else if (block.kind === "code") {
      pdf.moveDown(0.15).fontSize(9).fillColor("#34424A").text(block.value, { indent: 12, width: pdf.page.width - PDF_MARGIN * 2 - 24, paragraphGap: 8 });
    } else if (block.kind === "image") {
      const image = block.mediaId ? images?.get(block.mediaId) : undefined;
      if (!image) {
        pdf.fontSize(10).fillColor("#65737A").text(`图片：${block.alt}（原图无法读取）`, { paragraphGap: 7 });
        continue;
      }
      const dimensions = fitImageDimensions(image.width, image.height, pdf.page.width - PDF_MARGIN * 2, PDF_IMAGE_MAX_HEIGHT);
      const bottom = pdf.page.height - PDF_MARGIN;
      if (pdf.y + dimensions.height > bottom) pdf.addPage();
      const x = (pdf.page.width - dimensions.width) / 2;
      pdf.image(Buffer.from(image.data), x, pdf.y, { width: dimensions.width, height: dimensions.height });
      pdf.y += dimensions.height + 10;
    } else {
      const prefix = block.kind === "bullet" ? "• " : block.kind === "number" ? "1. " : "";
      pdf.fontSize(10.5).fillColor("#24323A").text(`${prefix}${pdfInlines(block.inlines)}`, { indent: prefix ? 10 : 0, paragraphGap: 5 });
    }
  }
}

export async function writePdf(input: JudgeExportDocumentInput, filePath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const font = cjkFontChoice();
    const bootstrapFontPath = font ? pdfBootstrapFontPath(font) : null;
    if (!font || !bootstrapFontPath) throw new Error("export_font_missing");
    const pdf = new PDFDocument({ size: "A4", margins: { top: PDF_MARGIN + 18, bottom: PDF_MARGIN, left: PDF_MARGIN, right: PDF_MARGIN }, font: bootstrapFontPath, info: { Title: `${input.question.title} - ${input.contestant.displayName}`, Author: SYSTEM_NAME } });
    const output = createWriteStream(filePath, { flags: "wx", mode: 0o600 });
    pdf.registerFont("CJK", font.path, font.family);
    pdf.font("CJK");
    const drawHeader = () => {
      pdf.font("CJK");
      pdf.fontSize(8).fillColor("#7A858A").text(`${SYSTEM_NAME} | ${input.contestant.displayName}`, PDF_MARGIN, 25, { width: pdf.page.width - PDF_MARGIN * 2, align: "right", lineBreak: false });
    };
    pdf.on("pageAdded", drawHeader);
    output.on("error", reject);
    pdf.on("error", reject);
    output.on("finish", resolve);
    pdf.pipe(output);
    drawHeader();
    pdf.fontSize(20).fillColor("#1F3A35").text(input.question.title, { align: "center", paragraphGap: 4 });
    pdf.fontSize(11).fillColor("#647177").text(`${input.contestant.displayName} (${input.contestant.username})`, { align: "center", paragraphGap: 16 });
    pdf.fontSize(10.5).fillColor("#24323A").text(`答卷状态：${answerStatus(input.answer)} · ${answerTime(input.answer)}`, { paragraphGap: 10 });
    pdf.fontSize(14).fillColor("#2E6853").text("选手回答", { paragraphGap: 7 });
    if (input.answer?.status === "not_started" || !input.answer) {
      pdf.fontSize(10.5).fillColor("#7A5A00").text("该选手尚未开始作答。", { paragraphGap: 8 });
    } else {
      writePdfBlocks(pdf, parseExportBlocks(input.answer.contentHtml), input.images);
    }
    pdf.end();
  });
}

async function writeDocumentFiles(input: JudgeExportDocumentInput, directory: string, prefix: string): Promise<void> {
  const images = await loadAnswerImages(input.answer, input.contestant.id);
  const documentInput = { ...input, images };
  await writeFile(path.join(directory, `${prefix}.docx`), await buildDocx(documentInput), { flag: "wx", mode: 0o600 });
  await writePdf(documentInput, path.join(directory, `${prefix}.pdf`));
}

async function loadAnswerImages(answer: JudgeAnswerRow | null, contestantId: number): Promise<Map<number, ExportImage>> {
  if (!answer || answer.status === "not_started") return new Map();
  const references = new Map<number, string>();
  for (const block of parseExportBlocks(answer.contentHtml)) {
    if (block.kind === "image" && block.mediaId) references.set(block.mediaId, block.alt);
  }

  const loaded = await Promise.all(Array.from(references, async ([mediaId, alt]) => {
    const media = await readMedia(mediaId);
    if (!media) return null;
    if (
      media.kind !== "image"
      || media.purpose !== "answer"
      || media.uploaderRole !== "contestant"
      || media.uploaderId !== contestantId
    ) {
      await media.stream.cancel().catch(() => undefined);
      return null;
    }
    try {
      const source = Buffer.from(await new Response(media.stream as unknown as BodyInit).arrayBuffer());
      const result = await sharp(source, { animated: false, failOn: "error" })
        .rotate()
        .resize({
          width: EXPORT_IMAGE_PROCESS_MAX_WIDTH,
          height: EXPORT_IMAGE_PROCESS_MAX_HEIGHT,
          fit: "inside",
          withoutEnlargement: true,
        })
        .png({ compressionLevel: 8 })
        .toBuffer({ resolveWithObject: true });
      if (!result.info.width || !result.info.height) return null;
      return [mediaId, {
        data: result.data,
        width: result.info.width,
        height: result.info.height,
        alt: media.originalName || alt,
      }] as const;
    } catch {
      return null;
    }
  }));

  return new Map(loaded.filter((entry): entry is NonNullable<typeof entry> => entry !== null));
}

export async function createJudgeAnswerArchive(snapshot: JudgeAnswerExportSnapshot, date = new Date()): Promise<JudgeExportArchive> {
  const root = await mkdtemp(path.join(dataDirectory(), "judge-export-"));
  const outputDirectory = path.join(root, EXPORT_ROOT_NAME);
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  try {
    const answerByKey = new Map(snapshot.answers.map((answer) => [`${answer.questionId}:${answer.contestantId}`, answer]));
    for (const contestant of snapshot.contestants) {
      const contestantDirectory = path.join(outputDirectory, safeExportName(`${contestant.username}_${contestant.displayName}`, `选手_${contestant.id}`));
      await mkdir(contestantDirectory, { recursive: true, mode: 0o700 });
      for (const [index, question] of snapshot.questions.entries()) {
        const prefix = safeExportName(`${String(index + 1).padStart(2, "0")}_${question.title}`, `题目_${question.id}`);
        await writeDocumentFiles({ question, contestant, answer: answerByKey.get(`${question.id}:${contestant.id}`) ?? null }, contestantDirectory, prefix);
      }
    }
    const filename = `${EXPORT_ROOT_NAME}-${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date)}.zip`;
    const filePath = path.join(root, filename);
    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(filePath, { flags: "wx", mode: 0o600 });
      const archive = new ZipArchive({ zlib: { level: 6 } });
      output.on("close", resolve);
      output.on("error", reject);
      archive.on("error", reject);
      archive.pipe(output);
      archive.directory(outputDirectory, false);
      void archive.finalize().catch(reject);
    });
    await rm(outputDirectory, { recursive: true, force: true });
    return { filePath, directory: root, filename };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
