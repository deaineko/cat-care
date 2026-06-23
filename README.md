# 🐈 猫の世話

猫のお世話を、その場でワンタップ記録する個人用 PWA。
Plaud 自動記録の補完として、即時記録 → すぐ見返す、を 1 画面で完結させる。

## 特徴

- 部屋ごと（リビング / 書斎 / 2階）に 窓・ストーブのトグルと ごはん・トイレ掃除ボタン
- 薬・自由メモは「全体」。注意メモは赤マーカーで強調
- 履歴は部屋ごとに表示。過去日は閲覧専用
- 端末内 IndexedDB に保存（オフライン動作）。JSON で書き出し / 復元
- ライト / ダーク自動追従

## 開発

```sh
npm install
npm run dev      # 開発サーバー
npm test         # 純関数のユニットテスト
npm run build    # 本番ビルド（dist/）
npm run preview  # ビルド結果をローカル確認
```

## 公開

`main` に push すると GitHub Actions が自動でビルドし、GitHub Pages に公開する。

## 技術

Vite + TypeScript / IndexedDB（idb）/ vite-plugin-pwa / Vitest
