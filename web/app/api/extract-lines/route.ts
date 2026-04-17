import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";

export const runtime = "nodejs";
export const maxDuration = 120;

const execFileAsync = promisify(execFile);
const ROOT_DIR = path.resolve(process.cwd(), "..");
const SCRIPT_PATH = path.join(ROOT_DIR, "extract_lines.py");
const VENV_PYTHON = path.join(ROOT_DIR, ".venv", "bin", "python");

export async function POST(req: NextRequest) {
  let tempDir: string | null = null;
  try {
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json({ error: "フォームデータを読めませんでした" }, { status: 400 });
    }

    const file = formData.get("image");
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: "画像ファイル (image) がありません" }, { status: 400 });
    }

    const mimeType = file.type || "image/jpeg";
    if (!mimeType.startsWith("image/")) {
      return NextResponse.json({ error: "画像以外のファイルです" }, { status: 400 });
    }

    try {
      await fs.access(SCRIPT_PATH);
    } catch {
      return NextResponse.json(
        {
          error: `extract_lines.py が見つかりません (${SCRIPT_PATH})。Next.js は web フォルダで起動してください (npm run dev)。`,
        },
        { status: 500 }
      );
    }

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sketch-lines-"));
    const ext = mimeType.includes("png") ? ".png" : ".jpg";
    const inputPath = path.join(tempDir, `input-${randomUUID()}${ext}`);
    const outputPath = path.join(tempDir, `output-${randomUUID()}.png`);

    const arrayBuffer = await file.arrayBuffer();
    await fs.writeFile(inputPath, Buffer.from(arrayBuffer));

    const pythonPath = await fs
      .access(VENV_PYTHON)
      .then(() => VENV_PYTHON)
      .catch(() => "python3");

    await execFileAsync(pythonPath, [SCRIPT_PATH, inputPath, outputPath], {
      cwd: ROOT_DIR,
      timeout: 60000,
    });

    const output = await fs.readFile(outputPath);
    return NextResponse.json({
      imageDataUrl: `data:image/png;base64,${output.toString("base64")}`,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `線抽出に失敗しました: ${message}` }, { status: 502 });
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
