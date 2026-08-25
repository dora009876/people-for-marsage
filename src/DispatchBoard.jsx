/**
 * 林老闆計時器・長者版（React / JSX 版本）
 * ------------------------------------------------------------
 * 這個檔案是從一開始的 HTML/vanilla JS 互動原型，改寫成單一 React
 * 元件，方便工程師直接整合進現有專案（例如 people-for-marsage
 * 專案）。畫面、文字、計價邏輯都跟原型完全一致，只是把「拼接 HTML
 * 字串」的寫法換成正常的 JSX + React state。
 *
 * 使用方式：
 *   import LaoBanTimer from "./LaoBanTimer.jsx";
 *   export default function Page(){ return <LaoBanTimer />; }
 *
 * 相依套件：只需要 React 18+（用到 useState / useEffect / useRef）。
 * 沒有用到任何第三方 UI 套件，樣式用純 CSS（透過元件內的 <style>
 * 標籤注入，方便直接複製使用；正式整合時可以改放進獨立的 .css 檔）。
 *
 * 字體：畫面預設用系統字體（PingFang TC / Microsoft JhengHei）也會
 * 很好看；如果想要跟原型一模一樣的 Noto Sans TC / Archivo 字體，
 * 請在整個網站的 <head>（例如 Next.js 的 _document.js）加入：
 *   <link rel="preconnect" href="https://fonts.googleapis.com" />
 *   <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
 *   <link
 *     href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&family=Archivo:wght@600;700;800&display=swap"
 *     rel="stylesheet"
 *   />
 *
 * 跟原型（Claude Artifact 版）比起來，這裡做了幾個「正式上線」需要的調整：
 *   1. 存檔改成標準瀏覽器下載（Blob + <a download>），不再依賴
 *      Artifact 環境專屬的 window.claude.use("downloads") API。
 *   2. 讀取 localStorage 的動作搬進 useEffect（只在瀏覽器端執行一次），
 *      避免在 Next.js 這類會做伺服器端渲染（SSR）的框架裡出錯。
 *   3. 原本套用在整個 <body> 的樣式，改成只套用在這個元件自己的外層
 *      容器（.lbt-root），不會影響到專案裡其他頁面的樣式。
 *   4. #stage / #clock-bar / #app 這幾個原本用 id 的地方，改成
 *      className，這樣同一頁如果不小心放兩個這個元件也不會撞名。
 */

import { useEffect, useRef, useState } from "react";

// ============================================================
// 資料設定：師傅顏色代號、頭像、計價規則
// ============================================================

const COLORS = [
  { key: "red", hex: "#e0564a", staffName: "陳美惠", avatar: "fox" },
  { key: "orange", hex: "#e08a3f", staffName: "林淑芬", avatar: "cat" },
  { key: "yellow", hex: "#d9b93f", staffName: "黃阿珠", avatar: "chick" },
  { key: "green", hex: "#4f9e6e", staffName: "王秀琴", avatar: "bird" },
  { key: "blue", hex: "#4c8fc7", staffName: "李阿英", avatar: "rabbit" },
  { key: "purple", hex: "#9067b8", staffName: "張麗華", avatar: "koala" },
  { key: "pink", hex: "#d97ba0", staffName: "吳玉梅", avatar: "hamster" },
  { key: "black", hex: "#5c6570", staffName: "蔡阿雪", avatar: "panda" },
  { key: "white", hex: "#cfcabd", staffName: null, avatar: null },
  { key: "brown", hex: "#8a6142", staffName: null, avatar: null },
];

// 每個頭像都是純手刻的簡單向量小動物（flat 風格），用字串存起來，
// 用 dangerouslySetInnerHTML 塞進去。這幾個 SVG 是我們自己寫的固定
// 內容、不含任何使用者輸入，所以是安全的。
const AVATAR_SVG = {
  fox:
    '<svg viewBox="0 0 64 64" aria-hidden="true">' +
    '<polygon points="14,20 24,6 30,24" fill="#e8935a"/>' +
    '<polygon points="50,20 40,6 34,24" fill="#e8935a"/>' +
    '<polygon points="18,17 24,11 26,22" fill="#fff6ee"/>' +
    '<polygon points="46,17 40,11 38,22" fill="#fff6ee"/>' +
    '<ellipse cx="32" cy="36" rx="20" ry="18" fill="#ef9c62"/>' +
    '<path d="M20 39 Q32 51 44 39 Q44 29 32 29 Q20 29 20 39 Z" fill="#fff6ee"/>' +
    '<circle cx="25" cy="33" r="3" fill="#2b2320"/>' +
    '<circle cx="39" cy="33" r="3" fill="#2b2320"/>' +
    '<ellipse cx="32" cy="42" rx="2.6" ry="2" fill="#2b2320"/>' +
    "</svg>",
  cat:
    '<svg viewBox="0 0 64 64" aria-hidden="true">' +
    '<polygon points="16,22 22,6 28,24" fill="#c9a479"/>' +
    '<polygon points="48,22 42,6 36,24" fill="#c9a479"/>' +
    '<ellipse cx="32" cy="36" rx="20" ry="18" fill="#e4c39c"/>' +
    '<path d="M22 41 Q32 47 42 41" stroke="#8a6a48" stroke-width="1.8" fill="none" stroke-linecap="round"/>' +
    '<circle cx="25" cy="33" r="3" fill="#2b2320"/>' +
    '<circle cx="39" cy="33" r="3" fill="#2b2320"/>' +
    '<polygon points="30,39 34,39 32,42" fill="#c97a86"/>' +
    "</svg>",
  chick:
    '<svg viewBox="0 0 64 64" aria-hidden="true">' +
    '<ellipse cx="32" cy="35" rx="20" ry="19" fill="#f3cf4e"/>' +
    '<polygon points="29,9 35,9 32,2" fill="#f3cf4e"/>' +
    '<circle cx="25" cy="32" r="3" fill="#2b2320"/>' +
    '<circle cx="39" cy="32" r="3" fill="#2b2320"/>' +
    '<polygon points="26,40 38,40 32,49" fill="#e8934a"/>' +
    "</svg>",
  bird:
    '<svg viewBox="0 0 64 64" aria-hidden="true">' +
    '<ellipse cx="32" cy="35" rx="20" ry="19" fill="#5fb0c6"/>' +
    '<path d="M13 35 Q22 26 24 41 Q15 43 13 35 Z" fill="#3f8fa6"/>' +
    '<circle cx="27" cy="31" r="3" fill="#20302f"/>' +
    '<circle cx="41" cy="31" r="3" fill="#20302f"/>' +
    '<polygon points="40,39 53,35 40,45" fill="#eb9a4e"/>' +
    "</svg>",
  rabbit:
    '<svg viewBox="0 0 64 64" aria-hidden="true">' +
    '<ellipse cx="22" cy="13" rx="6" ry="14" fill="#f2c9d6" transform="rotate(-12 22 13)"/>' +
    '<ellipse cx="42" cy="13" rx="6" ry="14" fill="#f2c9d6" transform="rotate(12 42 13)"/>' +
    '<ellipse cx="32" cy="38" rx="19" ry="18" fill="#fbeaf0"/>' +
    '<circle cx="25" cy="36" r="3" fill="#2b2320"/>' +
    '<circle cx="39" cy="36" r="3" fill="#2b2320"/>' +
    '<polygon points="30,42 34,42 32,45" fill="#d98a9e"/>' +
    "</svg>",
  koala:
    '<svg viewBox="0 0 64 64" aria-hidden="true">' +
    '<circle cx="13" cy="26" r="9" fill="#a89bb0"/>' +
    '<circle cx="51" cy="26" r="9" fill="#a89bb0"/>' +
    '<ellipse cx="32" cy="36" rx="19" ry="18" fill="#c6bccf"/>' +
    '<circle cx="25" cy="34" r="3" fill="#2b2320"/>' +
    '<circle cx="39" cy="34" r="3" fill="#2b2320"/>' +
    '<ellipse cx="32" cy="41" rx="4" ry="3" fill="#4a4350"/>' +
    "</svg>",
  hamster:
    '<svg viewBox="0 0 64 64" aria-hidden="true">' +
    '<circle cx="15" cy="22" r="7" fill="#e0a877"/>' +
    '<circle cx="49" cy="22" r="7" fill="#e0a877"/>' +
    '<ellipse cx="32" cy="37" rx="20" ry="18" fill="#f0c79a"/>' +
    '<ellipse cx="19" cy="42" rx="6" ry="5" fill="#f6dcb8"/>' +
    '<ellipse cx="45" cy="42" rx="6" ry="5" fill="#f6dcb8"/>' +
    '<circle cx="25" cy="34" r="3" fill="#2b2320"/>' +
    '<circle cx="39" cy="34" r="3" fill="#2b2320"/>' +
    '<polygon points="30,39 34,39 32,42" fill="#c97a5a"/>' +
    "</svg>",
  panda:
    '<svg viewBox="0 0 64 64" aria-hidden="true">' +
    '<circle cx="14" cy="20" r="8" fill="#3a3a3a"/>' +
    '<circle cx="50" cy="20" r="8" fill="#3a3a3a"/>' +
    '<ellipse cx="32" cy="36" rx="20" ry="18" fill="#f5f5f0"/>' +
    '<ellipse cx="24" cy="33" rx="5" ry="6" fill="#3a3a3a"/>' +
    '<ellipse cx="40" cy="33" rx="5" ry="6" fill="#3a3a3a"/>' +
    '<circle cx="24" cy="33" r="2" fill="#fff"/>' +
    '<circle cx="40" cy="33" r="2" fill="#fff"/>' +
    '<ellipse cx="32" cy="42" rx="3" ry="2.4" fill="#3a3a3a"/>' +
    "</svg>",
};

// 計費規則：第一段固定 15 分鐘 200 元；第一次加時間是 +15 分鐘 200 元；
// 之後每次加時間都是 +10 分鐘 100 元。
const BASE_TIME = { mins: 15, price: 200 };
const FIRST_EXTEND = { mins: 15, price: 200 };
const STEP_EXTEND = { mins: 10, price: 100 };

function nextExtend(customer) {
  return customer.extendCount === 0 ? FIRST_EXTEND : STEP_EXTEND;
}

// 預覽「一次加 N 次時間」的累計分鐘/金額，不會真的修改客人資料
// （例如已經加過一次的客人再選「加 3 次」，前面用掉的第一次 +15 分鐘不會重複算）
function previewExtend(customer, steps) {
  let mins = 0;
  let price = 0;
  let ec = customer.extendCount;
  for (let i = 0; i < steps; i++) {
    const step = ec === 0 ? FIRST_EXTEND : STEP_EXTEND;
    mins += step.mins;
    price += step.price;
    ec++;
  }
  return { mins, price };
}

// 依計費規則，算出「一開始就選這個時間」的金額和已經用掉幾次加時間
// （這樣客人一開始就選 30 分鐘，之後按「加時間」也會接著算對，不會又收一次 +15 分鐘的錢）
function computeStart(targetMins) {
  let mins = BASE_TIME.mins;
  let price = BASE_TIME.price;
  let count = 0;
  while (mins < targetMins) {
    const step = count === 0 ? FIRST_EXTEND : STEP_EXTEND;
    mins += step.mins;
    price += step.price;
    count++;
  }
  return { mins, price, extendCount: count };
}

const START_OPTIONS = [15, 30].map(computeStart);

const WEEKDAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];
function fmtTodayLine(nowMs) {
  const d = new Date(nowMs);
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return (
    d.getMonth() + 1 + "月" + d.getDate() + "日（週" + WEEKDAY_NAMES[d.getDay()] + "）　" + hh + ":" + mi
  );
}

function makeSlot(c, onDuty) {
  const assigned = !!c.staffName;
  return {
    key: c.key,
    staffName: c.staffName,
    hex: c.hex,
    avatar: c.avatar,
    assigned,
    status: assigned && onDuty ? "available" : "off", // off | available | serving
    customer: null, // {gender, note, startAt, endAt, price, mins, extendCount}
    prevSnapshot: null, // 用來做「回到上一步」的一次性復原
  };
}

// 師傅姓名本地儲存：改名字/新增師傅後，重新整理頁面仍記得。
// 故意「不」存上/下班狀態——每天都要讓使用者自己確認今天誰來，
// 避免存了舊的上班狀態反而搞混（見下方 ROSTER 畫面邏輯）。
const NAMES_STORAGE_KEY = "marsage_staff_names_v1";

function loadSavedNames() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(NAMES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveStaffNames(slots) {
  if (typeof window === "undefined") return;
  try {
    const map = {};
    slots.forEach((s) => {
      if (s.assigned && s.staffName) {
        map[s.key] = { staffName: s.staffName, assigned: true };
      }
    });
    window.localStorage.setItem(NAMES_STORAGE_KEY, JSON.stringify(map));
  } catch (e) {
    // 存不進去也不影響操作，安靜略過
  }
}

function buildInitialSlots() {
  // 預設全部下班，師傅要上班才手動點「上班」
  return COLORS.map((c) => makeSlot(c, false));
}

// ============================================================
// 共用小元件
// ============================================================

function Avatar({ slot, size = 48 }) {
  if (!slot) {
    return (
      <span
        className="dot"
        style={{ width: size, height: size, background: "var(--ink-faint)" }}
      />
    );
  }
  if (!slot.avatar || !AVATAR_SVG[slot.avatar]) {
    return (
      <span
        className="dot"
        style={{ width: size, height: size, background: slot.hex }}
      />
    );
  }
  const bg = `color-mix(in srgb, ${slot.hex} 24%, var(--surface-alt) 76%)`;
  return (
    <span className="avatar" style={{ width: size, height: size, background: bg }}>
      <span dangerouslySetInnerHTML={{ __html: AVATAR_SVG[slot.avatar] }} />
      <span className="avatar-dot" style={{ background: slot.hex }} />
    </span>
  );
}

function TopBar({ back, step }) {
  return (
    <div className="topbar">
      {back ? (
        <button className="backbtn" onClick={back.onClick}>
          {back.icon || (back.label === "回首頁" ? "🏠" : "←")} {back.label}
        </button>
      ) : (
        <span />
      )}
      {step ? (
        <span className="step-pill">
          第 <span className="num">{step[0]}</span> 步／共 <span className="num">{step[1]}</span> 步
        </span>
      ) : (
        <span />
      )}
    </div>
  );
}

// ============================================================
// 主元件
// ============================================================

export default function LaoBanTimer() {
  const [screen, setScreen] = useState("ROSTER");
  const [dayConfirmed, setDayConfirmed] = useState(false);
  const [slots, setSlots] = useState(buildInitialSlots);
  const [waiting, setWaiting] = useState([]);
  const [history, setHistory] = useState([]);
  const [flow, setFlow] = useState({});
  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  const toastTimerRef = useRef(null);
  const newStaffInputRef = useRef(null);
  const renameInputRef = useRef(null);

  // 每 15 秒更新一次「現在時間」，讓時鐘列跟倒數計時字樣都會跟著跳。
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);

  // 只在瀏覽器端讀一次 localStorage，把之前存過的自訂姓名帶回來。
  // 特別放在 useEffect（而不是 useState 的初始值）是為了在 Next.js 這類
  // 會做伺服器端渲染的框架下也能安全執行。
  useEffect(() => {
    const saved = loadSavedNames();
    if (Object.keys(saved).length === 0) return;
    setSlots((prev) =>
      prev.map((s) => {
        const rec = saved[s.key];
        if (rec && rec.staffName) {
          return { ...s, staffName: rec.staffName, assigned: true };
        }
        return s;
      })
    );
  }, []);

  // 保護措施：如果正在看某位客人的詳情頁，但這位客人已經被結束服務
  // （例如被別的操作影響），自動跳回首頁，不要停在一個不存在的畫面。
  useEffect(() => {
    if (screen === "SLOT_DETAIL") {
      const slot = findSlot(flow.slotKey);
      if (!slot || slot.status !== "serving") {
        setScreen("HOME");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, flow.slotKey, slots]);

  useEffect(() => {
    if (screen === "NEW_STAFF" && newStaffInputRef.current) {
      newStaffInputRef.current.focus();
    }
    if (screen === "RENAME_STAFF" && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [screen]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // ---------- 小工具 ----------
  function findSlot(key) {
    return slots.find((s) => s.key === key);
  }
  function patchSlot(key, updater) {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.key !== key) return s;
        const copy = { ...s, customer: s.customer ? { ...s.customer } : null };
        updater(copy);
        return copy;
      })
    );
  }
  function availableSlots() {
    return slots.filter((s) => s.status === "available");
  }
  function servingSlots() {
    return slots.filter((s) => s.status === "serving");
  }
  function assignedSlots() {
    return slots.filter((s) => s.assigned);
  }
  function freeSlot() {
    return slots.find((s) => !s.assigned) || null;
  }
  function onDutyCount() {
    return slots.filter((s) => s.assigned && s.status !== "off").length;
  }
  function staffSummaries() {
    const map = {};
    const order = [];
    history.forEach((h) => {
      if (!map[h.staffName]) {
        map[h.staffName] = { staffName: h.staffName, count: 0, mins: 0, price: 0 };
        order.push(h.staffName);
      }
      map[h.staffName].count += 1;
      map[h.staffName].mins += h.mins;
      map[h.staffName].price += h.price;
    });
    return order.map((name) => map[name]).sort((a, b) => b.price - a.price);
  }
  function fmtRemain(slot) {
    if (slot.status !== "serving") return null;
    const remain = slot.customer.endAt - now;
    const mins = Math.round(remain / 60000);
    if (mins <= 0) return { mins: 0, over: true };
    return { mins, over: false };
  }

  function patchFlow(patch) {
    setFlow((prev) => ({ ...prev, ...patch }));
  }
  function resetFlow() {
    setFlow({});
  }
  function clearToast() {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToast(null);
  }
  function go(nextScreen, flowPatch) {
    clearToast();
    setScreen(nextScreen);
    if (flowPatch) patchFlow(flowPatch);
  }
  function goHome() {
    resetFlow();
    go("HOME");
  }
  function showToast(msg) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(msg);
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 1800);
  }
  function closeModal() {
    setModal(null);
  }

  // ---------- 各種操作 ----------
  function handleSetStaff(key, val) {
    setSlots((prev) =>
      prev.map((s) => (s.key === key ? { ...s, status: val === "on" ? "available" : "off" } : s))
    );
  }
  function handleConfirmRoster() {
    setDayConfirmed(true);
    goHome();
  }
  function handleEditStaffName(key) {
    const s = findSlot(key);
    go("RENAME_STAFF", { editKey: key, editName: s ? s.staffName : "" });
  }
  function handleConfirmRenameStaff() {
    const newName = (flow.editName || "").trim();
    if (!newName) {
      showToast("請先輸入名字");
      return;
    }
    setSlots((prev) => {
      const next = prev.map((s) => (s.key === flow.editKey ? { ...s, staffName: newName } : s));
      saveStaffNames(next);
      return next;
    });
    resetFlow();
    setScreen("ROSTER");
    showToast("已經改成「" + newName + "」");
  }
  function handleConfirmNewStaff() {
    const name = (flow.newStaffName || "").trim();
    if (!name) {
      showToast("請先輸入名字");
      return;
    }
    const target = freeSlot();
    if (!target) {
      showToast("已經到達最多可設定的人數，請聯絡工程師");
      return;
    }
    setSlots((prev) => {
      const next = prev.map((s) =>
        s.key === target.key ? { ...s, staffName: name, assigned: true, status: "available" } : s
      );
      saveStaffNames(next);
      return next;
    });
    resetFlow();
    setScreen("ROSTER");
    showToast("已新增「" + name + "」，今天算上班");
  }
  function handleConfirmAdd() {
    const opt = START_OPTIONS[flow.startIdx == null ? 0 : flow.startIdx];
    if (flow.slotKey) {
      setSlots((prev) =>
        prev.map((s) =>
          s.key === flow.slotKey
            ? {
                ...s,
                status: "serving",
                prevSnapshot: null,
                customer: {
                  gender: flow.gender,
                  note: flow.note || "",
                  startAt: Date.now(),
                  endAt: Date.now() + opt.mins * 60000,
                  price: opt.price,
                  mins: opt.mins,
                  extendCount: opt.extendCount,
                },
              }
            : s
        )
      );
      if (flow.fromWaitId) {
        setWaiting((prev) => prev.filter((w) => w.id !== flow.fromWaitId));
      }
    } else {
      setWaiting((prev) => [
        ...prev,
        { id: Date.now(), gender: flow.gender, note: flow.note || "", ts: Date.now() },
      ]);
    }
    go("ADD_DONE");
  }
  function handleAskExtend() {
    setModal("extend");
  }
  function handleDoExtend() {
    const slot = findSlot(flow.slotKey);
    const step = nextExtend(slot.customer);
    patchSlot(flow.slotKey, (s) => {
      s.prevSnapshot = { ...s.customer };
      s.customer.endAt += step.mins * 60000;
      s.customer.mins += step.mins;
      s.customer.price += step.price;
      s.customer.extendCount += 1;
    });
    setModal(null);
    showToast("已經加 " + step.mins + " 分鐘，多收 NT$" + step.price);
  }
  function handleQuickExtend(key) {
    patchFlow({ slotKey: key || flow.slotKey });
    setModal("quickExtend");
  }
  function handlePickQuickExtend(steps) {
    patchFlow({ extendSteps: steps });
    setModal("extendConfirm");
  }
  function handleDoExtendSteps() {
    const slot = findSlot(flow.slotKey);
    const steps = flow.extendSteps || 1;
    const p = previewExtend(slot.customer, steps);
    patchSlot(flow.slotKey, (s) => {
      s.prevSnapshot = { ...s.customer };
      s.customer.endAt += p.mins * 60000;
      s.customer.mins += p.mins;
      s.customer.price += p.price;
      s.customer.extendCount += steps;
    });
    setModal(null);
    showToast("已經加 " + p.mins + " 分鐘，多收 NT$" + p.price);
  }
  function handleFinishSlot() {
    const slot = findSlot(flow.slotKey);
    setHistory((prev) => [
      ...prev,
      {
        staffName: slot.staffName,
        gender: slot.customer.gender,
        mins: slot.customer.mins,
        price: slot.customer.price,
      },
    ]);
    patchSlot(flow.slotKey, (s) => {
      s.status = "available";
      s.customer = null;
      s.prevSnapshot = null;
    });
    go("FINISH_DONE", { slotName: slot.staffName });
  }
  function handleAskUndo() {
    setModal("undo");
  }
  function handleDoUndo() {
    patchSlot(flow.slotKey, (s) => {
      if (s.prevSnapshot) {
        s.customer = s.prevSnapshot;
        s.prevSnapshot = null;
      }
    });
    setModal(null);
  }
  function handleAssignPickSlot(key) {
    const w = waiting.find((x) => x.id === flow.waitId);
    if (!w) {
      goHome();
      return;
    }
    go("ADD_CONFIRM", {
      slotKey: key,
      gender: w.gender,
      note: w.note,
      fromWaitId: w.id,
      showNote: !!w.note,
    });
  }
  function handleRemoveWaiting() {
    setWaiting((prev) => prev.filter((x) => x.id !== flow.waitId));
    goHome();
  }
  function handleDoReset() {
    setHistory([]);
    setModal(null);
    showToast("已經清空今天的紀錄");
  }
  function handleExportCsv() {
    const rows = [["師傅", "客人性別", "分鐘", "金額"]];
    history.forEach((h) => rows.push([h.staffName, h.gender, h.mins, h.price]));
    const csv = "﻿" + rows.map((r) => r.join(",")).join("\n");
    try {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "來客登記表.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast("檔案已經下載了");
    } catch (e) {
      showToast("暫時無法存檔，請稍後再試一次");
    }
  }

  // ============================================================
  // 畫面：HOME
  // ============================================================
  function renderHome() {
    const serving = servingSlots();
    return (
      <>
        <TopBar />
        <h1 className="title">今天的狀況</h1>
        <div className="status-line">
          今天上班 <b className="num">{onDutyCount()}</b> 位師傅
          <button onClick={() => go("ROSTER")}>調整今天上班名單</button>
        </div>

        <div className="grow">
          <div className="section-label">正在服務中</div>
          {serving.length === 0 ? (
            <div className="empty-note">目前沒有客人在服務中</div>
          ) : (
            serving.map((s) => {
              const r = fmtRemain(s);
              const cls = "slot-card" + (r.over || r.mins <= 5 ? " urgent" : "");
              return (
                <div key={s.key}>
                  <button
                    className={cls}
                    style={{ marginBottom: 0 }}
                    onClick={() => go("SLOT_DETAIL", { slotKey: s.key })}
                  >
                    <Avatar slot={s} size={44} />
                    <span className="slot-main">
                      <div className="slot-name">
                        {s.staffName}　{s.customer.gender}客人
                      </div>
                      <div className="slot-detail-text">
                        {r.over ? "已經超過時間，可以結束了" : r.mins <= 5 ? "快好了，準備結束" : "服務中"}
                      </div>
                    </span>
                    <span className="slot-time num">{r.over ? "已到" : r.mins}</span>
                  </button>
                  <button className="quick-extend-hint" onClick={() => handleQuickExtend(s.key)}>
                    💡 提示：點一下可以加分鐘
                  </button>
                </div>
              );
            })
          )}

          {waiting.length > 0 && (
            <>
              <div className="section-label" style={{ marginTop: 18 }}>
                等待中的客人
              </div>
              {waiting.map((w) => (
                <button
                  key={w.id}
                  className="slot-card info"
                  onClick={() => go("ASSIGN_SLOT", { waitId: w.id })}
                >
                  <span className="dot" style={{ background: "var(--info)" }} />
                  <span className="slot-main">
                    <div className="slot-name">
                      {w.gender}客人{w.note ? "（" + w.note + "）" : ""}
                    </div>
                    <div className="slot-detail-text">還沒安排師傅</div>
                  </span>
                  <span className="slot-time" style={{ fontSize: 17, color: "var(--info)" }}>
                    安排
                  </span>
                </button>
              ))}
            </>
          )}
        </div>

        <div className="bottom-actions">
          <button
            className="btn btn-primary"
            onClick={() => {
              resetFlow();
              go("ADD_SLOT", { gender: "女" });
            }}
          >
            ＋ 新增客人
          </button>
          <button className="btn-quiet" style={{ alignSelf: "center" }} onClick={() => go("SUMMARY")}>
            查看今日營收總結
          </button>
        </div>
      </>
    );
  }

  // ============================================================
  // 畫面：ROSTER（早上開班確認／臨時調整上下班）
  // ============================================================
  function renderRoster() {
    const firstTime = !dayConfirmed;
    return (
      <>
        <TopBar back={firstTime ? null : { onClick: () => go("HOME"), label: "回首頁" }} />
        <h1 className="title">{firstTime ? "今天哪些人上班？" : "調整今天上班名單"}</h1>
        <div className="hint-banner">
          {firstTime
            ? "今天有來上班的人，點一下改成「上班」，其他不用管。"
            : "臨時有人來上班或先下班，點一下就可以改，馬上生效。"}
        </div>
        <div className="grow">
          {assignedSlots().map((s) => {
            const on = s.status !== "off";
            const disabled = s.status === "serving";
            return (
              <div className="staff-row" key={s.key}>
                <div className="staff-row-head">
                  <Avatar slot={s} size={52} />
                  <span className="slot-name">
                    {s.staffName}
                    {disabled ? "（服務中）" : ""}
                  </span>
                  <button className="edit-name-btn" onClick={() => handleEditStaffName(s.key)}>
                    ✎ 改名字
                  </button>
                </div>
                {disabled ? (
                  <>
                    <div className="seg" style={{ opacity: 0.55, pointerEvents: "none" }}>
                      <span className="seg-btn seg-yes active">☀️ 上班</span>
                      <span className="seg-btn seg-no">🌙 下班</span>
                    </div>
                    <p style={{ fontSize: 14, color: "var(--urgent)", fontWeight: 700, margin: 0 }}>
                      服務進行中，需待服務結束後才能切換為下班。
                    </p>
                  </>
                ) : (
                  <div className="seg">
                    <button
                      className={"seg-btn seg-yes" + (on ? " active" : "")}
                      onClick={() => handleSetStaff(s.key, "on")}
                    >
                      ☀️ 上班
                    </button>
                    <button
                      className={"seg-btn seg-no" + (!on ? " active" : "")}
                      onClick={() => handleSetStaff(s.key, "off")}
                    >
                      🌙 下班
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {freeSlot() && (
            <div className="note-toggle">
              <button className="btn-quiet" onClick={() => go("NEW_STAFF", { newStaffName: "" })}>
                ＋ 有新的師傅要加入
              </button>
            </div>
          )}
        </div>
        <div className="bottom-actions">
          {firstTime ? (
            <button className="btn btn-primary" onClick={handleConfirmRoster}>
              ✓ 確認，開始今天營業
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => go("HOME")}>
              完成，回首頁
            </button>
          )}
        </div>
      </>
    );
  }

  // ============================================================
  // 畫面：新增師傅 / 改名字（都需要打字）
  // ============================================================
  function renderNewStaff() {
    return (
      <>
        <TopBar back={{ onClick: () => go("ROSTER"), label: "上一步" }} />
        <h1 className="title">這位新師傅叫什麼名字？</h1>
        <p className="sub">打字輸入名字，其他都不用設定。</p>
        <div className="grow">
          <input
            ref={newStaffInputRef}
            className="note-input"
            type="text"
            placeholder="例如：陳小姐"
            style={{ fontSize: 22, fontWeight: 700, minHeight: 64 }}
            value={flow.newStaffName || ""}
            onChange={(e) => patchFlow({ newStaffName: e.target.value })}
          />
        </div>
        <div className="bottom-actions">
          <button className="btn btn-primary" onClick={handleConfirmNewStaff}>
            ✓ 確認新增，今天算上班
          </button>
        </div>
      </>
    );
  }

  function renderRenameStaff() {
    const slot = findSlot(flow.editKey);
    return (
      <>
        <TopBar back={{ onClick: () => go("ROSTER"), label: "上一步" }} />
        <h1 className="title">幫{slot ? slot.staffName : "這位師傅"}改名字</h1>
        <p className="sub">打字輸入新的名字，按確認就會馬上換掉。</p>
        <div className="grow">
          <input
            ref={renameInputRef}
            className="note-input"
            type="text"
            placeholder="輸入新名字"
            style={{ fontSize: 22, fontWeight: 700, minHeight: 64 }}
            value={flow.editName != null ? flow.editName : slot ? slot.staffName : ""}
            onChange={(e) => patchFlow({ editName: e.target.value })}
          />
        </div>
        <div className="bottom-actions">
          <button className="btn btn-primary" onClick={handleConfirmRenameStaff}>
            ✓ 確認修改
          </button>
        </div>
      </>
    );
  }

  // ============================================================
  // 畫面：新增客人流程（性別＋指定師傅合併成一步，共 2 步）
  // ============================================================
  function renderAddSlot() {
    const gender = flow.gender || "女";
    const avail = availableSlots();
    return (
      <>
        <TopBar back={{ onClick: () => go("HOME"), label: "取消" }} step={[1, 2]} />
        <h1 className="title">客人資料</h1>
        <p className="sub">客人是男生還是女生？指定給哪一位師傅？</p>
        <div className="grow">
          <div className="seg" style={{ marginBottom: 18 }}>
            {["女", "男"].map((g) => (
              <button
                key={g}
                className={"seg-btn" + (gender === g ? " active seg-yes" : "")}
                onClick={() => patchFlow({ gender: g })}
              >
                {g === "女" ? "👩" : "👨"} {g}生
              </button>
            ))}
          </div>

          <div className="section-label">指定給哪一位師傅？</div>
          {avail.length === 0 ? (
            <div className="empty-note">目前沒有空的師傅，先讓客人等待也沒關係</div>
          ) : (
            <div className="choice-grid">
              {avail.map((s) => (
                <button key={s.key} className="choice-btn" onClick={() => go("ADD_CONFIRM", { slotKey: s.key })}>
                  <Avatar slot={s} size={44} />
                  {s.staffName}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="bottom-actions">
          <button className="btn btn-secondary" onClick={() => go("ADD_CONFIRM", { slotKey: null })}>
            先不指定，加入等待名單
          </button>
        </div>
      </>
    );
  }

  function renderAddConfirm() {
    const f = flow;
    const slot = f.slotKey ? findSlot(f.slotKey) : null;
    const fromWaiting = !!f.fromWaitId;
    return (
      <>
        <TopBar
          back={
            fromWaiting
              ? { onClick: () => go("ASSIGN_SLOT", { waitId: f.fromWaitId }), label: "上一步" }
              : { onClick: () => go("ADD_SLOT"), label: "上一步" }
          }
          step={fromWaiting ? undefined : [2, 2]}
        />
        <h1 className="title">確認一下資料</h1>
        <div className="grow">
          <div className="confirm-card">
            <div className="confirm-row">
              <span>客人</span>
              <span>{f.gender}生</span>
            </div>
            <div className="confirm-row">
              <span>安排給</span>
              <span>{slot ? slot.staffName : "先排隊等待"}</span>
            </div>
          </div>

          {slot && (
            <>
              <div className="section-label">客人一開始要按多久？</div>
              <div className="choice-grid" style={{ marginBottom: 14 }}>
                {START_OPTIONS.map((o, i) => {
                  const sel = (f.startIdx == null ? 0 : f.startIdx) === i;
                  return (
                    <button
                      key={i}
                      className={"choice-btn" + (sel ? " selected" : "")}
                      style={{ padding: "18px 8px" }}
                      onClick={() => patchFlow({ startIdx: i })}
                    >
                      <span style={{ fontSize: 26 }}>
                        {o.mins} <span style={{ fontSize: 15, fontWeight: 500 }}>分鐘</span>
                      </span>
                      <span style={{ fontSize: 15, color: "var(--ink-muted)" }}>NT${o.price}</span>
                    </button>
                  );
                })}
              </div>
              <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "-6px 0 4px" }}>
                之後要加時間，到這位客人的畫面按「加時間」就可以，價錢會自動算好。
              </p>
            </>
          )}

          {f.showNote ? (
            <textarea
              className="note-input"
              placeholder="例如：長髮、戴眼鏡（不填也可以）"
              value={f.note || ""}
              onChange={(e) => patchFlow({ note: e.target.value })}
            />
          ) : (
            <div className="note-toggle">
              <button className="btn-quiet" onClick={() => patchFlow({ showNote: true })}>
                ＋ 加一點備註（不填也可以）
              </button>
            </div>
          )}
        </div>
        <div className="bottom-actions">
          <button className="btn btn-primary" onClick={handleConfirmAdd}>
            {slot ? "✓ 開始服務" : "✓ 加入等待名單"}
          </button>
        </div>
      </>
    );
  }

  function renderAddDone() {
    const f = flow;
    const slot = f.slotKey ? findSlot(f.slotKey) : null;
    return (
      <div className="done-wrap">
        <div className="done-check">✓</div>
        <div className="done-title">已完成，不需要再操作</div>
        {f.slotKey ? (
          <div className="done-sub">{slot ? slot.staffName : ""} 已經開始倒數計時，時間到了首頁會提醒你。</div>
        ) : (
          <div className="done-sub">客人已經加入等待名單，最上面的就是下一位。</div>
        )}
        <button className="btn btn-primary" style={{ marginTop: 22, width: 220 }} onClick={goHome}>
          🏠 回首頁
        </button>
      </div>
    );
  }

  // ============================================================
  // 畫面：等待名單 -> 安排師傅
  // ============================================================
  function renderAssignSlot() {
    const w = waiting.find((x) => x.id === flow.waitId);
    const avail = availableSlots();
    return (
      <>
        <TopBar back={{ onClick: () => go("HOME"), label: "回首頁" }} />
        <h1 className="title">安排給哪一位師傅？</h1>
        <p className="sub">{w ? w.gender + "生客人" + (w.note ? "（" + w.note + "）" : "") : ""}</p>
        <div className="grow">
          {avail.length === 0 ? (
            <div className="empty-note">目前沒有空的師傅，請稍後再安排</div>
          ) : (
            <div className="choice-grid">
              {avail.map((s) => (
                <button key={s.key} className="choice-btn" onClick={() => handleAssignPickSlot(s.key)}>
                  <Avatar slot={s} size={44} />
                  {s.staffName}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="bottom-actions">
          <button
            className="btn-quiet"
            style={{ alignSelf: "center", color: "var(--danger)" }}
            onClick={handleRemoveWaiting}
          >
            這位客人取消了，移除名單
          </button>
        </div>
      </>
    );
  }

  // ============================================================
  // 畫面：客人詳情（倒數計時 / 加時間 / 結束服務）
  // ============================================================
  function renderSlotDetail() {
    const slot = findSlot(flow.slotKey);
    if (!slot || slot.status !== "serving") return null; // useEffect 會自動導回首頁
    const r = fmtRemain(slot);
    const urgent = r.over || r.mins <= 5;
    const step = nextExtend(slot.customer);
    return (
      <>
        <TopBar back={{ onClick: () => go("HOME"), label: "回首頁" }} />

        <div
          className="detail-hero"
          style={{
            background: urgent ? "var(--urgent-tint)" : "var(--surface)",
            border: "2px solid " + (urgent ? "var(--urgent)" : "var(--border)"),
          }}
        >
          <div className="name">
            <Avatar slot={slot} size={40} />
            {slot.staffName}　{slot.customer.gender}生客人
          </div>
          <div className="big-time num" style={{ color: urgent ? "var(--urgent)" : "var(--ink)" }}>
            {r.over ? "0" : r.mins}
          </div>
          <div className="msg" style={{ color: urgent ? "var(--urgent-ink)" : "var(--ink-muted)" }}>
            {r.over ? "時間到了，可以請客人結束囉" : "分鐘後結束"}
          </div>
        </div>

        <div className="info-list">
          <div className="confirm-row">
            <span>目前金額</span>
            <span className="num">NT${slot.customer.price}</span>
          </div>
          {slot.customer.note && (
            <div className="confirm-row">
              <span>備註</span>
              <span>{slot.customer.note}</span>
            </div>
          )}
        </div>

        <div className="grow" />

        <div className="bottom-actions">
          <button className="btn btn-primary" onClick={handleFinishSlot}>
            ✓ 客人結束了
          </button>
          <button className="btn btn-secondary" onClick={handleAskExtend}>
            再加 {step.mins} 分鐘（多收 NT${step.price}）
          </button>
          {slot.prevSnapshot && (
            <button className="btn-quiet" style={{ alignSelf: "center" }} onClick={handleAskUndo}>
              剛剛按錯了？回到上一步
            </button>
          )}
        </div>
      </>
    );
  }

  function renderFinishDone() {
    return (
      <div className="done-wrap">
        <div className="done-check">✓</div>
        <div className="done-title">已完成，不需要再操作</div>
        <div className="done-sub">{flow.slotName} 已經結束服務，現在可以再接新的客人了。</div>
        <button className="btn btn-primary" style={{ marginTop: 22, width: 220 }} onClick={goHome}>
          🏠 回首頁
        </button>
      </div>
    );
  }

  // ============================================================
  // 畫面：今日營收總結
  // ============================================================
  function renderSummary() {
    const totalRevenue = history.reduce((a, h) => a + h.price, 0);
    const totalCount = history.length;
    const payout = Math.round(totalRevenue * 0.25);
    return (
      <>
        <TopBar back={{ onClick: () => go("HOME"), label: "回首頁" }} />
        <h1 className="title">今日營收總結</h1>
        <div className="grow">
          <div className="confirm-card">
            <div className="confirm-row">
              <span>已完成客人數</span>
              <span className="num">{totalCount} 位</span>
            </div>
            <div className="confirm-row">
              <span>總收入</span>
              <span className="num">NT${totalRevenue}</span>
            </div>
            <div className="confirm-row">
              <span>店裡應收金額（25%）</span>
              <span className="num">NT${payout}</span>
            </div>
          </div>

          {totalCount === 0 ? (
            <div className="empty-note">今天還沒有完成的客人紀錄</div>
          ) : (
            <>
              <div className="section-label" style={{ marginTop: 18 }}>
                各師傅分潤明細（師傅75%）
              </div>
              {staffSummaries().map((s) => {
                const staffSlot = slots.find((x) => x.staffName === s.staffName);
                const share = Math.round(s.price * 0.75);
                return (
                  <div className="staff-row" style={{ marginBottom: 10 }} key={s.staffName}>
                    <div className="staff-row-head">
                      <Avatar slot={staffSlot} size={40} />
                      <span className="slot-name">{s.staffName}</span>
                    </div>
                    <div className="confirm-row">
                      <span>完成客人</span>
                      <span className="num">{s.count} 位</span>
                    </div>
                    <div className="confirm-row">
                      <span>服務分鐘</span>
                      <span className="num">{s.mins} 分鐘</span>
                    </div>
                    <div className="confirm-row">
                      <span>分潤金額</span>
                      <span className="num" style={{ color: "var(--primary)" }}>
                        NT${share}
                      </span>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
        <div className="bottom-actions">
          <button className="btn btn-secondary" onClick={handleExportCsv}>
            下載今天的紀錄檔案
          </button>
          <button className="btn-danger-outline" onClick={() => setModal("reset")}>
            清空今天的所有紀錄
          </button>
        </div>
      </>
    );
  }

  // ============================================================
  // 彈出視窗（Modal）
  // ============================================================
  function renderModal() {
    if (modal === "extend") {
      const slot = findSlot(flow.slotKey);
      if (!slot || !slot.customer) return null;
      const step = nextExtend(slot.customer);
      return (
        <div className="overlay">
          <div className="modal">
            <h2>要加 {step.mins} 分鐘嗎？</h2>
            <p>
              {slot.staffName} 會多收 NT${step.price}，總共變成 {slot.customer.mins + step.mins} 分鐘。
            </p>
            <div className="stack">
              <button className="btn btn-primary" onClick={handleDoExtend}>
                ✓ 確認，加 {step.mins} 分鐘
              </button>
              <button className="btn btn-secondary" onClick={closeModal}>
                上一步
              </button>
            </div>
          </div>
        </div>
      );
    }
    if (modal === "quickExtend") {
      const slot = findSlot(flow.slotKey);
      if (!slot || !slot.customer) return null;
      const options = [1, 2, 3].map((n) => ({ steps: n, p: previewExtend(slot.customer, n) }));
      return (
        <div className="overlay">
          <div className="modal">
            <h2>幫{slot.staffName}的客人加多久？</h2>
            <p>選一下要加多少時間，價錢會自動算好。</p>
            <div className="stack">
              {options.map((o) => (
                <button
                  key={o.steps}
                  className="btn btn-secondary"
                  onClick={() => handlePickQuickExtend(o.steps)}
                >
                  +{o.p.mins} 分鐘（多收 NT${o.p.price}）
                </button>
              ))}
              <button className="btn-quiet" onClick={closeModal}>
                先不加，關閉
              </button>
            </div>
          </div>
        </div>
      );
    }
    if (modal === "extendConfirm") {
      const slot = findSlot(flow.slotKey);
      if (!slot || !slot.customer) return null;
      const steps = flow.extendSteps || 1;
      const p = previewExtend(slot.customer, steps);
      return (
        <div className="overlay">
          <div className="modal">
            <h2>要加 {p.mins} 分鐘嗎？</h2>
            <p>
              {slot.staffName} 會多收 NT${p.price}，總共變成 {slot.customer.mins + p.mins} 分鐘。
            </p>
            <div className="stack">
              <button className="btn btn-primary" onClick={handleDoExtendSteps}>
                ✓ 確認，加 {p.mins} 分鐘
              </button>
              <button className="btn btn-secondary" onClick={() => setModal("quickExtend")}>
                上一步
              </button>
            </div>
          </div>
        </div>
      );
    }
    if (modal === "undo") {
      return (
        <div className="overlay">
          <div className="modal">
            <h2>回到上一步？</h2>
            <p>會取消剛剛的操作，恢復成前一個狀態。</p>
            <div className="stack">
              <button className="btn btn-primary" onClick={handleDoUndo}>
                是，回到上一步
              </button>
              <button className="btn btn-secondary" onClick={closeModal}>
                不用了
              </button>
            </div>
          </div>
        </div>
      );
    }
    if (modal === "reset") {
      return (
        <div className="overlay">
          <div className="modal">
            <h2>確定要清空今天的紀錄嗎？</h2>
            <p>清空後金額跟人數都會歸零，而且沒辦法復原。真的要清空嗎？</p>
            <div className="stack">
              <button className="btn-danger-fill" onClick={handleDoReset}>
                是，清空今天的紀錄
              </button>
              <button className="btn btn-secondary" onClick={closeModal}>
                先不要
              </button>
            </div>
          </div>
        </div>
      );
    }
    return null;
  }

  // ============================================================
  // 畫面總開關
  // ============================================================
  let screenContent;
  switch (screen) {
    case "HOME":
      screenContent = renderHome();
      break;
    case "ROSTER":
      screenContent = renderRoster();
      break;
    case "NEW_STAFF":
      screenContent = renderNewStaff();
      break;
    case "RENAME_STAFF":
      screenContent = renderRenameStaff();
      break;
    case "ADD_SLOT":
      screenContent = renderAddSlot();
      break;
    case "ADD_CONFIRM":
      screenContent = renderAddConfirm();
      break;
    case "ADD_DONE":
      screenContent = renderAddDone();
      break;
    case "ASSIGN_SLOT":
      screenContent = renderAssignSlot();
      break;
    case "SLOT_DETAIL":
      screenContent = renderSlotDetail();
      break;
    case "FINISH_DONE":
      screenContent = renderFinishDone();
      break;
    case "SUMMARY":
      screenContent = renderSummary();
      break;
    default:
      screenContent = renderHome();
  }

  return (
    <div className="lbt-root">
      <style>{CSS_TEXT}</style>
      <div className="lbt-stage">
        <div className="lbt-clockbar">{fmtTodayLine(now)}</div>
        <div className="lbt-app">
          <div className="screen">{screenContent}</div>
          {renderModal()}
          {toast && <div className="toast">{toast}</div>}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 樣式（跟原型完全一樣，只是把 #stage/#clock-bar/#app 換成
// className，並把原本套用在 <body> 上的樣式改成只套用在 .lbt-root，
// 避免影響到整個網站的其他頁面）
// ============================================================
const CSS_TEXT = `
.lbt-root{
  --bg: #f4f5f2;
  --bg-outer: #e7e8e2;
  --surface: #ffffff;
  --surface-alt: #eceee9;
  --ink: #20241f;
  --ink-muted: #62685f;
  --ink-faint: #5c6959;
  --border: #dcded7;
  --border-strong: #bcc0b5;

  --primary: #316666;
  --primary-strong: #234d4d;
  --primary-ink: #ffffff;
  --primary-tint: #dbe8e6;

  --hint-bg: #b1ccb9;
  --hint-ink: #1f3b32;

  --urgent: #b5402f;
  --urgent-tint: #f8e4df;
  --urgent-ink: #7a2a1e;

  --info: #33698f;
  --info-tint: #e2edf4;

  --danger: #93402e;
  --danger-tint: #f4e6e1;

  --shadow: 0 18px 40px -20px rgba(35,48,42,0.35);
  --shadow-soft: 0 8px 20px -12px rgba(35,48,42,0.25);

  --radius-lg: 28px;
  --radius-md: 18px;
  --radius-sm: 12px;

  background: var(--bg-outer);
  color: var(--ink);
  font-family: "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", -apple-system, sans-serif;
  -webkit-font-smoothing: antialiased;
  display:flex;
  justify-content:center;
  align-items:flex-start;
  min-height:100dvh;
  padding: 28px 12px;
}

@media (prefers-color-scheme: dark){
  .lbt-root:not([data-theme="light"]){
    --bg: #181d1a;
    --bg-outer: #10140f;
    --surface: #222824;
    --surface-alt: #2a312b;
    --ink: #eef1ea;
    --ink-muted: #aab6ac;
    --ink-faint: #8a9688;
    --border: #38423a;
    --border-strong: #4a564a;

    --primary: #5fa0a0;
    --primary-strong: #82c0c0;
    --primary-ink: #0c1e1e;
    --primary-tint: #223938;

    --hint-bg: #2c463e;
    --hint-ink: #cfe6dc;

    --urgent: #e08670;
    --urgent-tint: #3a241f;
    --urgent-ink: #f6d8cf;

    --info: #7fb3d6;
    --info-tint: #1f313d;

    --danger: #d98a72;
    --danger-tint: #33231e;

    --shadow: 0 18px 40px -20px rgba(0,0,0,0.6);
    --shadow-soft: 0 8px 20px -12px rgba(0,0,0,0.5);
  }
}
.lbt-root[data-theme="dark"]{
  --bg: #181d1a;
  --bg-outer: #10140f;
  --surface: #222824;
  --surface-alt: #2a312b;
  --ink: #eef1ea;
  --ink-muted: #aab6ac;
  --ink-faint: #8a9688;
  --border: #38423a;
  --border-strong: #4a564a;

  --primary: #5fa0a0;
  --primary-strong: #82c0c0;
  --primary-ink: #0c1e1e;
  --primary-tint: #223938;

  --hint-bg: #2c463e;
  --hint-ink: #cfe6dc;

  --urgent: #e08670;
  --urgent-tint: #3a241f;
  --urgent-ink: #f6d8cf;

  --info: #7fb3d6;
  --info-tint: #1f313d;

  --danger: #d98a72;
  --danger-tint: #33231e;

  --shadow: 0 18px 40px -20px rgba(0,0,0,0.6);
  --shadow-soft: 0 8px 20px -12px rgba(0,0,0,0.5);
}

.lbt-root *{ box-sizing: border-box; }
.lbt-root .num{ font-family:"Archivo","Noto Sans TC",sans-serif; font-variant-numeric: tabular-nums; }

.lbt-stage{
  width:100%;
  max-width:440px;
  background: var(--bg);
  border-radius: 34px;
  box-shadow: var(--shadow);
  overflow:hidden;
  border: 1px solid var(--border);
  min-height: min(860px, 92dvh);
  display:flex;
  flex-direction:column;
  position:relative;
}

.lbt-clockbar{
  flex-shrink:0;
  text-align:center;
  padding:10px 12px 8px;
  font-family:"Archivo","Noto Sans TC",sans-serif;
  font-variant-numeric: tabular-nums;
  font-size:15px;
  font-weight:700;
  letter-spacing:.02em;
  color: var(--ink-muted);
  background: var(--surface-alt);
  border-bottom:1px solid var(--border);
}

.lbt-app{
  flex:1;
  display:flex;
  flex-direction:column;
  min-height:0;
}

.lbt-root .screen{
  flex:1;
  display:flex;
  flex-direction:column;
  padding: 22px 22px 26px;
  min-height:0;
  animation: lbt-rise .28s ease both;
}
@keyframes lbt-rise{
  from{ opacity:0; transform: translateY(10px); }
  to{ opacity:1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce){
  .lbt-root .screen{ animation:none; }
  .lbt-root *{ transition:none !important; animation-duration:.001s !important; }
}

.lbt-root .topbar{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  margin-bottom: 18px;
  min-height: 46px;
}
.lbt-root .backbtn{
  display:flex;
  align-items:center;
  gap:6px;
  background:none;
  border:none;
  color: var(--ink-muted);
  font-family:inherit;
  font-size:17px;
  font-weight:700;
  padding:8px 4px;
  cursor:pointer;
  border-radius: 10px;
}
.lbt-root .backbtn:active{ background: var(--surface-alt); }
.lbt-root .step-pill{
  background: var(--surface-alt);
  color: var(--ink-muted);
  font-size:15px;
  font-weight:700;
  padding:7px 14px;
  border-radius:999px;
  white-space:nowrap;
}
.lbt-root .step-pill .num{ color: var(--ink); }

.lbt-root h1.title{
  font-size: 26px;
  font-weight:900;
  margin: 0 0 6px;
  line-height:1.25;
  text-wrap: balance;
}
.lbt-root p.sub{
  font-size:17px;
  color: var(--ink-muted);
  margin: 0 0 20px;
  line-height:1.5;
}

.lbt-root .grow{ flex:1; min-height:0; overflow-y:auto; -webkit-overflow-scrolling: touch; }
.lbt-root .grow::-webkit-scrollbar{ width:0; }

.lbt-root .btn{
  display:flex;
  align-items:center;
  justify-content:center;
  gap:10px;
  width:100%;
  border:none;
  border-radius: var(--radius-md);
  font-family:inherit;
  font-weight:700;
  cursor:pointer;
  text-align:center;
  line-height:1.3;
}
.lbt-root .btn:active{ transform: scale(0.98); }
.lbt-root .btn-primary{
  background: linear-gradient(180deg, color-mix(in srgb, var(--primary) 100%, white 10%), var(--primary));
  color: var(--primary-ink);
  font-size:22px;
  padding: 22px 18px;
  box-shadow: var(--shadow-soft), inset 0 1px 0 rgba(255,255,255,.22);
}
.lbt-root .btn-primary:active{ box-shadow: inset 0 2px 6px rgba(0,0,0,.18); }
.lbt-root .btn-secondary{
  background: var(--surface);
  color: var(--ink);
  border: 2px solid var(--border-strong);
  font-size:18px;
  padding:16px 16px;
  box-shadow: var(--shadow-soft);
}
.lbt-root .btn-quiet{
  background:none;
  color: var(--ink-muted);
  font-size:16px;
  font-weight:700;
  padding:10px;
  text-decoration: underline;
  text-underline-offset:4px;
  border:none;
  cursor:pointer;
  font-family:inherit;
}
.lbt-root .btn-danger-outline{
  background: var(--surface);
  color: var(--danger);
  border: 2px solid var(--danger);
  font-size:16px;
  padding:14px 16px;
  opacity:.9;
  border-radius: var(--radius-md);
  font-family:inherit;
  font-weight:700;
  cursor:pointer;
  width:100%;
}
.lbt-root .btn-danger-fill{
  background: var(--danger);
  color: #fff;
  font-size:18px;
  padding:16px 16px;
  border:none;
  border-radius: var(--radius-md);
  font-family:inherit;
  font-weight:700;
  cursor:pointer;
  width:100%;
}

.lbt-root .stack{ display:flex; flex-direction:column; gap:12px; }

.lbt-root .bottom-actions{
  display:flex; flex-direction:column; gap:10px;
  padding-top:14px;
}

.lbt-root .status-line{
  display:flex; align-items:center; gap:10px;
  background: var(--surface);
  border:1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 14px 16px;
  margin-bottom:16px;
  font-size:16px;
  color: var(--ink-muted);
}
.lbt-root .status-line b{ color: var(--ink); font-weight:700; }
.lbt-root .status-line button{
  margin-left:auto;
  background:none;border:none;
  color: var(--primary);
  font-weight:700;
  font-size:15px;
  text-decoration:underline;
  text-underline-offset:3px;
  cursor:pointer;
  white-space:nowrap;
  font-family:inherit;
}

.lbt-root .section-label{
  font-size:15px;
  font-weight:700;
  color: var(--ink-faint);
  letter-spacing:.02em;
  margin: 4px 0 10px;
}

.lbt-root .slot-card{
  display:flex;
  align-items:center;
  gap:14px;
  width:100%;
  background: var(--surface);
  border: 2px solid var(--border);
  border-radius: var(--radius-md);
  padding: 16px 16px;
  margin-bottom:12px;
  cursor:pointer;
  font-family:inherit;
  text-align:left;
  box-shadow: var(--shadow-soft);
}
.lbt-root .slot-card:active{ transform: scale(0.985); }
.lbt-root .slot-card.urgent{ background: var(--urgent-tint); border-color: var(--urgent); }
.lbt-root .slot-card.info{ background: var(--info-tint); border-color: var(--info); }

.lbt-root .dot{
  width:30px; height:30px; border-radius:50%;
  flex-shrink:0;
  border: 3px solid rgba(0,0,0,.28);
  box-shadow: inset 0 0 0 2px rgba(255,255,255,.55), 0 1px 2px rgba(0,0,0,.2);
}

.lbt-root .avatar{
  position:relative;
  border-radius:50%;
  flex-shrink:0;
  display:flex;
  align-items:center;
  justify-content:center;
  overflow:hidden;
}
.lbt-root .avatar svg{ width:84%; height:84%; display:block; }
.lbt-root .avatar-dot{
  position:absolute;
  top:-2px; right:-2px;
  width:30%; height:30%;
  min-width:13px; min-height:13px;
  border-radius:50%;
  border:2px solid var(--surface);
  box-shadow:0 1px 2px rgba(0,0,0,.25);
}

.lbt-root .hint-banner{
  background: var(--hint-bg);
  color: var(--hint-ink);
  border-radius: var(--radius-md);
  padding:14px 16px;
  font-size:16px;
  line-height:1.5;
  margin:0 0 20px;
}
.lbt-root .slot-main{ flex:1; min-width:0; }
.lbt-root .slot-name{ font-size:19px; font-weight:700; margin-bottom:2px; }
.lbt-root .slot-detail-text{ font-size:15px; color: var(--ink-muted); }
.lbt-root .slot-card.urgent .slot-detail-text{ color: var(--urgent-ink); font-weight:700; }
.lbt-root .slot-time{ font-size:26px; font-weight:800; flex-shrink:0; }
.lbt-root .slot-card.urgent .slot-time{ color: var(--urgent); }

.lbt-root .quick-extend-hint{
  display:block;
  width:100%;
  background: var(--primary-tint);
  color: var(--primary-strong);
  border:none;
  border-radius: 0 0 var(--radius-md) var(--radius-md);
  font-family:inherit; font-weight:700; font-size:15px;
  padding:11px 16px;
  margin: -4px 0 12px;
  cursor:pointer;
  text-align:center;
}

.lbt-root .empty-note{
  text-align:center;
  color: var(--ink-faint);
  font-size:16px;
  padding: 22px 10px;
  background: var(--surface-alt);
  border-radius: var(--radius-md);
  margin-bottom:16px;
}

.lbt-root .choice-grid{
  display:grid;
  grid-template-columns: 1fr 1fr;
  gap:14px;
}
.lbt-root .choice-btn{
  display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px;
  background: var(--surface);
  border: 3px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 26px 10px;
  font-size:22px;
  font-weight:700;
  cursor:pointer;
  font-family:inherit;
  color:var(--ink);
  box-shadow: var(--shadow-soft);
  position:relative;
}
.lbt-root .choice-btn:active{ transform: scale(0.97); }
.lbt-root .choice-btn.selected{ border-color: var(--primary); background: var(--primary-tint); box-shadow: var(--shadow-soft), 0 0 0 3px color-mix(in srgb, var(--primary) 35%, transparent); }
.lbt-root .choice-btn.selected::after{
  content:"✓"; position:absolute; top:8px; right:10px;
  width:26px; height:26px; border-radius:50%;
  background: var(--primary); color: var(--primary-ink);
  display:flex; align-items:center; justify-content:center;
  font-size:16px; font-weight:900; line-height:1;
}

.lbt-root .confirm-card{
  background: var(--surface);
  border:2px solid var(--border);
  border-radius: var(--radius-lg);
  padding:22px;
  margin-bottom:16px;
  box-shadow: var(--shadow-soft);
}
.lbt-root .confirm-row{
  display:flex; justify-content:space-between; align-items:center;
  padding:10px 0;
  font-size:18px;
  border-bottom:1px solid var(--border);
}
.lbt-root .confirm-row:last-child{ border-bottom:none; }
.lbt-root .confirm-row span:first-child{ color: var(--ink-muted); }
.lbt-root .confirm-row span:last-child{ font-weight:700; text-align:right; }

.lbt-root .note-toggle{
  text-align:center;
  margin: 2px 0 16px;
}
.lbt-root textarea.note-input, .lbt-root input.note-input{
  width:100%;
  font-family:inherit;
  font-size:18px;
  padding:16px;
  border-radius: var(--radius-md);
  border:2px solid var(--border-strong);
  background: var(--surface);
  color: var(--ink);
  resize:none;
  min-height:70px;
  margin-bottom:16px;
}

.lbt-root .done-wrap{
  flex:1;
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  text-align:center;
  gap:14px;
}
.lbt-root .done-check{
  width:96px; height:96px; border-radius:50%;
  background: var(--primary-tint);
  color: var(--primary);
  display:flex; align-items:center; justify-content:center;
  font-size:54px;
  font-weight:900;
  margin-bottom:6px;
}
.lbt-root .done-title{ font-size:24px; font-weight:900; }
.lbt-root .done-sub{ font-size:17px; color: var(--ink-muted); max-width:300px; }

.lbt-root .detail-hero{
  border-radius: var(--radius-lg);
  padding: 30px 22px;
  text-align:center;
  margin-bottom:18px;
}
.lbt-root .detail-hero .name{ font-size:22px; font-weight:700; margin-bottom:10px; display:flex; align-items:center; justify-content:center; gap:10px; }
.lbt-root .detail-hero .big-time{ font-size:64px; font-weight:800; line-height:1; margin-bottom:8px; }
.lbt-root .detail-hero .msg{ font-size:18px; font-weight:700; }

.lbt-root .info-list{
  background: var(--surface);
  border:2px solid var(--border);
  border-radius: var(--radius-md);
  padding: 4px 18px;
  margin-bottom:18px;
  box-shadow: var(--shadow-soft);
}

.lbt-root .overlay{
  position:absolute; inset:0;
  background: rgba(20,26,20,0.55);
  display:flex; align-items:flex-end; justify-content:center;
  padding: 16px;
  z-index: 20;
}
.lbt-root .modal{
  width:100%;
  background: var(--surface);
  border-radius: 24px;
  padding: 26px 22px 22px;
  box-shadow: var(--shadow);
}
.lbt-root .modal h2{ font-size:21px; margin:0 0 10px; font-weight:900; }
.lbt-root .modal p{ font-size:16px; color: var(--ink-muted); margin:0 0 20px; line-height:1.6; }

.lbt-root .toast{
  position:absolute;
  left:16px; right:16px; bottom:16px;
  background: var(--ink);
  color: var(--bg);
  padding:14px 18px;
  border-radius: 14px;
  font-size:16px;
  font-weight:700;
  text-align:center;
  z-index: 30;
  animation: lbt-toastIn .25s ease both;
}
@keyframes lbt-toastIn{ from{opacity:0; transform:translateY(8px);} to{opacity:1; transform:translateY(0);} }

.lbt-root .staff-row{
  display:flex; flex-direction:column; gap:12px;
  background: var(--surface);
  border:2px solid var(--border);
  border-radius: var(--radius-md);
  padding:14px 16px;
  margin-bottom:12px;
  box-shadow: var(--shadow-soft);
}
.lbt-root .staff-row-head{ display:flex; align-items:center; gap:10px; }
.lbt-root .staff-row .slot-name{ flex:1; margin:0; }
.lbt-root .edit-name-btn{
  background:none; border:none;
  color: var(--ink-muted);
  font-family:inherit; font-size:14px; font-weight:700;
  padding:8px 6px;
  cursor:pointer;
  white-space:nowrap;
}
.lbt-root .seg{
  display:flex; gap:6px;
  background: var(--surface-alt);
  border-radius:16px;
  padding:4px;
  box-shadow: var(--shadow-soft);
}
.lbt-root .seg-btn{
  flex:1;
  text-align:center;
  border:none;
  border-radius:12px;
  padding:13px 6px;
  font-family:inherit; font-weight:700; font-size:16px;
  background: transparent;
  color: var(--ink-muted);
  cursor:pointer;
}
.lbt-root .seg-btn.seg-yes.active{ background: var(--primary); color: var(--primary-ink); box-shadow: var(--shadow-soft); }
.lbt-root .seg-btn.seg-no.active{ background: var(--danger); color: #fff; box-shadow: var(--shadow-soft); }
`;
