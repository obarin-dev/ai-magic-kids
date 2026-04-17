import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const MODEL = process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.0-flash-preview-image-generation";

const PROMPT = `入力画像の手描きキャラクターを、子ども向けのかわいい2Dイラストに変換してください。
- 元のシルエットや特徴は維持
- 背景はシンプル（可能なら無地）にする
- 本体が中央に入り、全身が見える
- 出力は画像を必ず含める
- 説明文は短くする`;

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY が設定されていません (.env.local)" },
      { status: 500 }
    );
  }

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

  const arrayBuffer = await file.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: MODEL });
    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            { text: PROMPT },
            { inlineData: { mimeType, data: base64 } },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
      } as never,
    } as never);

    const response = result.response as unknown as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            inlineData?: { mimeType?: string; data?: string };
            text?: string;
          }>;
        };
      }>;
      text?: () => string;
    };

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p) => p.inlineData?.data);
    const imageData = imagePart?.inlineData?.data;
    const outMime = imagePart?.inlineData?.mimeType ?? "image/png";

    if (!imageData) {
      const txt = typeof response.text === "function" ? response.text() : "";
      return NextResponse.json(
        {
          error:
            "画像が生成されませんでした。GEMINI_IMAGE_MODEL を画像生成対応モデルに変更してください。",
          rawText: txt,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      imageDataUrl: `data:${outMime};base64,${imageData}`,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
