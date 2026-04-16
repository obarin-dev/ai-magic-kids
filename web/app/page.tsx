"use client";

import { ChangeEvent, useMemo, useState } from "react";

export default function HomePage() {
  const [file, setFile] = useState<File | null>(null);

  const previewUrl = useMemo(() => {
    if (!file) return "";
    return URL.createObjectURL(file);
  }, [file]);

  const onChangeFile = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
  };

  return (
    <main className="page">
      <section className="card">
        <h1 className="title">sketch-animator</h1>
        <p className="subtitle">まずは絵をアップロードしよう</p>

        <div className="uploadBox">
          <label className="uploadLabel" htmlFor="drawing-upload">
            画像をえらぶ
          </label>
          <input
            id="drawing-upload"
            type="file"
            accept="image/png,image/jpeg,image/jpg"
            onChange={onChangeFile}
            style={{ display: "none" }}
          />
          <p className="hint">対応形式: PNG / JPG / JPEG</p>
          {file && <p className="fileName">選択中: {file.name}</p>}
        </div>

        <div className="previewWrap">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="previewImg" src={previewUrl} alt="アップロード画像プレビュー" />
          ) : (
            <p className="empty">ここにプレビューが表示されます</p>
          )}
        </div>
      </section>
    </main>
  );
}
