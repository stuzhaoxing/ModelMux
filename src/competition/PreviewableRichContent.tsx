"use client";

import { Download, Maximize2, X, ZoomIn, ZoomOut } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";

import { renderRichTextHtml } from "@/lib/competition/content";

interface PreviewImage {
  src: string;
  alt: string;
}

interface Point {
  x: number;
  y: number;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  origin: Point;
  moved: boolean;
}

const minimumZoom = 0.25;
const maximumZoom = 6;
const zoomStep = 1.25;

function imageFromTarget(target: EventTarget | null): HTMLImageElement | null {
  return target instanceof HTMLImageElement ? target : null;
}

function bounded(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function PreviewableRichContent({
  html,
  className = "",
}: {
  html: string;
  className?: string;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const previewImageRef = useRef<HTMLImageElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressBackdropCloseRef = useRef(false);
  const fitScaleRef = useRef(1);
  const zoomRef = useRef(1);
  const imageSizeRef = useRef({ width: 0, height: 0 });
  const [preview, setPreview] = useState<PreviewImage | null>(null);
  const [fitScale, setFitScale] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState<Point>({ x: 0, y: 0 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [imageReady, setImageReady] = useState(false);
  const [dragging, setDragging] = useState(false);
  const renderedHtml = useMemo(() => renderRichTextHtml(html), [html]);

  const closePreview = useCallback(() => setPreview(null), []);

  const constrainPosition = useCallback((next: Point, zoomLevel = zoomRef.current): Point => {
    const stage = stageRef.current?.getBoundingClientRect();
    const imageSize = imageSizeRef.current;
    if (!stage || imageSize.width <= 0 || imageSize.height <= 0) return { x: 0, y: 0 };

    const renderedWidth = imageSize.width * fitScaleRef.current * zoomLevel;
    const renderedHeight = imageSize.height * fitScaleRef.current * zoomLevel;
    const maximumX = Math.max(0, (renderedWidth - stage.width) / 2 + 32);
    const maximumY = Math.max(0, (renderedHeight - stage.height) / 2 + 32);
    return {
      x: bounded(next.x, -maximumX, maximumX),
      y: bounded(next.y, -maximumY, maximumY),
    };
  }, []);

  const setViewerZoom = useCallback((nextZoom: number) => {
    const constrainedZoom = bounded(nextZoom, minimumZoom, maximumZoom);
    zoomRef.current = constrainedZoom;
    setZoom(constrainedZoom);
    setPosition((current) => constrainPosition(current, constrainedZoom));
  }, [constrainPosition]);

  const fitToScreen = useCallback(() => {
    zoomRef.current = 1;
    setZoom(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  const calculateFitScale = useCallback(() => {
    const stage = stageRef.current?.getBoundingClientRect();
    const image = previewImageRef.current;
    if (!stage || !image?.naturalWidth || !image.naturalHeight) return;

    const nextImageSize = { width: image.naturalWidth, height: image.naturalHeight };
    imageSizeRef.current = nextImageSize;
    setImageSize(nextImageSize);
    const availableWidth = Math.max(1, stage.width - 32);
    const availableHeight = Math.max(1, stage.height - 120);
    const nextFitScale = Math.min(
      availableWidth / image.naturalWidth,
      availableHeight / image.naturalHeight,
    );
    fitScaleRef.current = nextFitScale;
    setFitScale(nextFitScale);
    fitToScreen();
    setImageReady(true);
  }, [fitToScreen]);

  const openPreview = useCallback((image: HTMLImageElement) => {
    const src = image.currentSrc || image.src;
    if (!src) return;
    triggerRef.current = image;
    fitScaleRef.current = 1;
    zoomRef.current = 1;
    imageSizeRef.current = { width: 0, height: 0 };
    setImageSize({ width: 0, height: 0 });
    setFitScale(1);
    setZoom(1);
    setPosition({ x: 0, y: 0 });
    setImageReady(false);
    setPreview({ src, alt: image.alt.trim() || "题目图片" });
  }, []);

  useEffect(() => {
    const images = contentRef.current?.querySelectorAll("img") ?? [];
    for (const image of images) {
      image.tabIndex = 0;
      image.setAttribute("role", "button");
      image.setAttribute("aria-label", `全屏预览${image.alt.trim() ? `：${image.alt.trim()}` : "题目图片"}`);
      if (!image.title) image.title = "全屏预览图片";
    }
  }, [renderedHtml]);

  useEffect(() => {
    if (!preview) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closePreview();
      else if (event.key === "+" || event.key === "=") setViewerZoom(zoomRef.current * zoomStep);
      else if (event.key === "-") setViewerZoom(zoomRef.current / zoomStep);
      else if (event.key === "0") fitToScreen();
    };
    window.addEventListener("keydown", handleKey);
    window.addEventListener("resize", calculateFitScale);

    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("resize", calculateFitScale);
      document.body.style.overflow = previousOverflow;
      triggerRef.current?.focus();
    };
  }, [calculateFitScale, closePreview, fitToScreen, preview, setViewerZoom]);

  function handleContentClick(event: MouseEvent<HTMLDivElement>) {
    const image = imageFromTarget(event.target);
    if (image) openPreview(image);
  }

  function handleContentKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    const image = imageFromTarget(event.target);
    if (!image) return;
    event.preventDefault();
    openPreview(image);
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const controls = Array.from(toolbarRef.current?.querySelectorAll<HTMLElement>("button, a[href]") ?? []);
    const first = controls.at(0);
    const last = controls.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: position,
      moved: false,
    };
    setDragging(true);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) drag.moved = true;
    setPosition(constrainPosition({
      x: drag.origin.x + deltaX,
      y: drag.origin.y + deltaY,
    }));
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    suppressBackdropCloseRef.current = drag.moved;
    dragRef.current = null;
    setDragging(false);
  }

  const renderedScale = fitScale * zoom;
  const renderedOffset = {
    x: position.x - (imageSize.width * renderedScale) / 2,
    y: position.y - (imageSize.height * renderedScale) / 2,
  };

  return (
    <>
      <div
        ref={contentRef}
        className={`rich-content previewable-rich-content ${className}`.trim()}
        onClick={handleContentClick}
        onKeyDown={handleContentKeyDown}
        dangerouslySetInnerHTML={{ __html: renderedHtml }}
      />
      {preview && (
        <div
          className="image-preview-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="图片全屏预览"
          onKeyDown={handleDialogKeyDown}
        >
          <div ref={toolbarRef} className="image-preview-toolbar" role="toolbar" aria-label="图片预览工具">
            <button
              type="button"
              title="缩小"
              aria-label="缩小图片"
              disabled={zoom <= minimumZoom}
              onClick={() => setViewerZoom(zoomRef.current / zoomStep)}
            >
              <ZoomOut />
            </button>
            <output aria-label="当前缩放比例">{Math.round(zoom * 100)}%</output>
            <button
              type="button"
              title="放大"
              aria-label="放大图片"
              disabled={zoom >= maximumZoom}
              onClick={() => setViewerZoom(zoomRef.current * zoomStep)}
            >
              <ZoomIn />
            </button>
            <button type="button" title="适合屏幕" aria-label="图片适合屏幕" onClick={fitToScreen}>
              <Maximize2 />
            </button>
            <a href={preview.src} download={preview.alt} title="下载原图" aria-label="下载原图">
              <Download />
            </a>
            <button
              ref={closeButtonRef}
              type="button"
              title="关闭预览"
              aria-label="关闭图片预览"
              onClick={closePreview}
            >
              <X />
            </button>
          </div>
          <div
            ref={stageRef}
            className={`image-preview-stage${dragging ? " dragging" : ""}`}
            onClick={(event) => {
              if (event.target === event.currentTarget && !suppressBackdropCloseRef.current) closePreview();
              suppressBackdropCloseRef.current = false;
            }}
            onWheel={(event: WheelEvent<HTMLDivElement>) => {
              event.preventDefault();
              setViewerZoom(zoomRef.current * (event.deltaY < 0 ? 1.12 : 1 / 1.12));
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
          >
            {/* The protected media route needs the contestant's browser session cookie. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={previewImageRef}
              src={preview.src}
              alt={preview.alt}
              draggable={false}
              onLoad={calculateFitScale}
              style={{
                visibility: imageReady ? "visible" : "hidden",
                transform: `translate3d(${renderedOffset.x}px, ${renderedOffset.y}px, 0) scale(${renderedScale})`,
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
