import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

import { describe, expect, it } from "vitest";
import sharp from "sharp";

import { createJudgeAnswerArchive, buildDocx, formatExportSize, parseExportBlocks, safeExportName, writePdf } from "./judge-export";
import type { JudgeAnswerExportSnapshot } from "./repository";
import type { JudgeAnswerRow } from "./types";

const question = {
  id: 11,
  title: "河流断面分析 / 2026",
  contentHtml: `<h2>任务要求</h2><p>请结合 <strong>监测数据</strong> 给出结论。</p><ul><li>说明异常点</li><li>给出建议</li></ul><p><a class="rich-attachment" data-attachment-id="42" data-attachment-name="原始数据.pdf" data-attachment-size="73400320" data-attachment-type="application/pdf" href="/api/competition/media/42">附件</a></p>`,
  status: "closed" as const,
  version: 1,
  createdAt: "2026-08-20 09:00:00.000",
  updatedAt: "2026-08-20 09:00:00.000",
  publishedAt: "2026-08-20 09:00:00.000",
  closedAt: "2026-08-20 12:00:00.000",
  authorName: "评委",
};

const contestant = { id: 7, username: "player07", displayName: "选手七" };

const submittedAnswer: JudgeAnswerRow = {
  id: 81,
  questionId: question.id,
  contentHtml: `<p>这是选手回答正文。</p><img src="/api/competition/media/99" alt="现场截图.png">`,
  status: "submitted",
  firstSavedAt: "2026-08-20 10:00:00.000",
  updatedAt: "2026-08-20 10:30:00.000",
  submittedAt: "2026-08-20 10:30:00.000",
  contestantId: contestant.id,
  contestantName: contestant.displayName,
  username: contestant.username,
};

describe("judge answer export", () => {
  it("sanitizes archive path segments and formats arbitrary file sizes", () => {
    expect(safeExportName("../选手:七?", "fallback")).toBe(".._选手_七_");
    expect(formatExportSize(70 * 1024 * 1024)).toBe("70.0 MB");
  });

  it("turns rich text into document blocks without loading attachment bytes", () => {
    const blocks = parseExportBlocks(question.contentHtml);
    expect(blocks.map((block) => block.kind)).toEqual(["heading", "paragraph", "bullet", "bullet", "paragraph"]);
    expect(JSON.stringify(blocks)).toContain("73400320");
    expect(JSON.stringify(blocks)).not.toContain("原始数据.pdf\"}");
  });

  it("exports attachments whose download action is limited to the button", () => {
    const blocks = parseExportBlocks(
      '<div class="rich-attachment" data-attachment-id="43" data-attachment-name="监测视频.mp4" data-attachment-size="20552090" data-attachment-type="video/mp4"><span class="attachment-type">MP4</span><span class="attachment-details"><strong>监测视频.mp4</strong><small>19.6 MB</small></span><a class="attachment-download" href="/api/competition/media/43" download="监测视频.mp4">下载</a></div>',
    );

    expect(blocks).toContainEqual({
      kind: "paragraph",
      inlines: [{
        kind: "attachment",
        mediaId: 43,
        name: "监测视频.mp4",
        byteSize: 20552090,
        mimeType: "video/mp4",
      }],
    });
  });

  it("reads stored image ids from image src attributes", () => {
    expect(parseExportBlocks(submittedAnswer.contentHtml)).toContainEqual({
      kind: "image",
      alt: "现场截图.png",
      mediaId: 99,
    });
  });

  it("embeds answer images in docx and omits repeated question content", async () => {
    const directory = await mkdtemp(path.join(process.cwd(), "tmp-judge-export-image-test-"));
    try {
      const image = await sharp({
        create: { width: 800, height: 450, channels: 3, background: "#3b8764" },
      }).png().toBuffer();
      const docxPath = path.join(directory, "answer-with-image.docx");
      const input = {
        question,
        contestant,
        answer: submittedAnswer,
        images: new Map([[99, { data: image, width: 800, height: 450, alt: "现场截图.png" }]]),
      };
      await writeFile(docxPath, await buildDocx(input));
      const pdfPath = path.join(directory, "answer-with-image.pdf");
      await writePdf(input, pdfPath);

      const entries = (await promisify(execFile)("unzip", ["-Z1", docxPath])).stdout.trim().split("\n");
      const documentXml = (await promisify(execFile)("unzip", ["-p", docxPath, "word/document.xml"])).stdout;
      const stylesXml = (await promisify(execFile)("unzip", ["-p", docxPath, "word/styles.xml"])).stdout;
      const pdfText = (await promisify(execFile)("pdftotext", [pdfPath, "-"])).stdout;
      expect(entries.some((entry) => entry.startsWith("word/media/"))).toBe(true);
      expect(documentXml).toContain('w:ascii="Times New Roman"');
      expect(documentXml).toContain('w:eastAsia="SimSun"');
      expect(stylesXml).toContain('w:ascii="Times New Roman"');
      expect(stylesXml).toContain('w:eastAsia="SimSun"');
      expect(documentXml).toContain("河流断面分析 / 2026");
      expect(documentXml).toContain("这是选手回答正文");
      expect(documentXml).not.toContain("任务要求");
      expect(documentXml).not.toContain("请结合");
      expect(documentXml).not.toContain(">题目<");
      expect(pdfText).toContain("河流断面分析 / 2026");
      expect(pdfText).toContain("这是选手回答正文");
      expect(pdfText).not.toContain("任务要求");
      expect(pdfText).not.toContain("请结合");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("creates a docx and pdf for a not-started answer", async () => {
    const directory = await mkdtemp(path.join(process.cwd(), "tmp-judge-export-test-"));
    try {
      const input = { question, contestant, answer: null };
      const docx = await buildDocx(input);
      await writePdf(input, path.join(directory, "answer.pdf"));
      expect(docx.byteLength).toBeGreaterThan(1000);
      expect((await readFile(path.join(directory, "answer.pdf"))).byteLength).toBeGreaterThan(1000);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("groups every question under every active contestant folder", async () => {
    const dataDirectory = await mkdtemp(path.join(process.cwd(), "tmp-judge-export-data-"));
    const previous = process.env.MODELMUX_DATA_DIR;
    process.env.MODELMUX_DATA_DIR = dataDirectory;
    const snapshot: JudgeAnswerExportSnapshot = {
      questions: [question, { ...question, id: 12, title: "第二题" }],
      contestants: [contestant, { id: 8, username: "player08", displayName: "选手八" }],
      answers: [],
    };
    try {
      const archive = await createJudgeAnswerArchive(snapshot, new Date("2026-08-20T04:00:00Z"));
      const entries = (await promisify(execFile)("unzip", ["-Z1", archive.filePath])).stdout.trim().split("\n");
      expect(entries).toHaveLength(10); // two contestant directory entries plus eight files
      expect(entries.filter((entry) => entry.endsWith(".docx"))).toHaveLength(4);
      expect(entries.filter((entry) => entry.endsWith(".pdf"))).toHaveLength(4);
      expect(entries.some((entry) => entry.includes("player07_"))).toBe(true);
      await rm(archive.directory, { recursive: true, force: true });
    } finally {
      if (previous === undefined) delete process.env.MODELMUX_DATA_DIR;
      else process.env.MODELMUX_DATA_DIR = previous;
      await rm(dataDirectory, { recursive: true, force: true });
    }
  });
});
