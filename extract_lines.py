import sys

import cv2
import numpy as np


def _remove_small_border_blobs(mask: np.ndarray, max_area_frac: float = 0.035) -> np.ndarray:
    """
    画像端に触れている「小さなインク塊」を除去（机・影のチリが縁に付くケース向け）。
    大きな連結成分（本体の絵）は端に触れていても残す。
    """
    h, w = mask.shape[:2]
    nlab, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    max_area = max(200, int(h * w * max_area_frac))
    out = mask.copy()
    for i in range(1, nlab):
        area = int(stats[i, cv2.CC_STAT_AREA])
        if area > max_area:
            continue
        ys, xs = np.where(labels == i)
        if len(xs) == 0:
            continue
        if (
            np.any(ys == 0)
            or np.any(ys == h - 1)
            or np.any(xs == 0)
            or np.any(xs == w - 1)
        ):
            out[labels == i] = 0
    return out


def _fill_paper_holes(mask: np.ndarray) -> np.ndarray:
    """
    マスクの「紙」側（インク以外）で、枠に届いていない穴＝線の内側の白抜けをインクで埋める。
    二値化で文字の中が抜ける場合の補助。四隅から紙を flood して外周に繋がらない 255 だけ残す。
    """
    h, w = mask.shape[:2]
    inv = cv2.bitwise_not(mask)
    ff = inv.copy()
    flood = np.zeros((h + 2, w + 2), np.uint8)
    for sx, sy in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        if 0 <= sx < w and 0 <= sy < h and int(ff[sy, sx]) == 255:
            cv2.floodFill(ff, flood, (sx, sy), 0)
    holes = ff == 255
    filled = mask.copy()
    filled[holes] = 255
    return filled


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit("usage: python extract_lines.py <input_image> <output_image>")

    image_path = sys.argv[1]
    output_path = sys.argv[2]
    img = cv2.imread(image_path)
    if img is None:
        raise FileNotFoundError(f"{image_path} が見つかりません")

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    h, w = gray.shape[:2]

    # 線候補（暗い＝インク）
    _, binary = cv2.threshold(blur, 180, 255, cv2.THRESH_BINARY_INV)
    kernel = np.ones((2, 2), np.uint8)
    clean = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel, iterations=1)
    clean = cv2.dilate(clean, kernel, iterations=1)

    # 明るい領域＝紙とみなし、大きく膨らませて「紙の上のインク」だけ残す（机・周囲の黒を除外）
    _, paper_core = cv2.threshold(blur, 188, 255, cv2.THRESH_BINARY)
    ks = max(11, min(h, w) // 20) | 1
    kernel_big = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ks, ks))
    paper = cv2.dilate(paper_core, kernel_big, iterations=2)
    ink_masked = cv2.bitwise_and(clean, paper)
    if cv2.countNonZero(ink_masked) >= max(1, int(cv2.countNonZero(clean) * 0.2)):
        clean = ink_masked

    # 小さなゴミ（写真ノイズ・孤立点）を除去
    nlab, labels, stats, _ = cv2.connectedComponentsWithStats(clean, connectivity=8)
    min_area = max(64, (h * w) // 30000)
    filtered = np.zeros_like(clean)
    for i in range(1, nlab):
        if stats[i, cv2.CC_STAT_AREA] >= min_area:
            filtered[labels == i] = 255
    clean = filtered

    clean = _remove_small_border_blobs(clean)

    # 線の内側が抜けている場合に限り埋める（面積が急増しすぎたら捨てる）
    filled_try = _fill_paper_holes(clean)
    if cv2.countNonZero(filled_try) <= int(cv2.countNonZero(clean) * 1.35):
        clean = filled_try

    # ごく薄い縁のノイズを 1px 削ってから戻す（ハロ軽減。本体が細すぎるときは維持）
    er = cv2.erode(clean, np.ones((2, 2), np.uint8), iterations=1)
    if cv2.countNonZero(er) >= int(cv2.countNonZero(clean) * 0.88):
        clean = er

    # インクの外接矩形でトリミング（切り抜きキャンバスを絵に寄せる）
    ys, xs = np.where(clean > 0)
    if len(xs) > 0:
        y0, y1 = int(ys.min()), int(ys.max())
        x0, x1 = int(xs.min()), int(xs.max())
        span = max(y1 - y0 + 1, x1 - x0 + 1)
        pad = int(max(12, span * 0.04))
        y0 = max(0, y0 - pad)
        y1 = min(h - 1, y1 + pad)
        x0 = max(0, x0 - pad)
        x1 = min(w - 1, x1 + pad)
        img = img[y0 : y1 + 1, x0 : x1 + 1]
        clean = clean[y0 : y1 + 1, x0 : x1 + 1]

    # 切り抜き: アルファは 0/255 のみ。透明部の RGB は 0（PNG の乗算汚れ防止）
    alpha = (clean > 0).astype(np.uint8) * 255
    foreground = cv2.bitwise_and(img, img, mask=clean)
    b, g, r = cv2.split(foreground)
    b = np.where(alpha > 0, b, 0).astype(np.uint8)
    g = np.where(alpha > 0, g, 0).astype(np.uint8)
    r = np.where(alpha > 0, r, 0).astype(np.uint8)
    rgba = cv2.merge([b, g, r, alpha])
    cv2.imwrite(output_path, rgba)
    print(f"saved: {output_path}")


if __name__ == "__main__":
    main()
