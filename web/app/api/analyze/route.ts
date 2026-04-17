import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

// 1.5 は 404、2.0-flash は無料枠で quota limit:0 になることがある → AI Studio の枠に合わせて 2.5-flash を既定にする
const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const RETRY_COUNT = 3;

const SYSTEM_PROMPT = `あなたは子どもの手描きイラストを見て、キャラクターの骨格として使える主要関節の位置を推定します。

座標は画像の左上を (0,0)、右下を (1,1) とする正規化座標で返してください。
x は横方向（左から右）、y は縦方向（上から下）です。

次のキーだけを使い、推定できない場合は null を入れてください:
head, shoulder, elbow_l, hand_l, elbow_r, hand_r, hip, knee_l, foot_l, knee_r, foot_r

出力は **JSON だけ**。説明文やマークダウンは付けないでください。

形式:
{"joints":{"head":[0.5,0.12],"shoulder":[0.5,0.28],...},"subject_bbox":{"x":0.2,"y":0.1,"w":0.6,"h":0.8},"subject_polygon":[[0.18,0.08],[0.74,0.1],[0.78,0.92],[0.2,0.9]]}

subject_bbox は「主役キャラクター全体」を囲う正規化矩形です。
- x,y は左上
- w,h は幅と高さ
- 0〜1 の範囲に収める
- 推定が難しい場合は null

subject_polygon は主役キャラクターの輪郭に沿った正規化座標の頂点列です。
- 6〜20 点程度
- 各点は [x,y]
- bbox よりも優先して「キャラクター本体のみ」を囲む
- 推定が難しい場合は null
`;

function extractJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("JSON が見つかりません");
  }
  const parsed = JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
  return parsed;
}

function is503Error(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes("[503 Service Unavailable]");
}

function is429Error(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes("[429") || msg.includes("429 Too Many Requests");
}

/** SDK が返す英語メッセージを、画面上で読める説明にまとめる */
function friendlyAnalyzeErrorMessage(raw: string): string {
  if (raw.includes("[429") || raw.includes("429 Too Many Requests")) {
    return [
      "Gemini API の利用上限に達しています（無料枠ではモデルごとに 1 日の回数などに制限があります）。",
      "翌日以降に再度「骨格を読む」を試すか、課金・プランの確認（Google AI Studio）をお願いします。",
      "別モデルを試す場合は web/.env.local に GEMINI_MODEL を設定できます（制限はモデルで異なります）。",
      "詳細: https://ai.google.dev/gemini-api/docs/rate-limits",
    ].join(" ");
  }
  return raw;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

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
  const buffer = Buffer.from(arrayBuffer);
  const base64 = buffer.toString("base64");

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: MODEL });
    let result:
      | Awaited<ReturnType<typeof model.generateContent>>
      | null = null;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < RETRY_COUNT; attempt += 1) {
      try {
        result = await model.generateContent([
          { text: SYSTEM_PROMPT },
          {
            inlineData: {
              mimeType,
              data: base64,
            },
          },
        ]);
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        if (!is503Error(e) || attempt === RETRY_COUNT - 1) break;
        await sleep(800 * 2 ** attempt);
      }
    }
    if (!result) {
      if (is503Error(lastError)) {
        return NextResponse.json(
          {
            error:
              "いま混み合っています。少し待ってから再度お試しください（自動リトライ後も503でした）。",
          },
          { status: 503 }
        );
      }
      if (is429Error(lastError)) {
        const raw = lastError instanceof Error ? lastError.message : String(lastError);
        return NextResponse.json(
          { error: friendlyAnalyzeErrorMessage(raw) },
          { status: 429 }
        );
      }
      throw lastError ?? new Error("モデル呼び出しに失敗しました");
    }

    const response = result.response;
    const text = response.text();
    if (!text) {
      return NextResponse.json(
        { error: "モデルからテキストが返りませんでした" },
        { status: 502 }
      );
    }

    const parsed = extractJsonObject(text);
    return NextResponse.json({ rawText: text, data: parsed });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (is429Error(e)) {
      return NextResponse.json(
        { error: friendlyAnalyzeErrorMessage(message) },
        { status: 429 }
      );
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
