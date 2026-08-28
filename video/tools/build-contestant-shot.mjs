#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(toolDir, "..", "..");
const videoDir = path.join(repoDir, "video");
const contestantDir = path.join(videoDir, "contestant");
const sourceDir = path.join(contestantDir, "source");
const shotsDir = path.join(contestantDir, "shots");
const previewsDir = path.join(contestantDir, "previews");
const workRoot = path.join(contestantDir, "work");

const regularFont = "/System/Library/Fonts/STHeiti Light.ttc";
const boldFont = "/System/Library/Fonts/STHeiti Medium.ttc";
const width = 1920;
const height = 1080;
const fps = 30;

const shotId = process.argv[2] ?? "01";
if (shotId !== "01") {
  throw new Error(`镜头 ${shotId} 尚未制作。当前只允许生成镜头 01。`);
}

const shot = {
  id: "01",
  slug: "片头",
  outputName: "01-片头.mp4",
  scenes: [
    {
      asset: "title",
      text: "本视频介绍排污单位自行监测质量 AI 核查赛道的选手操作流程。",
    },
    {
      asset: "scope",
      text: "内容包括赛前设备与知识库准备、模型 API 接入测试和比赛测试环境操作演练、正式比赛作答以及异常情况处理。",
    },
    {
      asset: "notice",
      text: "请参赛选手在赛前完整观看，并按照组委会通知完成各项准备。",
    },
  ],
};

const workDir = path.join(workRoot, shot.id);
const outputFile = path.join(shotsDir, shot.outputName);
const subtitleFile = path.join(shotsDir, `${shot.id}-${shot.slug}.srt`);
const infoFile = path.join(shotsDir, `${shot.id}-${shot.slug}.json`);

rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });
mkdirSync(shotsDir, { recursive: true });
mkdirSync(previewsDir, { recursive: true });
rmSync(outputFile, { force: true });
rmSync(subtitleFile, { force: true });
rmSync(infoFile, { force: true });

function run(command, args, options = {}) {
  process.stdout.write(`[contestant-video] ${command} ${args.slice(0, 5).join(" ")}\n`);
  execFileSync(command, args, { stdio: "inherit", ...options });
}

function probeDuration(file) {
  return Number(execFileSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    file,
  ], { encoding: "utf8" }).trim());
}

function srtTime(seconds) {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const secs = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const mins = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function makeCaption(text, output) {
  const caption = path.join(workDir, `${path.basename(output, ".png")}-caption.png`);
  run("magick", [
    "-background", "none",
    "-fill", "#ffffff",
    "-font", regularFont,
    "-pointsize", "32",
    "-gravity", "center",
    "-size", "1680x116",
    `caption:${text}`,
    caption,
  ]);
  run("magick", [
    output,
    "-fill", "rgba(7,27,45,0.94)",
    "-draw", "rectangle 0,930 1920,1080",
    "-fill", "#48a889",
    "-draw", "rectangle 0,930 14,1080",
    caption,
    "-gravity", "northwest",
    "-geometry", "+120+950",
    "-composite",
    output,
  ]);
}

function makeBaseVisual(output) {
  const source = path.join(repoDir, "主视觉.jpg");
  if (!existsSync(source)) throw new Error(`缺少竞赛主视觉：${source}`);
  const banner = path.join(workDir, "competition-banner.png");
  run("magick", [source, "-resize", "1920x768!", banner]);
  run("magick", [
    "-size", `${width}x${height}`,
    "xc:#edf6f8",
    banner,
    "-gravity", "north",
    "-geometry", "+0+0",
    "-composite",
    "-fill", "#0c3558",
    "-draw", "rectangle 0,700 1920,1080",
    "-fill", "#38a482",
    "-draw", "rectangle 0,700 1920,714",
    output,
  ]);
}

function makeTitleFrame(text) {
  const output = path.join(workDir, "title.png");
  makeBaseVisual(output);
  run("magick", [
    output,
    "-font", boldFont,
    "-fill", "#ffffff",
    "-pointsize", "60",
    "-gravity", "northwest",
    "-annotate", "+118+756", "选手赛前、赛中操作说明",
    "-font", regularFont,
    "-fill", "#cce4ec",
    "-pointsize", "30",
    "-annotate", "+122+842", "排污单位自行监测质量 AI 核查赛道",
    output,
  ]);
  makeCaption(text, output);
  return output;
}

function makeKnowledgeLogoPanel() {
  const output = path.join(workDir, "knowledge-tool-logos.png");
  const logos = [
    { source: "cherry-studio-home.png", crop: "190x60+280+20", size: "100x30", x: 10, y: 38 },
    { source: "dify-workflow.png", crop: "75x55+20+5", size: "65x30", x: 135, y: 38 },
    { source: "langchain.png", crop: "170x60+150+15", size: "110x32", x: 10, y: 100 },
    { source: "llamaindex.png", crop: "145x50+55+65", size: "80x30", x: 132, y: 100 },
    { source: "milvus-attu.png", crop: "105x50+40+60", size: "90x30", x: 65, y: 164 },
  ];
  const testEnvironment = path.join(workDir, "test-environment-thumb.png");
  run("magick", [
    path.join(sourceDir, "notice-images", "image2.png"), "-resize", "205x115",
    "-background", "#f3f6f5", "-gravity", "center", "-extent", "205x115", testEnvironment,
  ]);
  const args = [
    "-size", "440x248", "xc:#ffffff",
    "-stroke", "#d9e2e0", "-strokewidth", "2", "-fill", "none",
    "-draw", "roundrectangle 1,1 438,246 5,5",
    "-stroke", "#d9e2e0", "-draw", "line 220,18 220,230", "-stroke", "none",
    testEnvironment, "-gravity", "northwest", "-geometry", "+228+66", "-composite",
  ];
  logos.forEach((logo, index) => {
    const logoFile = path.join(workDir, `knowledge-logo-${index}.png`);
    run("magick", [
      path.join(sourceDir, "official", logo.source), "-crop", logo.crop, "+repage",
      "-trim", "+repage", "-resize", logo.size, logoFile,
    ]);
    args.push(logoFile, "-gravity", "northwest", "-geometry", `+${logo.x}+${logo.y}`, "-composite");
  });
  args.push(output);
  run("magick", args);
  return output;
}

function makeScopeFrame(text) {
  const output = path.join(workDir, "scope.png");
  const knowledgeLogos = makeKnowledgeLogoPanel();
  const visuals = [
    [path.join(sourceDir, "generated", "equipment-preparation.png"), "赛前设备与知识库准备"],
    [knowledgeLogos, ["模型 API 接入测试", "比赛测试环境操作演练"]],
    [path.join(sourceDir, "notice-images", "image2.png"), "正式比赛作答"],
    [path.join(sourceDir, "generated", "raise-hand-report.png"), "异常情况处理"],
  ];
  const args = ["-size", `${width}x${height}`, "xc:#edf2f1"];
  visuals.forEach(([source, label], index) => {
    const thumb = path.join(workDir, `scope-${index}.png`);
    const x = 40 + index * 470;
    run("magick", [source, "-resize", "440x248!", thumb]);
    args.push(
      "-fill", "#ffffff", "-stroke", "#d7dfde", "-strokewidth", "2",
      "-draw", `roundrectangle ${x},265 ${x + 440},660 5,5`,
      "-stroke", "none",
      thumb, "-gravity", "northwest", "-geometry", `+${x}+265`, "-composite",
      "-fill", "rgba(5,23,34,0.92)", "-draw", `rectangle ${x},513 ${x + 440},660`,
    );
    const lines = Array.isArray(label) ? label : [label];
    const labelImage = path.join(workDir, `scope-label-${index}.png`);
    run("magick", [
      "-background", "none", "-fill", "#ffffff", "-font", boldFont,
      "-pointsize", lines.length > 1 ? "27" : "31", "-gravity", "center",
      "-size", "390x120", `caption:${lines.join("\n")}`, labelImage,
    ]);
    args.push(labelImage, "-gravity", "northwest", "-geometry", `+${x + 25}+527`, "-composite");
  });
  args.push(
    "-fill", "rgba(5,23,34,0.88)", "-draw", "rectangle 0,0 1920,150",
    "-font", boldFont, "-fill", "#ffffff", "-pointsize", "46", "-gravity", "northwest",
    "-annotate", "+50+35", "从赛前准备、接口测试与操作演练到正式比赛作答和异常报告",
    "-font", regularFont, "-fill", "#cfe0e3", "-pointsize", "25", "-annotate", "+52+96", "全片使用真实场景、官方软件界面和当前答题系统画面",
    output,
  );
  run("magick", args);
  makeCaption(text, output);
  return output;
}

function makeNoticeFrame(text) {
  const output = path.join(workDir, "notice.png");
  run("magick", [
    "-size", `${width}x${height}`, "xc:#f3f7f6",
    "-font", boldFont, "-fill", "#173f48", "-pointsize", "78", "-gravity", "center",
    "-annotate", "+0-65", "请在赛前完整观看",
    output,
  ]);
  makeCaption(text, output);
  return output;
}

function synthesize(text, output) {
  run("say", ["-v", "Tingting", "-r", "165", "-o", output, text]);
}

function makeSegment(frame, audio, duration, output) {
  const fadeOut = Math.max(0.5, duration - 0.4).toFixed(3);
  run("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-loop", "1", "-framerate", String(fps), "-i", frame,
    "-i", audio,
    "-vf", `scale=1920:1080,fade=t=in:st=0:d=0.3,fade=t=out:st=${fadeOut}:d=0.4`,
    "-af", "apad=pad_dur=0.55",
    "-t", duration.toFixed(3),
    "-r", String(fps),
    "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart",
    output,
  ]);
}

function concatFiles(files, output) {
  const listFile = path.join(workDir, "segments.concat.txt");
  writeFileSync(listFile, files.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join("\n") + "\n");
  run("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "concat", "-safe", "0", "-i", listFile,
    "-c", "copy", "-movflags", "+faststart", output,
  ]);
}

const frameFactories = {
  title: makeTitleFrame,
  scope: makeScopeFrame,
  notice: makeNoticeFrame,
};

const segments = [];
const subtitles = [];
const sceneInfo = [];
let start = 0;

for (let index = 0; index < shot.scenes.length; index += 1) {
  const scene = shot.scenes[index];
  const prefix = `${shot.id}-${String(index + 1).padStart(2, "0")}`;
  const audio = path.join(workDir, `${prefix}.aiff`);
  const segment = path.join(workDir, `${prefix}.mp4`);
  const frame = frameFactories[scene.asset](scene.text);
  synthesize(scene.text, audio);
  const speechDuration = probeDuration(audio);
  const duration = speechDuration + 0.55;
  makeSegment(frame, audio, duration, segment);
  segments.push(segment);
  subtitles.push(`${index + 1}\n${srtTime(start)} --> ${srtTime(start + speechDuration)}\n${scene.text}\n`);
  sceneInfo.push({
    scene: index + 1,
    asset: scene.asset,
    speechDurationSeconds: Number(speechDuration.toFixed(3)),
    durationSeconds: Number(duration.toFixed(3)),
  });
  start += duration;
}

concatFiles(segments, outputFile);
writeFileSync(subtitleFile, subtitles.join("\n"), "utf8");
writeFileSync(infoFile, JSON.stringify({
  generatedAt: new Date().toISOString(),
  shot: shot.id,
  title: shot.slug,
  voice: "Tingting",
  voiceRate: 165,
  durationSeconds: Number(start.toFixed(3)),
  video: path.basename(outputFile),
  subtitles: path.basename(subtitleFile),
  scenes: sceneInfo,
}, null, 2) + "\n", "utf8");

const previewTimes = [2, Math.min(10, start / 2), Math.max(2, start - 2)];
for (let index = 0; index < previewTimes.length; index += 1) {
  run("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-ss", previewTimes[index].toFixed(3), "-i", outputFile,
    "-frames:v", "1",
    path.join(previewsDir, `${shot.id}-${String(index + 1).padStart(2, "0")}.png`),
  ]);
}

process.stdout.write(`[contestant-video] complete: ${outputFile}\n`);
