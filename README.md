# 接單看板 (Dispatch Board)

一個 10 人頭計時看板：可疊加 10 分鐘冷卻單位、顯示最快恢復 / 緊急提醒、
今日人頭次與時數統計（含 CSV 匯出）、顧客等待名單（可指定人頭）、
上線 / 未上線切換與誤關復原。

資料儲存在瀏覽器的 `localStorage`，只會留在使用這個瀏覽器/裝置上，
換裝置或清除瀏覽器資料會遺失，沒有後端資料庫。

## 本機開發

需要先安裝 [Node.js](https://nodejs.org/)（建議 18 以上版本）。

```bash
npm install
npm run dev
```

啟動後終端機會顯示一個網址（通常是 `http://localhost:5173`），
用瀏覽器打開就能看到畫面。

## 部署到 Vercel

### 方法一：透過 Vercel 網站（不需要指令）

1. 到 [vercel.com](https://vercel.com) 註冊/登入帳號
2. 把這個資料夾上傳到你的 GitHub（可以直接把整個資料夾拖進
   [github.com/new](https://github.com/new) 建立的新 repo 頁面，
   或用 GitHub Desktop 這類工具）
3. 在 Vercel 點「Add New → Project」，選擇剛剛的 GitHub repo
4. Vercel 會自動偵測到這是 Vite 專案，框架設定選 **Vite** 即可，
   其他設定不用改，直接按「Deploy」
5. 幾十秒後就會拿到一個 `.vercel.app` 網址，之後每次更新 GitHub 上的程式碼，
   Vercel 都會自動重新部署

### 方法二：用 Vercel CLI（需要會用終端機）

```bash
npm install -g vercel
vercel
```

依照畫面指示操作（第一次會需要登入），完成後就會得到一個網址。
之後要正式上線可以打：

```bash
vercel --prod
```

## 專案結構

```
├── index.html          進入點 HTML
├── src/
│   ├── main.jsx         React 進入點
│   ├── DispatchBoard.jsx  主要元件（畫面與邏輯都在這裡）
│   └── index.css        Tailwind CSS 設定
├── package.json
├── vite.config.js
├── tailwind.config.js
└── postcss.config.js
```

如果想調整顏色、文字或功能，直接編輯 `src/DispatchBoard.jsx` 即可，
顏色統一定義在檔案最上方的 `C` 這個物件裡。
