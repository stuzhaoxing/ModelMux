"use client";

import Image from "@tiptap/extension-image";
import { Link } from "@tiptap/extension-link";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Code2,
  Heading2,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { inlineImageData, isStoredImagePath, uploadableImageTypes } from "@/lib/competition/images";
import { apiRequest } from "./api";

function imageFilesOf(transfer: DataTransfer | null): File[] {
  if (!transfer) return [];
  return Array.from(transfer.files).filter((file) => uploadableImageTypes.has(file.type));
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
  const inputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ link: false }),
      Link.configure({ openOnClick: false, autolink: true, protocols: ["http", "https"] }),
      Image.configure({ allowBase64: false, inline: false }),
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
        const files = imageFilesOf(clipboard);
        if (files.length > 0) {
          event.preventDefault();
          void uploadImages(files);
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
        const files = imageFilesOf(event.dataTransfer);
        if (files.length === 0) return false;
        event.preventDefault();
        const dropped = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (dropped) active.commands.setTextSelection(dropped.pos);
        void uploadImages(files);
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

  async function storeImage(file: File): Promise<string> {
    const form = new FormData();
    form.set("purpose", purpose);
    form.set("file", file);
    const result = await apiRequest<{ url: string }>("/api/competition/media", { method: "POST", body: form });
    return result.url;
  }

  async function uploadImages(files: File[]) {
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      for (const file of files) {
        const url = await storeImage(file);
        editorRef.current?.chain().focus().setImage({ src: url, alt: file.name }).run();
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "图片上传失败");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function insertPastedContent(parsed: Document) {
    setUploading(true);
    setError(null);
    setNotice(null);
    let removed = 0;
    try {
      for (const image of Array.from(parsed.querySelectorAll("img"))) {
        const src = image.getAttribute("src") ?? "";
        if (isStoredImagePath(src)) continue;
        const inlined = fileFromDataUrl(src);
        if (!inlined) {
          image.remove();
          removed += 1;
          continue;
        }
        image.setAttribute("src", await storeImage(inlined));
      }
      editorRef.current?.chain().focus().insertContent(parsed.body.innerHTML).run();
      if (removed > 0) {
        setNotice(`粘贴的 ${removed} 张外部图片无法保存，已忽略，请用工具栏的“插入图片”按钮上传`);
      }
    } catch (pasteError) {
      setError(pasteError instanceof Error ? pasteError.message : "图片上传失败");
    } finally {
      setUploading(false);
    }
  }

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
          <EditorButton label={uploading ? "正在上传图片" : "插入图片"} onClick={() => inputRef.current?.click()} disabled={uploading}><ImagePlus /></EditorButton>
          <input
            ref={inputRef}
            className="visually-hidden"
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadImages([file]);
            }}
          />
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
