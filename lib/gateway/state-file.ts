import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type StateFileRead =
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "ok"; value: Record<string, unknown> };

export function dataDirectory(): string {
  const configured = process.env.MODELMUX_DATA_DIR?.trim();
  return configured
    ? path.resolve(/* turbopackIgnore: true */ configured)
    : path.join(process.cwd(), ".modelmux-data");
}

export async function readStateFile(fileName: string): Promise<StateFileRead> {
  try {
    const parsed = JSON.parse(
      await readFile(path.join(dataDirectory(), fileName), "utf8"),
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { status: "invalid" };
    }
    return { status: "ok", value: parsed as Record<string, unknown> };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "missing" };
    }
    return { status: "invalid" };
  }
}

export async function writeStateFile(
  fileName: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const directory = dataDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(
    directory,
    `.${path.basename(fileName, ".json")}-${randomUUID()}.tmp`,
  );
  await writeFile(temporary, `${JSON.stringify(payload)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  await rename(temporary, path.join(directory, fileName));
}
