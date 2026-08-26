#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const videoDir = path.resolve(toolDir, "..");
const assetsDir = path.join(videoDir, "assets");
const screensDir = path.join(assetsDir, "screens");
const generatedDir = path.join(assetsDir, "generated");
const audioDir = path.join(assetsDir, "audio");
const framesDir = path.join(assetsDir, "frames");
const segmentsDir = path.join(assetsDir, "segments");
const chaptersDir = path.join(videoDir, "chapters");
const outputDir = path.join(videoDir, "output");
const chapters = JSON.parse(readFileSync(path.join(videoDir, "script", "chapters.json"), "utf8"));

const regularFont = "/System/Library/Fonts/STHeiti Light.ttc";
const boldFont = "/System/Library/Fonts/STHeiti Medium.ttc";
const width = 1920;
const height = 1080;
const fps = 30;

for (const directory of [generatedDir, audioDir, framesDir, segmentsDir, chaptersDir, outputDir]) {
  rmSync(directory, { force: true, recursive: true });
}
for (const directory of [generatedDir, audioDir, framesDir, segmentsDir, chaptersDir, outputDir]) {
  mkdirSync(directory, { recursive: true });
}

function run(command, args, options = {}) {
  process.stdout.write(`\n[video] ${command} ${args.slice(0, 5).join(" ")}\n`);
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

function makeTitleCard(chapter) {
  const output = path.join(generatedDir, `title-${chapter.id}.png`);
  run("magick", [
    "-size", `${width}x${height}`, "xc:#f5f7f6",
    "-fill", "#17221f", "-draw", "rectangle 0,0 1920,300",
    "-fill", "#16705a", "-draw", "rectangle 0,300 28,1080",
    "-fill", "#d9e9e3", "-draw", "rectangle 1320,300 1920,1080",
    "-font", boldFont, "-fill", "#ffffff", "-pointsize", "34",
    "-gravity", "northwest", "-annotate", "+120+102", "江苏省监测技能竞赛在线答题系统",
    "-font", regularFont, "-fill", "#b9d4ca", "-pointsize", "26",
    "-annotate", "+120+176", "系统介绍视频",
    "-font", boldFont, "-fill", "#16705a", "-pointsize", "44",
    "-annotate", "+120+430", `CHAPTER ${chapter.id}`,
    "-font", boldFont, "-fill", "#14211e", "-pointsize", "78",
    "-annotate", "+120+540", chapter.title,
    "-font", regularFont, "-fill", "#475b55", "-pointsize", "36",
    "-annotate", "+120+680", chapter.kicker,
    "-fill", "#c7513f", "-draw", "circle 1610,580 1610,470",
    "-font", boldFont, "-fill", "#ffffff", "-pointsize", "88",
    "-gravity", "center", "-annotate", "+650+40", chapter.id,
    output,
  ]);
  return output;
}

function makeStagesCard() {
  const output = path.join(generatedDir, "stages.png");
  run("magick", [
    "-size", `${width}x${height}`, "xc:#f5f7f6",
    "-fill", "#17221f", "-draw", "rectangle 0,0 1920,220",
    "-font", boldFont, "-fill", "#ffffff", "-pointsize", "58",
    "-gravity", "northwest", "-annotate", "+120+75", "系统覆盖两个使用阶段",
    "-font", regularFont, "-fill", "#b9d4ca", "-pointsize", "28",
    "-annotate", "+120+155", "赛前完成接入与调试，赛中进入正式使用",
    "-fill", "#ffffff", "-stroke", "#cbd8d3", "-strokewidth", "2",
    "-draw", "roundrectangle 120,310 900,850 12,12",
    "-draw", "roundrectangle 1020,310 1800,850 12,12",
    "-stroke", "none", "-fill", "#16705a", "-draw", "rectangle 120,310 900,326",
    "-fill", "#c7513f", "-draw", "rectangle 1020,310 1800,326",
    "-font", boldFont, "-fill", "#16705a", "-pointsize", "52",
    "-annotate", "+190+420", "赛前测试",
    "-font", regularFont, "-fill", "#334b44", "-pointsize", "34",
    "-annotate", "+190+515", "开通账号和模型服务",
    "-annotate", "+190+585", "获取个人接入凭证",
    "-annotate", "+190+655", "接入知识库并完成调试",
    "-font", boldFont, "-fill", "#c7513f", "-pointsize", "52",
    "-annotate", "+1090+420", "赛中正式环境",
    "-font", regularFont, "-fill", "#334b44", "-pointsize", "34",
    "-annotate", "+1090+515", "沿用相同接入方式",
    "-annotate", "+1090+585", "多路模型服务保障",
    "-annotate", "+1090+655", "完成正式出题和答题",
    "-fill", "#16705a", "-draw", "polygon 925,555 995,555 995,525 1045,580 995,635 995,605 925,605",
    output,
  ]);
  return output;
}

function makeStatusCard() {
  const output = path.join(generatedDir, "status.png");
  run("magick", [
    "-size", `${width}x${height}`, "xc:#f5f7f6",
    "-fill", "#17221f", "-draw", "rectangle 0,0 1920,210",
    "-font", boldFont, "-fill", "#ffffff", "-pointsize", "54",
    "-gravity", "northwest", "-annotate", "+120+72", "线上环境实测状态",
    "-font", regularFont, "-fill", "#b9d4ca", "-pointsize", "28",
    "-annotate", "+120+142", "2026-08-19 · https://dbw.lic-inc.com",
    "-fill", "#ffffff", "-stroke", "#d8dfdc", "-strokewidth", "2",
    "-draw", "roundrectangle 120,290 1800,830 14,14",
    "-stroke", "none", "-fill", "#16705a", "-draw", "circle 205,410 205,382",
    "-fill", "#16705a", "-draw", "circle 205,535 205,507",
    "-fill", "#c7513f", "-draw", "circle 205,660 205,632",
    "-font", boldFont, "-fill", "#14211e", "-pointsize", "38",
    "-annotate", "+275+395", "公网入口可访问，统一登录页正常",
    "-annotate", "+275+520", "数据库可连接，未授权请求返回 401",
    "-annotate", "+275+645", "模型网关健康状态：503 · 待配置",
    "-font", regularFont, "-fill", "#5b6d67", "-pointsize", "30",
    "-annotate", "+275+705", "补齐配置并完成端到端复测后，方可定义为正式就绪",
    "-fill", "#c7513f", "-draw", "rectangle 120,900 1800,906",
    "-font", boldFont, "-fill", "#963526", "-pointsize", "34",
    "-annotate", "+120+955", "汇报口径：已部署可访问，不等于模型 API 已全部上线",
    output,
  ]);
  return output;
}

function censorApiDocs() {
  const raw = path.join(screensDir, "04-contestant-api-docs-raw.png");
  const output = path.join(screensDir, "04-contestant-api-docs.png");
  if (existsSync(raw)) {
    run("magick", [
      raw,
      "-fill", "#e8eeeb", "-stroke", "#c9d5d0", "-strokewidth", "1",
      "-draw", "roundrectangle 725,405 1135,452 8,8",
      "-stroke", "none", "-font", boldFont, "-fill", "#36584e", "-pointsize", "24",
      "-gravity", "northwest", "-annotate", "+760+416", "DEMO KEY HIDDEN",
      "-fill", "#22282b", "-draw", "roundrectangle 390,680 880,725 5,5",
      "-font", boldFont, "-fill", "#d8e5df", "-pointsize", "22",
      "-annotate", "+430+690", "Authorization: Bearer DEMO_KEY",
      output,
    ]);
  }

  const playgroundRaw = path.join(screensDir, "04b-playground-raw.png");
  const playground = path.join(screensDir, "04b-playground.png");
  if (existsSync(playgroundRaw)) run("magick", [playgroundRaw, playground]);
}

function normalizeAsset(input, output) {
  run("magick", [
    input,
    "-auto-orient", "-resize", "1920x1080^", "-gravity", "center", "-extent", "1920x1080", "-blur", "0x20",
    input,
    "-auto-orient", "-resize", "1920x1080",
    "-gravity", "center", "-compose", "over", "-composite",
    "-fill", "rgba(8,18,15,0.08)", "-draw", "rectangle 0,0 1920,1080",
    output,
  ]);
}

function makeSubtitleFrame(baseImage, chapter, text, output) {
  const captionImage = path.join(generatedDir, `caption-${chapter.id}-${path.basename(output, ".png")}.png`);
  run("magick", [
    "-background", "none", "-fill", "#ffffff",
    "-font", regularFont, "-pointsize", "36",
    "-gravity", "northwest", "-size", "1680x176",
    `caption:${text}`,
    captionImage,
  ]);
  run("magick", [
    baseImage,
    "-fill", "rgba(12,22,19,0.93)", "-draw", "rectangle 0,790 1920,1080",
    "-fill", "#16705a", "-draw", "rectangle 0,790 18,1080",
    "-font", boldFont, "-fill", "#b9d4ca", "-pointsize", "24",
    "-gravity", "northwest", "-annotate", "+80+824", `${chapter.id}  ${chapter.title}`,
    captionImage,
    "-gravity", "northwest",
    "-geometry", "+80+864", "-composite",
    output,
  ]);
}

function synthesize(text, output) {
  run("say", ["-v", "Tingting", "-r", "165", "-o", output, text]);
}

function makeSegment(frame, audio, duration, output) {
  const fadeOut = Math.max(0.4, duration - 0.35).toFixed(3);
  run("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-loop", "1", "-framerate", String(fps), "-i", frame,
    "-i", audio,
    "-vf", `fade=t=in:st=0:d=0.25,fade=t=out:st=${fadeOut}:d=0.35`,
    "-af", "apad=pad_dur=0.45",
    "-t", duration.toFixed(3),
    "-r", String(fps), "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart", output,
  ]);
}

function concatFiles(files, output, reencode = false) {
  const listFile = `${output}.concat.txt`;
  writeFileSync(listFile, files.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join("\n") + "\n");
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile];
  if (reencode) {
    args.push("-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k");
  } else {
    args.push("-c", "copy");
  }
  args.push("-movflags", "+faststart", output);
  run("ffmpeg", args);
  rmSync(listFile, { force: true });
}

censorApiDocs();
const stagesCard = makeStagesCard();

const normalized = new Map();
function resolvedAsset(chapter, asset) {
  if (asset === "title") return makeTitleCard(chapter);
  if (asset === "stages") return stagesCard;
  const source = path.join(screensDir, asset);
  if (!normalized.has(source)) {
    const output = path.join(generatedDir, `normalized-${path.basename(asset, path.extname(asset))}.png`);
    normalizeAsset(source, output);
    normalized.set(source, output);
  }
  return normalized.get(source);
}

const chapterFiles = [];
const srtBlocks = [];
let globalStart = 0;
let subtitleIndex = 1;

for (const chapter of chapters) {
  const chapterSegments = [];
  let chapterStart = 0;
  for (let index = 0; index < chapter.scenes.length; index += 1) {
    const scene = chapter.scenes[index];
    const prefix = `${chapter.id}-${String(index + 1).padStart(2, "0")}`;
    const audio = path.join(audioDir, `${prefix}.aiff`);
    const frame = path.join(framesDir, `${prefix}.png`);
    const segment = path.join(segmentsDir, `${prefix}.mp4`);
    synthesize(scene.text, audio);
    const speechDuration = probeDuration(audio);
    const duration = speechDuration + 0.45;
    makeSubtitleFrame(resolvedAsset(chapter, scene.asset), chapter, scene.text, frame);
    makeSegment(frame, audio, duration, segment);
    chapterSegments.push(segment);
    srtBlocks.push(`${subtitleIndex}\n${srtTime(globalStart)} --> ${srtTime(globalStart + speechDuration)}\n${scene.text}\n`);
    subtitleIndex += 1;
    chapterStart += duration;
    globalStart += duration;
  }
  const chapterFile = path.join(chaptersDir, `${chapter.id}-${chapter.slug}.mp4`);
  concatFiles(chapterSegments, chapterFile);
  chapterFiles.push(chapterFile);
  process.stdout.write(`\n[video] chapter ${chapter.id}: ${chapterStart.toFixed(1)}s -> ${chapterFile}\n`);
}

const finalFile = path.join(outputDir, "江苏省监测技能竞赛在线答题系统-领导汇报.mp4");
concatFiles(chapterFiles, finalFile);
writeFileSync(path.join(outputDir, "江苏省监测技能竞赛在线答题系统-领导汇报.srt"), srtBlocks.join("\n"), "utf8");
writeFileSync(path.join(outputDir, "build-info.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  chapters: chapterFiles.map((file) => path.basename(file)),
  durationSeconds: Number(globalStart.toFixed(3)),
  video: path.basename(finalFile),
}, null, 2) + "\n", "utf8");

for (const raw of [
  path.join(screensDir, "04-contestant-api-docs-raw.png"),
  path.join(screensDir, "04b-playground-raw.png"),
  path.join(screensDir, "01b-account-management-raw.jpg"),
]) {
  rmSync(raw, { force: true });
}

process.stdout.write(`\n[video] complete: ${finalFile}\n`);
