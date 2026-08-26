"use client";

import Image from "@tiptap/extension-image";
import { Link } from "@tiptap/extension-link";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Code2,
  FileUp,
  Heading2,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  LoaderCircle,
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { inlineImageData, isStoredImagePath, uploadableImageTypes } from "@/lib/competition/images";
import { AttachmentNode, formatAttachmentSize } from "./AttachmentNode";

type MediaKind = "image" | "file";

const RichTextLink = Link.extend({
  parseHTML() {
    return [{
      tag: "a[href]:not(.rich-attachment)",
      getAttrs: (element) => {
        const href = (element as HTMLElement).getAttribute("href") ?? "";
        return /^(https?:|mailto:|\/|#)/i.test(href) ? null : false;
      },
    }];
  },
});

interface StoredMedia {
  id: number;
  url: string;
  kind: MediaKind;
  originalName: string;
  mimeType: string;
  byteSize: number;
}

interface UploadStatus {
  fileName: string;
  fileIndex: number;
  fileCount: number;
  loaded: number;
  total: number;
}

function transferFiles(transfer: DataTransfer | null): File[] {
  return transfer ? Array.from(transfer.files) : [];
}

function fileFromDataUrl(src: string): File | null {
  const inline = inlineImageData(src);
  if (!inline) return null;
  try {
    const binary = window.atob(inline.base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new File([bytes], `pasted-image.${inline.extension}`, { type: inline.mimeType });
  } catch {
    return null;
  }
}

/**
 * 粘贴内容里只要带上外部图片，服务端保存时就会把它清掉，所以先在编辑器里拦下来：
 * 内联的 base64 图片转成上传，其余外链图片直接去掉并提示。返回 null 表示交给编辑器默认处理。
 */
function pastedImageDocument(html: string): Document | null {
  if (!html || !/<img\b/i.test(html)) return null;
  const parsed = new window.DOMParser().parseFromString(html, "text/html");
  const foreign = Array.from(parsed.querySelectorAll("img")).some(
    (image) => !isStoredImagePath(image.getAttribute("src") ?? ""),
  );
  return foreign ? parsed : null;
}

export function RichTextEditor({
  value,
  onChange,
  purpose,
  editable = true,
  minHeight = 280,
}: {
  value: string;
  onChange: (html: string) => void;
  purpose: "question" | "answer";
  editable?: boolean;
  minHeight?: number;
}) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const uploadActiveRef = useRef(false);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ link: false }),
      RichTextLink.configure({ openOnClick: false, autolink: true, protocols: ["http", "https"] }),
      Image.configure({ allowBase64: false, inline: false }),
      AttachmentNode,
    ],
    content: value,
    editable,
    onUpdate: ({ editor: activeEditor }) => onChange(activeEditor.getHTML()),
    editorProps: {
      attributes: {
        class: "rich-editor-content",
        style: `min-height: ${minHeight}px`,
      },
      handlePaste: (_view, event) => {
        const active = editorRef.current;
        if (!active?.isEditable) return false;
        const clipboard = event.clipboardData;
        const files = transferFiles(clipboard);
        if (files.length > 0) {
          event.preventDefault();
          void uploadFiles(files, "auto");
          return true;
        }
        const parsed = pastedImageDocument(clipboard?.getData("text/html") ?? "");
        if (!parsed) return false;
        event.preventDefault();
        void insertPastedContent(parsed);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        const active = editorRef.current;
        if (moved || !active?.isEditable) return false;
        const files = transferFiles(event.dataTransfer);
        if (files.length === 0) return false;
        event.preventDefault();
        const dropped = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (dropped) active.commands.setTextSelection(dropped.pos);
        void uploadFiles(files, "auto");
        return true;
      },
    },
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    // 第二个参数必须是 false：默认会补发一次 update，把编辑器里还没换掉的旧内容
    // 当成用户输入回传给上层，切题时就会把上一题的答案写进新题。
    editor.setEditable(editable, false);
  }, [editable, editor]);

  useEffect(() => {
    if (!editor || editor.getHTML() === value) return;
    editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  if (!editor) return <div className="rich-editor-loading" style={{ minHeight }}>正在打开编辑器</div>;

  function setLink() {
    if (!editor) return;
    const previous = editor.getAttributes("link").href as string | undefined;
    const href = window.prompt("输入链接地址", previous ?? "https://");
    if (href === null) return;
    if (!href.trim()) editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: href.trim() }).run();
  }

  function storeMedia(
    file: File,
    kind: MediaKind,
    fileIndex: number,
    fileCount: number,
  ): Promise<StoredMedia> {
    const form = new FormData();
    form.set("purpose", purpose);
    form.set("kind", kind);
    form.set("file", file);
    setUploadStatus({ fileName: file.name, fileIndex, fileCount, loaded: 0, total: file.size });

    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open("POST", "/api/competition/media");
      request.upload.onprogress = (event) => {
        setUploadStatus({
          fileName: file.name,
          fileIndex,
          fileCount,
          loaded: event.loaded,
          total: event.lengthComputable ? event.total : file.size,
        });
      };
      request.onerror = () => reject(new Error("附件上传失败，请检查网络连接"));
      request.onload = () => {
        let payload: (Partial<StoredMedia> & { error?: string }) | null = null;
        try {
          payload = JSON.parse(request.responseText) as Partial<StoredMedia> & { error?: string };
        } catch {
          // 非 JSON 响应会使用下面的 HTTP 状态提示。
        }
        if (request.status === 401) {
          const next = `${window.location.pathname}${window.location.search}`;
          window.location.replace(`/login?next=${encodeURIComponent(next)}`);
        }
        if (request.status < 200 || request.status >= 300) {
          reject(new Error(payload?.error || `附件上传失败（HTTP ${request.status}）`));
          return;
        }
        if (!payload || typeof payload.id !== "number" || typeof payload.url !== "string") {
          reject(new Error("服务器返回的附件信息无效"));
          return;
        }
        resolve(payload as StoredMedia);
      };
      request.send(form);
    });
  }

  async function uploadFiles(files: File[], insertion: MediaKind | "auto") {
    if (uploadActiveRef.current) {
      setNotice("当前附件仍在上传，请等待完成后再继续");
      return;
    }
    uploadActiveRef.current = true;
    setError(null);
    setNotice(null);
    try {
      for (const [index, file] of files.entries()) {
        const kind = insertion === "auto"
          ? uploadableImageTypes.has(file.type) ? "image" : "file"
          : insertion;
        const stored = await storeMedia(file, kind, index + 1, files.length);
        const active = editorRef.current;
        if (!active) continue;
        if (kind === "image") {
          active.chain().focus().setImage({ src: stored.url, alt: stored.originalName }).run();
        } else {
          active.chain().focus().insertContent({
            type: "attachment",
            attrs: {
              mediaId: String(stored.id),
              name: stored.originalName,
              byteSize: String(stored.byteSize),
              mimeType: stored.mimeType,
            },
          }).run();
        }
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "附件上传失败");
    } finally {
      uploadActiveRef.current = false;
      setUploadStatus(null);
      if (imageInputRef.current) imageInputRef.current.value = "";
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function insertPastedContent(parsed: Document) {
    if (uploadActiveRef.current) {
      setNotice("当前附件仍在上传，请等待完成后再粘贴");
      return;
    }
    uploadActiveRef.current = true;
    setError(null);
    setNotice(null);
    let removed = 0;
    try {
      const images = Array.from(parsed.querySelectorAll("img"));
      for (const [index, image] of images.entries()) {
        const src = image.getAttribute("src") ?? "";
        if (isStoredImagePath(src)) continue;
        const inlined = fileFromDataUrl(src);
        if (!inlined) {
          image.remove();
          removed += 1;
          continue;
        }
        const stored = await storeMedia(inlined, "image", index + 1, images.length);
        image.setAttribute("src", stored.url);
      }
      editorRef.current?.chain().focus().insertContent(parsed.body.innerHTML).run();
      if (removed > 0) {
        setNotice(`粘贴的 ${removed} 张外部图片无法保存，已忽略，请用工具栏的“插入图片”按钮上传`);
      }
    } catch (pasteError) {
      setError(pasteError instanceof Error ? pasteError.message : "图片上传失败");
    } finally {
      uploadActiveRef.current = false;
      setUploadStatus(null);
    }
  }

  const uploading = uploadStatus !== null;
  const uploadPercent = uploadStatus && uploadStatus.total > 0
    ? Math.min(100, Math.round((uploadStatus.loaded / uploadStatus.total) * 100))
    : null;

  return (
    <div className={`rich-editor ${editable ? "editable" : "readonly"}`}>
      {editable && (
        <div className="rich-toolbar" aria-label="富文本工具栏">
          <EditorButton label="撤销" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}><Undo2 /></EditorButton>
          <EditorButton label="重做" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}><Redo2 /></EditorButton>
          <span className="toolbar-divider" />
          <EditorButton label="二级标题" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })}><Heading2 /></EditorButton>
          <EditorButton label="粗体" onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")}><Bold /></EditorButton>
          <EditorButton label="斜体" onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")}><Italic /></EditorButton>
          <EditorButton label="删除线" onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive("strike")}><Strikethrough /></EditorButton>
          <span className="toolbar-divider" />
          <EditorButton label="无序列表" onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")}><List /></EditorButton>
          <EditorButton label="有序列表" onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")}><ListOrdered /></EditorButton>
          <EditorButton label="引用" onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")}><Quote /></EditorButton>
          <EditorButton label="代码块" onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive("codeBlock")}><Code2 /></EditorButton>
          <EditorButton label="链接" onClick={setLink} active={editor.isActive("link")}><Link2 /></EditorButton>
          <EditorButton label={uploading ? "正在上传" : "插入图片"} onClick={() => imageInputRef.current?.click()} disabled={uploading}><ImagePlus /></EditorButton>
          <EditorButton label={uploading ? "正在上传" : "插入附件"} onClick={() => fileInputRef.current?.click()} disabled={uploading}><FileUp /></EditorButton>
          <input
            ref={imageInputRef}
            className="visually-hidden"
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            multiple
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              if (files.length > 0) void uploadFiles(files, "image");
            }}
          />
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            multiple
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              if (files.length > 0) void uploadFiles(files, "file");
            }}
          />
        </div>
      )}
      {uploadStatus && (
        <div className="editor-upload-status" role="status">
          <LoaderCircle className="spinning" />
          <div>
            <strong>正在上传 {uploadStatus.fileIndex}/{uploadStatus.fileCount}：{uploadStatus.fileName}</strong>
            <progress value={uploadStatus.loaded} max={Math.max(uploadStatus.total, 1)} />
          </div>
          <span>{uploadPercent === null ? formatAttachmentSize(uploadStatus.loaded) : `${uploadPercent}%`}</span>
        </div>
      )}
      {error && <div className="editor-error" role="alert">{error}</div>}
      {!error && notice && <div className="editor-notice" role="status">{notice}</div>}
      <EditorContent editor={editor} />
    </div>
  );
}

function EditorButton({
  label,
  onClick,
  children,
  active = false,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-pressed={active}
      className={`toolbar-button ${active ? "active" : ""}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}
