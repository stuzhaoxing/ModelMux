import { describe, expect, it } from "vitest";

import { inlineImageData, isStoredImagePath, uploadableImageTypes } from "./images";

describe("competition images", () => {
  it("only recognises uploaded media paths", () => {
    expect(isStoredImagePath("/api/competition/media/12")).toBe(true);
    expect(isStoredImagePath("/api/competition/media/12?x=1")).toBe(false);
    expect(isStoredImagePath("https://outside.example/x.png")).toBe(false);
    expect(isStoredImagePath("file:///C:/clip_image001.png")).toBe(false);
    expect(isStoredImagePath("")).toBe(false);
  });

  it("decodes inline images the server can store", () => {
    expect(inlineImageData("data:image/png;base64,iVBORw0KGgo=")).toEqual({
      mimeType: "image/png",
      extension: "png",
      base64: "iVBORw0KGgo=",
    });
    expect(inlineImageData("data:image/PNG;base64,iVBO Rw0K\nGgo=")?.base64).toBe("iVBORw0KGgo=");
  });

  it("rejects inline data it cannot upload", () => {
    expect(inlineImageData("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")).toBeNull();
    expect(inlineImageData("data:image/png;base64,")).toBeNull();
    expect(inlineImageData("data:text/html;base64,PGI+")).toBeNull();
    expect(inlineImageData("https://outside.example/x.png")).toBeNull();
  });

  it("keeps the upload list aligned with the file picker", () => {
    expect([...uploadableImageTypes.keys()]).toEqual(["image/jpeg", "image/png", "image/gif", "image/webp"]);
  });
});
