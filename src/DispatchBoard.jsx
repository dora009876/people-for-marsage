import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Plus,
  Pencil,
  Check,
  Download,
  Zap,
  X,
  UserPlus,
  Undo2,
  Sun,
  Moon,
  Share2,
  History,
  ChevronDown,
} from "lucide-react";

// 這個 App 原本是在 Claude Artifact 環境裡用 window.storage 存資料，
// 部署到 Vercel 後改用瀏覽器的 localStorage 達到一樣的「重新整理資料還在」效果。
// list() 額外實作 key 前綴查詢，用來支援「歷史紀錄」功能列出過去有資料的日期。
const storage = {
  async get(key) {
    try {
      const value = window.localStorage.getItem(key);
      return value !== null ? { key, value } : null;
    } catch (e) {
      return null;
    }
  },
  async set(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return { key, value };
    } catch (e) {
      return null;
    }
  },
  async list(prefix) {
    try {
      const keys = Object.keys(window.localStorage).filter((k) => k.startsWith(prefix));
      return { keys };
    } catch (e) {
      return null;
    }
  },
};

// ============================================
// 測試模式開關：平常正式使用請保持 60 * 1000（代表 1 分鐘 = 60 秒）。
// 想快速測試時，把下面這一行改成 1000（1 分鐘 = 1 秒，方便快速測試倒數/完成邏輯），
// 測完記得改回 60 * 1000，並按畫面上的「歸零」清掉測試產生的假紀錄，避免跟正式資料混在一起。
const MINUTE_MS = 60 * 1000; // ← 測試時把這裡改成 1000，測完改回 60 * 1000
// ============================================

const URGENT_MS = 5 * MINUTE_MS; // 5 分鐘內 = 緊急
const SLOT_COUNT = 10;
const SLOTS_KEY = "dispatch-board:slots";
const LOG_KEY_PREFIX = "dispatch-board:log:"; // + 日期 yyyy-mm-dd
const QUEUE_KEY = "dispatch-board:queue";

// 每種單位對應的分鐘數與收費，第一個是主要按鈕（+15分鐘），第二個是次要按鈕（+10分鐘）
const UNIT_OPTIONS = [
  { minutes: 15, price: 200 },
  { minutes: 10, price: 100 },
];
const PRICE_MAP = { 15: 200, 10: 100 };
function calcPrice(units) {
  return (units || []).reduce((sum, u) => sum + (PRICE_MAP[u] || 0), 0);
}

// 依分鐘數反推「應該是多少錢」：嘗試用15分鐘（優先）+10分鐘的組合湊出總分鐘數，
// 湊得出來就自動填金額；湊不出來（例如22分鐘這種怪數字）就回傳 null，讓使用者自己填金額。
function estimatePriceForMinutes(minutes) {
  if (!minutes || minutes <= 0) return null;
  const maxFifteens = Math.floor(minutes / 15);
  for (let a = maxFifteens; a >= 0; a--) {
    const remainder = minutes - a * 15;
    if (remainder % 10 === 0) {
      const b = remainder / 10;
      return a * 200 + b * 100;
    }
  }
  return null;
}

// 依一天的完整紀錄（log 陣列）組出跟畫面上「各編號今日接待人數」一致的表格式 CSV 內容。
// 用 log 裡存的 slotName（完成當下的名字），不依賴目前的 slots，這樣歷史紀錄也能正確還原。
function buildCsvContent(logData) {
  const slotNames = [];
  const bySlot = {};
  logData.forEach((e) => {
    if (!bySlot[e.slotName]) {
      bySlot[e.slotName] = [];
      slotNames.push(e.slotName);
    }
    bySlot[e.slotName].push(e);
  });
  slotNames.forEach((name) => bySlot[name].sort((a, b) => a.time - b.time));
  const maxRows = Math.max(0, ...slotNames.map((n) => bySlot[n].length));

  const header = "," + slotNames.join(",") + "\n";
  let rows = "";
  for (let i = 0; i < maxRows; i++) {
    const rowCells = slotNames.map((n) => {
      const e = bySlot[n][i];
      if (!e) return "";
      const price = e.price != null ? e.price : calcPrice(e.units);
      return `${price}元`;
    });
    rows += `${i + 1},${rowCells.join(",")}\n`;
  }

  const subtotalCells = slotNames.map((n) => {
    const total = bySlot[n].reduce(
      (sum, e) => sum + (e.price != null ? e.price : calcPrice(e.units)),
      0
    );
    return `${total}元`;
  });
  const subtotalRow = `小計,${subtotalCells.join(",")}\n`;

  const totalCountValue = logData.length;
  const totalRevenueValue = logData.reduce(
    (sum, e) => sum + (e.price != null ? e.price : calcPrice(e.units)),
    0
  );
  const summary = `\n總計,人頭次,${totalCountValue}\n總計,金額,NT$${totalRevenueValue}`;
  return "\uFEFF" + header + rows + subtotalRow + summary;
}

function downloadCsvContent(content, filename) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 用瀏覽器原生的分享功能把 CSV 檔案交給使用者選擇的 App（Mail、LINE、AirDrop...）。
// mailto 連結本身沒辦法夾帶附件，所以真正能「附檔寄送」只有這個方式；
// 回傳 false 代表使用者的瀏覽器/裝置不支援，或使用者取消了分享，這時該改用一般下載。
async function shareCsvContent(content, filename) {
  try {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const file = new File([blob], filename, { type: "text/csv" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return true;
    }
  } catch (e) {
    // 使用者取消分享，或裝置不支援，交給呼叫端改用下載
  }
  return false;
}

// 把一天的 log 陣列整理成「各編號今日接待人數」畫面用得到的摘要，歷史紀錄查詢時使用
function summarizeLog(logData) {
  const order = [];
  const bySlot = {};
  logData.forEach((e) => {
    if (!bySlot[e.slotName]) {
      bySlot[e.slotName] = { count: 0, revenue: 0 };
      order.push(e.slotName);
    }
    const price = e.price != null ? e.price : calcPrice(e.units);
    bySlot[e.slotName].count += 1;
    bySlot[e.slotName].revenue += price;
  });
  const totalCount = logData.length;
  const totalRevenue = order.reduce((sum, n) => sum + bySlot[n].revenue, 0);
  return {
    totalCount,
    totalRevenue,
    perSlot: order.map((n) => ({ name: n, ...bySlot[n] })),
  };
}

// 全站顏色統一在這裡管理，畫面上一律用 inline style 套用，
// 確保顏色一定生效（不依賴任何 CSS class 編譯）。白底淺色主題。
const C = {
  page: "#FFFFFF",
  text: "#1A1D23",
  textMuted: "#6B7280",
  textFaint: "#9CA3AF",
  panelBg: "#F5F6F8",
  panelBorder: "#E4E7EB",
  chipBg: "#EEF0F3",
  chipBgHover: "#E4E7EB",
  chipBorder: "#C7CDD6",
  chipText: "#4B5563",
  inputBg: "#FFFFFF",

  readyBg: "#E7F7EE",
  readyBorder: "#B7E7C9",
  readyDot: "#16A34A",
  readyText: "#15803D",

  soonestBg: "#E5F0FF",
  soonestBorder: "#B9D9FF",
  soonestDot: "#2563EB",
  soonestText: "#1D4ED8",
  soonestBadgeBg: "#2563EB",
  soonestBadgeText: "#FFFFFF",

  urgentBg: "#FDECEC",
  urgentBorder: "#F5B5B5",
  urgentDot: "#DC2626",
  urgentText: "#B91C1C",

  normalBg: "#FDF3E0",
  normalBorder: "#F0D89A",
  normalDot: "#D97706",
  normalText: "#B45309",

  offlineBg: "#F1F2F4",
  offlineBorder: "#E2E5EA",
  offlineDot: "#9CA3AF",
  offlineText: "#6B7280",

  female: "#F472B6",
  femaleText: "#831843",
  male: "#60A5FA",
  maleText: "#1E3A8A",

  assign: "#EDE4FF",
  assignText: "#5B21B6",

  clockInBg: "#316666",
  clockInText: "#FFFFFF",
  clockOutBg: "#E4E7EB",
  clockOutText: "#4B5563",
};

const COLOR_SWATCHES = [
  { name: "紅", hex: "#E84F4F" },
  { name: "橘", hex: "#E8853D" },
  { name: "黃", hex: "#E8D23D" },
  { name: "綠", hex: "#4CBB84" },
  { name: "藍", hex: "#4DA6FF" },
  { name: "紫", hex: "#A366D9" },
  { name: "粉", hex: "#E86FA0" },
  { name: "黑", hex: "#6B7078" },
  { name: "白", hex: "#EDEAE3" },
  { name: "咖啡", hex: "#9C6B45" },
];

function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function defaultSlots() {
  return Array.from({ length: SLOT_COUNT }, (_, i) => ({
    id: i + 1,
    name: `${i + 1}號`,
    readyAt: null,
    cycleMinutes: 0,
    unitHistory: [], // 這一輪依序按過的單位（例如 [15, 15, 10]），用來支援「上一步」跟精準計費
    active: true, // 是否今日上線接單
    activationOrder: i + 1, // 今天上班的先後順序（越小越早），一開始依編號排，之後每次開台會更新
    savedRemainingMs: null, // 不小心關台時，暫存當下還剩多少毫秒
    savedCycleMinutes: 0,
    savedUnitHistory: [],
  }));
}

function formatRemaining(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatClockTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// 用 Web Audio API 產生鈴聲，不需要另外準備音檔。
// 瀏覽器通常要求先有一次使用者互動（例如按過任何按鈕）才能播放聲音，
// 這個 App 本來就會一直按按鈕，所以之後倒數快結束時可以正常響鈴。
// 響鈴總長10秒：每隔0.8秒響一小聲，總共響約12次，比單一聲更容易被注意到。
function playBeep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const totalDuration = 10; // 秒
    const interval = 0.8; // 每聲間隔
    const beepLength = 0.35; // 單聲長度
    const beepCount = Math.floor(totalDuration / interval);

    for (let i = 0; i < beepCount; i++) {
      const startTime = ctx.currentTime + i * interval;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.35, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + beepLength);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + beepLength);
    }

    setTimeout(() => ctx.close(), (totalDuration + 0.5) * 1000);
  } catch (e) {}
}

// 補登／編輯紀錄時，分鐘數下拉選單的預設選項：15分鐘（單一基本單位），之後每次+10分鐘累加
const MINUTE_PRESET_OPTIONS = [15, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150];

const ORDINAL_CN = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
function ordinalLabel(rank) {
  const word = ORDINAL_CN[rank - 1] || rank;
  return `第${word}結束`;
}
function ordinalWorkLabel(rank) {
  const word = ORDINAL_CN[rank - 1] || rank;
  return `第${word}上班`;
}

// 依排序模式排列人頭清單的純函式（不含釘選邏輯），toggleExpand 跟 sortedOnlineSlots 共用
function computeSortedSlots(list, sortMode, now) {
  const arr = [...list];
  if (sortMode === "activation") {
    arr.sort((a, b) => (a.activationOrder || a.id) - (b.activationOrder || b.id));
  } else {
    arr.sort((a, b) => {
      const aReady = !a.readyAt || a.readyAt <= now;
      const bReady = !b.readyAt || b.readyAt <= now;
      if (aReady && !bReady) return -1;
      if (!aReady && bReady) return 1;
      if (aReady && bReady) {
        return (a.activationOrder || a.id) - (b.activationOrder || b.id);
      }
      return a.readyAt - b.readyAt;
    });
  }
  return arr;
}

export default function DispatchBoard() {
  const [slots, setSlots] = useState(defaultSlots());
  const [now, setNow] = useState(Date.now());
  const [editingId, setEditingId] = useState(null);
  const [draftName, setDraftName] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [log, setLog] = useState([]);
  const [queue, setQueue] = useState([]); // 顧客等待名單
  const [newGender, setNewGender] = useState("女");
  const [newColor, setNewColor] = useState(COLOR_SWATCHES[0].hex);
  const [newNote, setNewNote] = useState("");
  const [newAssignedSlotId, setNewAssignedSlotId] = useState(null);
  const [resetConfirmId, setResetConfirmId] = useState(null); // 正在等待第二次確認歸零的人頭id
  const [clockOutConfirmId, setClockOutConfirmId] = useState(null); // 正在等待第二次確認下班的人頭id
  const clockOutConfirmTimeoutRef = useRef(null);
  const [clockOutAllConfirm, setClockOutAllConfirm] = useState(false); // 正在等待第二次確認「一鍵全下班」
  const clockOutAllConfirmTimeoutRef = useRef(null);
  const [clearLogConfirm, setClearLogConfirm] = useState(false); // 正在等待第二次確認「清空今日紀錄」
  const clearLogConfirmTimeoutRef = useRef(null);
  const [historyOpen, setHistoryOpen] = useState(false); // 歷史紀錄面板是否展開
  const [historyDays, setHistoryDays] = useState(null); // 有資料的日期清單（null=尚未載入過）
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyDayData, setHistoryDayData] = useState({}); // 快取：{日期: log陣列}
  const [selectedHistoryDay, setSelectedHistoryDay] = useState(null);
  const [editingLogId, setEditingLogId] = useState(null); // 正在編輯的紀錄id
  const [editMinutesDraft, setEditMinutesDraft] = useState("");
  const [editPriceDraft, setEditPriceDraft] = useState("");
  const [addingEntrySlotId, setAddingEntrySlotId] = useState(null); // 正在手動補登紀錄的人頭id
  const [newEntryMinutes, setNewEntryMinutes] = useState("15");
  const [newEntryPrice, setNewEntryPrice] = useState("200");
  const [expandedIds, setExpandedIds] = useState(() => new Set()); // 精簡橫列中，被點開顯示完整操作的人頭id
  const [sortMode, setSortMode] = useState("activation"); // "activation" = 上班順序, "finish" = 結束順序
  const loadedRef = useRef(false);
  const beepedRef = useRef({}); // { slotId: readyAt } 記錄這一輪已經響過3秒前提醒鈴的人頭，避免同一輪重複響
  const resetConfirmTimeoutRef = useRef(null);
  const dayKey = useMemo(() => todayKey(), []);

  useEffect(() => {
    (async () => {
      try {
        const result = await storage.get(SLOTS_KEY, false);
        if (result && result.value) {
          const parsed = JSON.parse(result.value);
          if (Array.isArray(parsed) && parsed.length === SLOT_COUNT) {
            setSlots(
              parsed.map((s, idx) => ({
                cycleMinutes: 0,
                unitHistory: [],
                active: true,
                activationOrder: idx + 1,
                savedRemainingMs: null,
                savedCycleMinutes: 0,
                savedUnitHistory: [],
                ...s,
              }))
            );
          }
        }
      } catch (e) {}
      try {
        const logResult = await storage.get(LOG_KEY_PREFIX + dayKey, false);
        if (logResult && logResult.value) {
          const parsedLog = JSON.parse(logResult.value);
          if (Array.isArray(parsedLog)) setLog(parsedLog);
        }
      } catch (e) {}
      try {
        const queueResult = await storage.get(QUEUE_KEY, false);
        if (queueResult && queueResult.value) {
          const parsedQueue = JSON.parse(queueResult.value);
          if (Array.isArray(parsedQueue)) setQueue(parsedQueue);
        }
      } catch (e) {}
      setLoaded(true);
      loadedRef.current = true;
    })();
  }, [dayKey]);

  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (!loadedRef.current) return;

      setSlots((prev) => {
        const completions = [];
        const updated = prev.map((s) => {
          // 倒數結束前3秒響一聲提醒鈴（每一輪只響一次）
          if (s.active && s.readyAt) {
            const remaining = s.readyAt - t;
            if (remaining > 0 && remaining <= 3000 && beepedRef.current[s.id] !== s.readyAt) {
              beepedRef.current[s.id] = s.readyAt;
              playBeep();
            }
          }
          if (s.readyAt && s.readyAt <= t && s.cycleMinutes > 0) {
            completions.push({
              id: `${s.id}-${s.readyAt}-${Math.random().toString(36).slice(2, 8)}`,
              slotId: s.id,
              slotName: s.name,
              minutes: s.cycleMinutes,
              units: s.unitHistory,
              price: calcPrice(s.unitHistory),
              time: s.readyAt,
            });
            return { ...s, cycleMinutes: 0, unitHistory: [] };
          }
          return s;
        });
        if (completions.length) {
          setLog((prevLog) => [...prevLog, ...completions]);
          return updated;
        }
        return prev;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    (async () => {
      try {
        await storage.set(SLOTS_KEY, JSON.stringify(slots), false);
      } catch (e) {}
    })();
  }, [slots, loaded]);

  useEffect(() => {
    if (!loaded) return;
    (async () => {
      try {
        await storage.set(LOG_KEY_PREFIX + dayKey, JSON.stringify(log), false);
      } catch (e) {}
    })();
  }, [log, loaded, dayKey]);

  useEffect(() => {
    if (!loaded) return;
    (async () => {
      try {
        await storage.set(QUEUE_KEY, JSON.stringify(queue), false);
      } catch (e) {}
    })();
  }, [queue, loaded]);

  const addMinutes = useCallback((id, minutes) => {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== id || !s.active) return s;
        const isCurrentlyReady = !s.readyAt || s.readyAt <= Date.now();
        const base = isCurrentlyReady ? Date.now() : s.readyAt;
        return {
          ...s,
          readyAt: base + minutes * MINUTE_MS,
          cycleMinutes: (isCurrentlyReady ? 0 : s.cycleMinutes) + minutes,
          unitHistory: [...(isCurrentlyReady ? [] : s.unitHistory), minutes],
        };
      })
    );
  }, []);

  const resetSlot = useCallback((id) => {
    setSlots((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, readyAt: null, cycleMinutes: 0, unitHistory: [] } : s
      )
    );
  }, []);

  // 歸零需要按兩次才會真的執行：第一次按下變成「確定歸零？」，3秒內沒再按就自動取消。
  // 不用瀏覽器原生的 confirm() 彈窗，因為在部分嵌入環境（例如預覽畫面）裡會被封鎖而完全沒反應。
  const handleResetClick = useCallback(
    (id) => {
      if (resetConfirmTimeoutRef.current) {
        clearTimeout(resetConfirmTimeoutRef.current);
        resetConfirmTimeoutRef.current = null;
      }
      setResetConfirmId((prevId) => {
        if (prevId === id) {
          resetSlot(id);
          return null;
        }
        resetConfirmTimeoutRef.current = setTimeout(() => {
          setResetConfirmId(null);
        }, 3000);
        return id;
      });
    },
    [resetSlot]
  );

  const undoUnit = useCallback((id) => {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== id || !s.active || s.cycleMinutes <= 0 || !s.readyAt || s.unitHistory.length === 0)
          return s;
        const lastMinutes = s.unitHistory[s.unitHistory.length - 1];
        const newCycleMinutes = s.cycleMinutes - lastMinutes;
        const newHistory = s.unitHistory.slice(0, -1);
        if (newCycleMinutes <= 0) {
          return { ...s, readyAt: null, cycleMinutes: 0, unitHistory: [] };
        }
        return {
          ...s,
          readyAt: s.readyAt - lastMinutes * MINUTE_MS,
          cycleMinutes: newCycleMinutes,
          unitHistory: newHistory,
        };
      })
    );
  }, []);

  const handleClockOut = useCallback((id) => {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== id || !s.active) return s;
        // 下班：如果當下正在冷卻中，先暫存剩餘時間跟單位組成，之後可以馬上復原
        const remaining = s.readyAt ? s.readyAt - Date.now() : 0;
        const hasRunningTimer = remaining > 0;
        return {
          ...s,
          active: false,
          readyAt: null,
          cycleMinutes: 0,
          unitHistory: [],
          savedRemainingMs: hasRunningTimer ? remaining : null,
          savedCycleMinutes: hasRunningTimer ? s.cycleMinutes : 0,
          savedUnitHistory: hasRunningTimer ? s.unitHistory : [],
        };
      })
    );
  }, []);

  const handleClockIn = useCallback((id) => {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== id || s.active) return s;
        // 上班（非復原）：從「可接單」重新開始，不動用暫存的計時
        // 記錄這次上班的順序（比目前所有人都晚，代表「這次點的算最後上班」）
        const maxOrder = Math.max(SLOT_COUNT, ...prev.map((p) => p.activationOrder || 0));
        return { ...s, active: true, activationOrder: maxOrder + 1 };
      })
    );
  }, []);

  // 下班需要按兩次才會真的執行：第一次按下變成「確定下班？」，3秒內沒再按就自動取消。
  // 因為下班會把人移到未上線清單，還可能打亂原本排好的上班順序，容易誤觸的代價比較大，需要防呆。
  const handleClockOutClick = useCallback(
    (id) => {
      if (clockOutConfirmTimeoutRef.current) {
        clearTimeout(clockOutConfirmTimeoutRef.current);
        clockOutConfirmTimeoutRef.current = null;
      }
      setClockOutConfirmId((prevId) => {
        if (prevId === id) {
          handleClockOut(id);
          return null;
        }
        clockOutConfirmTimeoutRef.current = setTimeout(() => {
          setClockOutConfirmId(null);
        }, 3000);
        return id;
      });
    },
    [handleClockOut]
  );

  const handleClockOutAll = useCallback(() => {
    setSlots((prev) =>
      prev.map((s) => {
        if (!s.active) return s;
        const remaining = s.readyAt ? s.readyAt - Date.now() : 0;
        const hasRunningTimer = remaining > 0;
        return {
          ...s,
          active: false,
          readyAt: null,
          cycleMinutes: 0,
          unitHistory: [],
          savedRemainingMs: hasRunningTimer ? remaining : null,
          savedCycleMinutes: hasRunningTimer ? s.cycleMinutes : 0,
          savedUnitHistory: hasRunningTimer ? s.unitHistory : [],
        };
      })
    );
  }, []);

  // 一鍵全下班一樣需要按兩次確認，因為會一次影響所有上線中的人頭
  const handleClockOutAllClick = useCallback(() => {
    if (clockOutAllConfirmTimeoutRef.current) {
      clearTimeout(clockOutAllConfirmTimeoutRef.current);
      clockOutAllConfirmTimeoutRef.current = null;
    }
    setClockOutAllConfirm((prev) => {
      if (prev) {
        handleClockOutAll();
        return false;
      }
      clockOutAllConfirmTimeoutRef.current = setTimeout(() => {
        setClockOutAllConfirm(false);
      }, 3000);
      return true;
    });
  }, [handleClockOutAll]);

  const restoreSlot = useCallback((id) => {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== id || !s.savedRemainingMs) return s;
        return {
          ...s,
          active: true,
          readyAt: Date.now() + s.savedRemainingMs,
          cycleMinutes: s.savedCycleMinutes,
          unitHistory: s.savedUnitHistory,
          savedRemainingMs: null,
          savedCycleMinutes: 0,
          savedUnitHistory: [],
        };
      })
    );
  }, []);

  const pinnedIndexRef = useRef(null); // 記錄目前展開卡片被點開當下所在的排序位置
  const idleCollapseTimeoutRef = useRef(null); // 閒置太久自動收合的計時器

  // 展開的卡片如果超過10秒沒有任何動作（沒按+15/+10/上一步/歸零），就自動收合、自動歸隊排序，
  // 這樣就算忘記手動收合，也不會一直卡在釘選狀態。每次按按鈕都會重新倒數10秒。
  const scheduleAutoCollapse = useCallback(() => {
    if (idleCollapseTimeoutRef.current) {
      clearTimeout(idleCollapseTimeoutRef.current);
    }
    idleCollapseTimeoutRef.current = setTimeout(() => {
      pinnedIndexRef.current = null;
      setExpandedIds(new Set());
    }, 10000);
  }, []);

  const toggleExpand = useCallback(
    (id) => {
      if (expandedIds.has(id)) {
        // 收合：清掉釘選跟閒置計時器
        pinnedIndexRef.current = null;
        if (idleCollapseTimeoutRef.current) {
          clearTimeout(idleCollapseTimeoutRef.current);
          idleCollapseTimeoutRef.current = null;
        }
        setExpandedIds(new Set());
        return;
      }
      // 展開：記錄當下位置並釘選，同時啟動閒置自動收合的計時器
      const liveSorted = computeSortedSlots(
        slots.filter((s) => s.active),
        sortMode,
        now
      );
      const idx = liveSorted.findIndex((s) => s.id === id);
      pinnedIndexRef.current = idx === -1 ? 0 : idx;
      scheduleAutoCollapse();
      setExpandedIds(new Set([id]));
    },
    [slots, sortMode, now, expandedIds, scheduleAutoCollapse]
  );

  const startEdit = (slot) => {
    setEditingId(slot.id);
    setDraftName(slot.name);
  };

  const commitEdit = (id) => {
    setSlots((prev) =>
      prev.map((s) => (s.id === id ? { ...s, name: draftName.trim() || s.name } : s))
    );
    setEditingId(null);
  };

  const activeSlots = slots.filter((s) => s.active);
  const readyCount = activeSlots.filter((s) => !s.readyAt || s.readyAt <= now).length;

  // 有空位（可接單）時不需要排名，因為「可接單」本身就代表有空位。
  // 只有當所有上線中的人頭都在計時（沒有空位）時，才依結束時間先後排名，顯示「第一結束」「第二結束」…
  const finishRankMap = useMemo(() => {
    const onlineActive = slots.filter((s) => s.active);
    if (onlineActive.length === 0) return {};
    const allBusy = onlineActive.every((s) => s.readyAt && s.readyAt > now);
    if (!allBusy) return {};
    const sorted = [...onlineActive].sort((a, b) => a.readyAt - b.readyAt);
    const map = {};
    sorted.forEach((s, idx) => {
      map[s.id] = idx + 1;
    });
    return map;
  }, [slots, now]);

  // 「上班順序」名次：依今天上班的先後順序排名，跟有沒有空位無關，一律都會有名次
  const activationRankMap = useMemo(() => {
    const onlineActive = slots.filter((s) => s.active);
    const sorted = [...onlineActive].sort(
      (a, b) => (a.activationOrder || a.id) - (b.activationOrder || b.id)
    );
    const map = {};
    sorted.forEach((s, idx) => {
      map[s.id] = idx + 1;
    });
    return map;
  }, [slots]);

  // 上線中的人頭顯示在主看板；未上線的沉到頁面最底部（顧客名單下方）
  const onlineSlots = useMemo(() => slots.filter((s) => s.active), [slots]);
  const offlineSlots = useMemo(() => slots.filter((s) => !s.active), [slots]);

  // 依照目前選的排序模式排列上線中的人頭：
  // 「上班順序」＝今天第一個點上班的排最前面；「結束順序」＝還有空位的排最前面，接著依剩餘時間由短到長排
  // 正在展開操作的那張卡片會「釘選」在原本的位置不動，其他卡片還是會照最新時間即時重新排序，
  // 這樣就算忘記收合，其餘卡片的順序也不會停止更新。
  const pinnedSlotId = expandedIds.size === 1 ? Array.from(expandedIds)[0] : null;
  const sortedOnlineSlots = useMemo(() => {
    const liveSorted = computeSortedSlots(onlineSlots, sortMode, now);
    if (pinnedSlotId == null) return liveSorted;
    const pinnedItem = liveSorted.find((s) => s.id === pinnedSlotId);
    if (!pinnedItem) return liveSorted;
    const rest = liveSorted.filter((s) => s.id !== pinnedSlotId);
    const insertAt = Math.min(pinnedIndexRef.current ?? 0, rest.length);
    rest.splice(insertAt, 0, pinnedItem);
    return rest;
  }, [onlineSlots, sortMode, now, pinnedSlotId]);

  const totalCount = log.length;
  const totalRevenue = log.reduce(
    (sum, e) => sum + (e.price != null ? e.price : calcPrice(e.units)),
    0
  );
  const totalOwed25 = Math.round(totalRevenue * 0.25);
  const totalMinutes = log.reduce((sum, e) => sum + e.minutes, 0);
  const totalHoursWhole = Math.floor(totalMinutes / 60);
  const totalMinsRemainder = totalMinutes % 60;
  const totalTimeLabel =
    totalHoursWhole > 0 && totalMinsRemainder > 0
      ? `${totalHoursWhole}小時${totalMinsRemainder}分鐘`
      : totalHoursWhole > 0
      ? `${totalHoursWhole}小時`
      : `${totalMinsRemainder}分鐘`;

  // 每個編號今日各自累積的人數，以及每一筆的分鐘數／金額明細（用來給統一總覽區塊顯示）
  const perSlotStats = useMemo(() => {
    return slots.map((s) => {
      const entries = log.filter((e) => e.slotId === s.id);
      const mappedEntries = entries.map((e) => ({
        id: e.id,
        minutes: e.minutes,
        price: e.price != null ? e.price : calcPrice(e.units),
        time: e.time,
      }));
      const totalRevenue = mappedEntries.reduce((sum, e) => sum + e.price, 0);
      const share25 = Math.round(totalRevenue * 0.25);
      const share75 = totalRevenue - share25;
      return {
        id: s.id,
        name: s.name,
        active: s.active,
        count: entries.length,
        totalRevenue,
        share25,
        share75,
        entries: mappedEntries,
      };
    });
  }, [slots, log]);

  const exportCsv = () => {
    const csv = buildCsvContent(log);
    downloadCsvContent(csv, `來客登記表_${dayKey}.csv`);
  };

  const shareTodayCsv = async () => {
    const csv = buildCsvContent(log);
    const filename = `來客登記表_${dayKey}.csv`;
    const shared = await shareCsvContent(csv, filename);
    if (!shared) {
      // 裝置不支援分享，或使用者取消了，改用一般下載
      downloadCsvContent(csv, filename);
    }
  };

  // 清空今日紀錄需要按兩次確認：這會把今日人頭次、總收入、應收金額全部歸零，
  // 影響範圍是整天的資料，比單一人頭的歸零更嚴重，一樣需要防呆。
  const clearLog = () => {
    if (clearLogConfirmTimeoutRef.current) {
      clearTimeout(clearLogConfirmTimeoutRef.current);
      clearLogConfirmTimeoutRef.current = null;
    }
    setClearLogConfirm((prev) => {
      if (prev) {
        setLog([]);
        return false;
      }
      clearLogConfirmTimeoutRef.current = setTimeout(() => {
        setClearLogConfirm(false);
      }, 3000);
      return true;
    });
  };

  // 找出目前存有紀錄的所有日期（不含今天，今天已經即時顯示在上面了）
  const toggleHistory = async () => {
    const willOpen = !historyOpen;
    setHistoryOpen(willOpen);
    if (willOpen && historyDays === null) {
      setHistoryLoading(true);
      try {
        const result = await storage.list(LOG_KEY_PREFIX, false);
        const keys = (result && result.keys) || [];
        const days = keys
          .map((k) => k.replace(LOG_KEY_PREFIX, ""))
          .filter((d) => d && d !== dayKey)
          .sort((a, b) => (a < b ? 1 : -1)); // 新到舊
        setHistoryDays(days);
      } catch (e) {
        setHistoryDays([]);
      }
      setHistoryLoading(false);
    }
  };

  const openHistoryDay = async (day) => {
    if (!historyDayData[day]) {
      try {
        const result = await storage.get(LOG_KEY_PREFIX + day, false);
        const parsed = result && result.value ? JSON.parse(result.value) : [];
        setHistoryDayData((prev) => ({ ...prev, [day]: parsed }));
      } catch (e) {
        setHistoryDayData((prev) => ({ ...prev, [day]: [] }));
      }
    }
    setSelectedHistoryDay((prev) => (prev === day ? null : day));
  };

  const startEditLogEntry = (entry) => {
    setEditingLogId(entry.id);
    setEditMinutesDraft(String(entry.minutes));
    setEditPriceDraft(String(entry.price));
  };

  const commitEditLogEntry = (id) => {
    const minutes = Math.max(0, parseInt(editMinutesDraft, 10) || 0);
    const price = Math.max(0, parseInt(editPriceDraft, 10) || 0);
    setLog((prev) =>
      prev.map((e) => (e.id === id ? { ...e, minutes, price, units: [] } : e))
    );
    setEditingLogId(null);
  };

  const deleteLogEntry = (id) => {
    setLog((prev) => prev.filter((e) => e.id !== id));
    setEditingLogId(null);
  };

  const startAddEntry = (slotId) => {
    setAddingEntrySlotId(slotId);
    setNewEntryMinutes("15");
    setNewEntryPrice("200");
  };

  // 補登一筆漏按計時的紀錄：人少的時候有時忘記按+15/+10，事後可以手動補上分鐘數跟金額
  const commitAddEntry = (slotId, slotName) => {
    const minutes = Math.max(0, parseInt(newEntryMinutes, 10) || 0);
    const price = Math.max(0, parseInt(newEntryPrice, 10) || 0);
    const entry = {
      id: `${slotId}-manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      slotId,
      slotName,
      minutes,
      units: [],
      price,
      time: Date.now(),
    };
    setLog((prev) => [...prev, entry]);
    setAddingEntrySlotId(null);
  };

  const addToQueue = () => {
    setQueue((prev) => [
      ...prev,
      {
        id: Date.now(),
        gender: newGender,
        color: newColor,
        note: newNote.trim(),
        assignedSlotId: newAssignedSlotId,
      },
    ]);
    setNewNote("");
    setNewAssignedSlotId(null);
  };

  const removeFromQueue = (id) => {
    setQueue((prev) => prev.filter((q) => q.id !== id));
  };

  const setAssignment = (queueId, slotId) => {
    setQueue((prev) =>
      prev.map((q) => (q.id === queueId ? { ...q, assignedSlotId: slotId } : q))
    );
  };

  const assignedSlotLabel = (slotId) => {
    const s = slots.find((s) => s.id === slotId);
    return s ? s.name : `${slotId}號`;
  };

  const isAssignedSlotOffline = (slotId) => {
    const s = slots.find((s) => s.id === slotId);
    return s ? !s.active : false;
  };

  return (
    <div className="min-h-screen font-sans" style={{ backgroundColor: C.page, color: C.text }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap');
        .font-mono-num { font-family: 'IBM Plex Mono', monospace; }
        .font-sans { font-family: 'Inter', sans-serif; }
        @keyframes pulse-urgent {
          0%, 100% { box-shadow: 0 0 0 0 rgba(220,38,38,0.45); }
          50% { box-shadow: 0 0 0 6px rgba(220,38,38,0); }
        }
        .urgent-pulse { animation: pulse-urgent 1.4s ease-in-out infinite; }
      `}</style>

      <div className="max-w-3xl lg:max-w-5xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-baseline justify-between mb-1">
          <h1 className="text-2xl font-semibold tracking-tight">林老闆專用計時器</h1>
          <span className="font-mono-num text-base" style={{ color: C.textMuted }}>
            {readyCount}/{activeSlots.length} 可接單
          </span>
        </div>
        <p className="text-base mb-4" style={{ color: C.textFaint }}>
          藍底 = 全部客滿時最快結束・紅底 = 剩不到5分鐘・按「下班」可關閉今日未上線人頭
        </p>

        {/* 今日統計條 */}
        <div
          className="flex flex-wrap items-center justify-between gap-3 mb-5 rounded-xl border px-4 py-3"
          style={{ backgroundColor: C.panelBg, borderColor: C.panelBorder }}
        >
          <div className="flex flex-wrap gap-6">
            <div>
              <div className="font-mono-num text-2xl font-semibold">{totalCount}</div>
              <div className="text-sm" style={{ color: C.textMuted }}>今日人頭次</div>
            </div>
            <div>
              <div className="font-mono-num text-2xl font-semibold">NT${totalRevenue}</div>
              <div className="text-sm" style={{ color: C.textMuted }}>總收入</div>
            </div>
            <div>
              <div className="font-mono-num text-2xl font-semibold">NT${totalOwed25}</div>
              <div className="text-sm" style={{ color: C.textMuted }}>應收金額（25%）</div>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={exportCsv}
              className="flex items-center gap-1 rounded-lg active:scale-95 transition-all px-3 py-2 text-sm font-medium"
              style={{ backgroundColor: C.chipBg, color: C.text, border: `1px solid ${C.chipBorder}` }}
            >
              <Download size={13} />
              下載CSV
            </button>
            <button
              onClick={shareTodayCsv}
              className="flex items-center gap-1 rounded-lg active:scale-95 transition-all px-3 py-2 text-sm font-medium"
              style={{ backgroundColor: C.chipBg, color: C.text, border: `1px solid ${C.chipBorder}` }}
              title="用手機/電腦的分享功能寄送或傳送 CSV"
            >
              <Share2 size={13} />
              分享/寄送
            </button>
            <button
              onClick={toggleHistory}
              className="flex items-center gap-1 rounded-lg active:scale-95 transition-all px-3 py-2 text-sm font-medium"
              style={{ backgroundColor: C.chipBg, color: C.text, border: `1px solid ${C.chipBorder}` }}
            >
              <History size={13} />
              歷史紀錄
              <ChevronDown
                size={13}
                style={{ transform: historyOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}
              />
            </button>
            <button
              onClick={clearLog}
              className="rounded-lg active:scale-95 transition-all px-3 py-2 text-sm font-medium"
              style={
                clearLogConfirm
                  ? { backgroundColor: C.urgentBg, color: C.urgentText, border: `1px solid ${C.urgentBorder}` }
                  : { backgroundColor: C.chipBg, color: C.chipText, border: `1px solid ${C.chipBorder}` }
              }
              title="清空今日紀錄（需要按兩次確認）"
            >
              {clearLogConfirm ? "確定歸零？" : "歸零"}
            </button>
          </div>
        </div>

        {/* 歷史紀錄面板 */}
        {historyOpen && (
          <div
            className="rounded-xl border p-4 mb-5"
            style={{ backgroundColor: C.panelBg, borderColor: C.panelBorder }}
          >
            {historyLoading ? (
              <p className="text-sm" style={{ color: C.textMuted }}>載入中…</p>
            ) : historyDays && historyDays.length === 0 ? (
              <p className="text-sm" style={{ color: C.textMuted }}>
                目前沒有過去的紀錄（只有今天的資料）
              </p>
            ) : (
              <div className="space-y-2">
                {(historyDays || []).map((day) => {
                  const isOpen = selectedHistoryDay === day;
                  const dayLog = historyDayData[day];
                  const summary = dayLog ? summarizeLog(dayLog) : null;
                  return (
                    <div key={day}>
                      <button
                        onClick={() => openHistoryDay(day)}
                        className="w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-base font-medium"
                        style={{ backgroundColor: C.chipBg, color: C.text, border: `1px solid ${C.chipBorder}` }}
                      >
                        <span>{day}</span>
                        <span className="flex items-center gap-2">
                          {summary && (
                            <span className="text-sm" style={{ color: C.textMuted }}>
                              {summary.totalCount}人次・NT${summary.totalRevenue}
                            </span>
                          )}
                          <ChevronDown
                            size={16}
                            style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}
                          />
                        </span>
                      </button>

                      {isOpen && summary && (
                        <div
                          className="rounded-lg px-3 py-3 mt-1"
                          style={{ backgroundColor: C.page, border: `1px solid ${C.panelBorder}` }}
                        >
                          {summary.perSlot.length === 0 ? (
                            <p className="text-sm" style={{ color: C.textFaint }}>這天沒有紀錄</p>
                          ) : (
                            <div className="space-y-1.5 mb-3">
                              {summary.perSlot.map((s) => (
                                <div key={s.name} className="flex items-center justify-between text-sm">
                                  <span style={{ color: C.text }}>{s.name}</span>
                                  <span style={{ color: C.textMuted }}>
                                    {s.count} 人次・NT${s.revenue}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="flex gap-2">
                            <button
                              onClick={() => downloadCsvContent(buildCsvContent(dayLog), `來客登記表_${day}.csv`)}
                              className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium"
                              style={{ backgroundColor: C.chipBg, color: C.text, border: `1px solid ${C.chipBorder}` }}
                            >
                              <Download size={12} />
                              下載CSV
                            </button>
                            <button
                              onClick={async () => {
                                const csv = buildCsvContent(dayLog);
                                const filename = `來客登記表_${day}.csv`;
                                const shared = await shareCsvContent(csv, filename);
                                if (!shared) downloadCsvContent(csv, filename);
                              }}
                              className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium"
                              style={{ backgroundColor: C.chipBg, color: C.text, border: `1px solid ${C.chipBorder}` }}
                            >
                              <Share2 size={12} />
                              分享/寄送
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 排序切換 + 一鍵全下班 */}
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm" style={{ color: C.textMuted }}>排序：</span>
            {[
              { key: "activation", label: "上班順序" },
              { key: "finish", label: "結束順序" },
            ].map((opt) => {
              const selected = sortMode === opt.key;
              return (
                <button
                  key={opt.key}
                  onClick={() => setSortMode(opt.key)}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium"
                  style={
                    selected
                      ? { backgroundColor: C.assign, color: C.assignText }
                      : { backgroundColor: C.chipBg, color: C.chipText, border: `1px solid ${C.chipBorder}` }
                  }
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {onlineSlots.length > 0 && (
            <button
              onClick={handleClockOutAllClick}
              className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap"
              style={
                clockOutAllConfirm
                  ? { backgroundColor: C.urgentBg, color: C.urgentText, border: `1px solid ${C.urgentBorder}` }
                  : { backgroundColor: C.chipBg, color: C.chipText, border: `1px solid ${C.chipBorder}` }
              }
              title="把目前所有上線中的人頭一次下班（需要按兩次確認）"
            >
              <Moon size={13} />
              {clockOutAllConfirm ? "確定全部下班？" : "一鍵全下班"}
            </button>
          )}
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          {sortedOnlineSlots.map((slot) => {
            const remaining = slot.readyAt ? slot.readyAt - now : 0;
            const isReady = remaining <= 0;
            const isUrgent = !isReady && remaining <= URGENT_MS;
            const finishRank = finishRankMap[slot.id]; // 只有「全部都在計時、沒有空位」時才會有值
            const isSoonest = finishRank === 1;

            let bgColor = C.normalBg;
            let borderColor = C.normalBorder;
            let dotColorHex = C.normalDot;
            let textColorHex = C.normalText;

            if (isReady) {
              bgColor = C.readyBg;
              borderColor = C.readyBorder;
              dotColorHex = C.readyDot;
              textColorHex = C.readyText;
            } else if (isSoonest) {
              bgColor = C.soonestBg;
              borderColor = C.soonestBorder;
              dotColorHex = C.soonestDot;
              textColorHex = C.soonestText;
            } else if (isUrgent) {
              bgColor = C.urgentBg;
              borderColor = C.urgentBorder;
              dotColorHex = C.urgentDot;
              textColorHex = C.urgentText;
            }

            if (isSoonest && isUrgent) {
              textColorHex = C.urgentText;
            }

            const assignedCustomer = queue.find((q) => q.assignedSlotId === slot.id);
            const slotLog = log.filter((e) => e.slotId === slot.id);
            const slotCount = slotLog.length;
            const isExpanded = expandedIds.has(slot.id);
            const minutesRemaining = isReady ? 0 : Math.floor(remaining / 60000);
            const secondsRemaining = isReady ? 0 : Math.floor((remaining % 60000) / 1000);
            const statusLabel = isReady
              ? "可接單"
              : assignedCustomer
              ? `${assignedCustomer.gender}客人${assignedCustomer.note ? "・" + assignedCustomer.note : ""}`
              : "服務中";
            const activationRank = activationRankMap[slot.id];

            return (
              <div
                key={slot.id}
                className={`relative rounded-2xl border transition-colors duration-300 ${
                  isUrgent ? "urgent-pulse" : ""
                }`}
                style={{ backgroundColor: bgColor, borderColor: borderColor }}
              >
                {sortMode === "activation" && activationRank && (
                  <div
                    className="absolute -top-2 -right-2 flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
                    style={{
                      backgroundColor: C.chipBg,
                      color: C.chipText,
                      border: `1px solid ${C.chipBorder}`,
                    }}
                  >
                    {ordinalWorkLabel(activationRank)}
                  </div>
                )}
                {sortMode === "finish" && finishRank && (
                  <div
                    className="absolute -top-2 -right-2 flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
                    style={
                      isSoonest
                        ? {
                            backgroundColor: C.soonestBadgeBg,
                            color: C.soonestBadgeText,
                            boxShadow: "0 0 8px rgba(143,208,255,0.7)",
                          }
                        : {
                            backgroundColor: C.chipBg,
                            color: C.chipText,
                            border: `1px solid ${C.chipBorder}`,
                          }
                    }
                  >
                    {isSoonest && <Zap size={10} strokeWidth={3} />}
                    {ordinalLabel(finishRank)}
                  </div>
                )}

                {/* 精簡橫列：一眼看剩餘分鐘，點一下展開完整操作 */}
                <div
                  onClick={() => toggleExpand(slot.id)}
                  className="px-5 py-4 flex items-center gap-4 cursor-pointer"
                >
                  <span
                    className="w-11 h-11 rounded-full flex-shrink-0 flex items-center justify-center text-lg font-bold"
                    style={{ backgroundColor: dotColorHex, color: "#FFFFFF" }}
                  >
                    {Array.from(slot.name || "")[0] || ""}
                  </span>

                  <div className="flex-1 min-w-0">
                    <div
                      className="text-xl font-semibold truncate"
                      style={{ color: C.text }}
                      title="上線中無法改名，下班後才能修改"
                    >
                      {slot.name}
                    </div>
                    {assignedCustomer ? (
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span
                          className="w-3.5 h-3.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: assignedCustomer.color }}
                        />
                        <span
                          className="text-xs font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                          style={{
                            backgroundColor: assignedCustomer.gender === "女" ? C.female : C.male,
                            color: assignedCustomer.gender === "女" ? C.femaleText : C.maleText,
                          }}
                        >
                          {assignedCustomer.gender}
                        </span>
                        <span className="text-sm font-medium truncate" style={{ color: C.textMuted }}>
                          {assignedCustomer.note || "服務中"}
                        </span>
                      </div>
                    ) : (
                      <div className="text-sm truncate" style={{ color: C.textMuted }}>
                        {statusLabel}
                      </div>
                    )}
                  </div>

                  <div className="flex items-baseline flex-shrink-0">
                    {isReady ? (
                      <span className="text-2xl font-bold" style={{ color: C.readyText }}>
                        可接單
                      </span>
                    ) : (
                      <>
                        <span
                          className="font-mono-num text-4xl font-bold tabular-nums"
                          style={{ color: textColorHex }}
                        >
                          {minutesRemaining}
                        </span>
                        <span
                          className="font-mono-num text-base ml-0.5 tabular-nums"
                          style={{ color: textColorHex, opacity: 0.7 }}
                        >
                          :{String(secondsRemaining).padStart(2, "0")}
                        </span>
                      </>
                    )}
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleClockOutClick(slot.id);
                    }}
                    className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap flex-shrink-0"
                    style={
                      clockOutConfirmId === slot.id
                        ? { backgroundColor: C.urgentBg, color: C.urgentText, border: `1px solid ${C.urgentBorder}` }
                        : { backgroundColor: C.clockOutBg, color: C.clockOutText }
                    }
                    title="下班（今日未上線，需要按兩次確認）"
                  >
                    <Moon size={13} />
                    {clockOutConfirmId === slot.id ? "確定下班？" : "下班"}
                  </button>
                </div>

                {/* 展開後的完整操作面板：跟上面橫列共用同一個外框，只用分隔線區隔 */}
                {isExpanded && (
                  <div
                    className="px-6 pb-6 pt-4 flex flex-col gap-4"
                    style={{ borderTop: `1px solid ${borderColor}` }}
                  >
                    <span
                      className="text-sm font-semibold px-2 py-1 rounded-full whitespace-nowrap self-start"
                      style={{ backgroundColor: C.panelBg, color: C.textMuted }}
                      title="今日這個人頭已完成的人數"
                    >
                      今日已完成 {slotCount} 人
                    </span>

                    {assignedCustomer && (
                      <div
                        className="flex items-center gap-2 rounded-lg px-3 py-2"
                        style={{ backgroundColor: C.assign }}
                      >
                        <span
                          className="w-3.5 h-3.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: assignedCustomer.color }}
                        />
                        <span
                          className="text-sm font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0"
                          style={{
                            backgroundColor: assignedCustomer.gender === "女" ? C.female : C.male,
                            color: assignedCustomer.gender === "女" ? C.femaleText : C.maleText,
                          }}
                        >
                          {assignedCustomer.gender}
                        </span>
                        <span className="text-base truncate" style={{ color: C.assignText }}>
                          {assignedCustomer.note || "已指定顧客"}
                        </span>
                      </div>
                    )}

                    {/* 倒數顯示 */}
                    <div className="flex flex-col">
                      {isReady ? (
                        <span
                          className="font-mono-num text-5xl font-semibold"
                          style={{ color: C.readyText }}
                        >
                          可接單
                        </span>
                      ) : (
                        <>
                          <span
                            className="font-mono-num text-6xl font-semibold tabular-nums"
                            style={{ color: textColorHex }}
                          >
                            {formatRemaining(remaining)}
                          </span>
                          <span className="text-xl mt-1" style={{ color: C.textMuted }}>
                            累積 {slot.cycleMinutes} 分鐘・NT${calcPrice(slot.unitHistory)}・
                            {formatClockTime(slot.readyAt)} 結束
                          </span>
                        </>
                      )}
                    </div>

                    {/* 操作 */}
                    <div className="grid grid-cols-2 gap-3 mt-auto">
                      <button
                        onClick={() => {
                          addMinutes(slot.id, 15);
                          scheduleAutoCollapse();
                        }}
                        className="flex items-center justify-center gap-2 rounded-lg active:scale-95 transition-all py-4 text-xl font-semibold whitespace-nowrap"
                        style={{ backgroundColor: C.chipBg, color: C.text, border: `1px solid ${C.chipBorder}` }}
                      >
                        <Plus size={20} />
                        15分鐘
                      </button>
                      <button
                        onClick={() => {
                          addMinutes(slot.id, 10);
                          scheduleAutoCollapse();
                        }}
                        className="flex items-center justify-center gap-2 rounded-lg active:scale-95 transition-all py-4 text-xl font-semibold whitespace-nowrap"
                        style={{ backgroundColor: C.chipBg, color: C.text, border: `1px solid ${C.chipBorder}` }}
                      >
                        <Plus size={20} />
                        10分鐘
                      </button>
                      {!isReady && (
                        <div className="col-span-2 flex gap-3">
                          <button
                            onClick={() => {
                              undoUnit(slot.id);
                              scheduleAutoCollapse();
                            }}
                            className="rounded-lg active:scale-95 transition-all py-3 text-lg font-medium whitespace-nowrap"
                            style={{
                              flex: 2,
                              backgroundColor: C.chipBg,
                              color: C.text,
                              border: `1px solid ${C.chipBorder}`,
                            }}
                            title="退回最後一次按的單位"
                          >
                            上一步
                          </button>
                          <button
                            onClick={() => {
                              handleResetClick(slot.id);
                              scheduleAutoCollapse();
                            }}
                            className="rounded-lg active:scale-95 transition-all py-3 text-sm font-medium whitespace-nowrap"
                            style={
                              resetConfirmId === slot.id
                                ? {
                                    flex: 1,
                                    backgroundColor: C.urgentBg,
                                    color: C.urgentText,
                                    border: `1px solid ${C.urgentBorder}`,
                                  }
                                : {
                                    flex: 1,
                                    backgroundColor: C.page,
                                    color: C.textFaint,
                                    border: `1px solid ${C.panelBorder}`,
                                  }
                            }
                            title="重置為可接單（需要按兩次確認）"
                          >
                            {resetConfirmId === slot.id ? "確定歸零？" : "歸零"}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {onlineSlots.length === 0 && (
          <p className="text-base text-center py-6 -mt-4 mb-4" style={{ color: C.textMuted }}>
            目前沒有上線中的人頭
          </p>
        )}

        {/* 顧客等待名單 */}
        <div>
          <h2 className="text-lg font-semibold mb-1">顧客等待名單</h2>
          <p className="text-base mb-3" style={{ color: C.textFaint }}>
            依加入順序排列，最上面就是下一位
          </p>

          {/* 新增表單 */}
          <div
            className="rounded-xl border p-3 mb-3 space-y-3"
            style={{ backgroundColor: C.panelBg, borderColor: C.panelBorder }}
          >
            <div className="flex gap-2">
              {["女", "男"].map((g) => {
                const selected = newGender === g;
                const activeColor = g === "女" ? C.female : C.male;
                const activeText = g === "女" ? C.femaleText : C.maleText;
                return (
                  <button
                    key={g}
                    onClick={() => setNewGender(g)}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-base font-semibold border-2 transition-all duration-150"
                    style={{
                      backgroundColor: selected ? activeColor : C.chipBg,
                      color: selected ? activeText : C.chipText,
                      borderColor: selected ? "rgba(255,255,255,0.35)" : C.chipBorder,
                      transform: selected ? "scale(1.04)" : "scale(1)",
                      boxShadow: selected
                        ? g === "女"
                          ? "0 0 0 3px rgba(232,111,160,0.3)"
                          : "0 0 0 3px rgba(77,166,255,0.3)"
                        : "none",
                    }}
                  >
                    {selected && <Check size={15} strokeWidth={3} />}
                    {g}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-2">
              {COLOR_SWATCHES.map((c) => (
                <button
                  key={c.hex}
                  onClick={() => setNewColor(c.hex)}
                  className="flex flex-col items-center gap-1"
                  title={c.name}
                >
                  <span
                    className="w-7 h-7 rounded-full flex items-center justify-center"
                    style={{
                      backgroundColor: c.hex,
                      boxShadow:
                        newColor === c.hex
                          ? `0 0 0 2px ${C.panelBg}, 0 0 0 4px #2563EB`
                          : "0 0 0 1px rgba(0,0,0,0.12)",
                    }}
                  >
                    {newColor === c.hex && (
                      <Check size={13} color={c.hex === "#EDEAE3" || c.hex === "#E8D23D" ? "#1A1D23" : "#fff"} />
                    )}
                  </span>
                </button>
              ))}
            </div>

            <input
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="備註（選填，例如：長髮、戴眼鏡）"
              className="w-full rounded-lg px-3 py-2 text-base outline-none border"
              style={{ backgroundColor: C.inputBg, borderColor: C.panelBorder, color: C.text }}
            />

            <div>
              <div className="text-sm mb-1.5" style={{ color: C.textMuted }}>指定人頭（選填）</div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setNewAssignedSlotId(null)}
                  className="rounded-lg px-2.5 py-1.5 text-sm font-medium border-2 transition-all"
                  style={
                    newAssignedSlotId === null
                      ? { backgroundColor: C.assign, color: C.assignText, borderColor: "#E3CFFF" }
                      : { backgroundColor: C.chipBg, color: C.chipText, borderColor: C.chipBorder }
                  }
                >
                  不指定
                </button>
                {slots.map((s) => {
                  const picked = newAssignedSlotId === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => setNewAssignedSlotId(s.id)}
                      className="rounded-lg px-2.5 py-1.5 text-sm font-medium border-2 transition-all"
                      style={{
                        ...(picked
                          ? { backgroundColor: C.assign, color: C.assignText, borderColor: "#E3CFFF" }
                          : { backgroundColor: C.chipBg, color: C.chipText, borderColor: C.chipBorder }),
                        opacity: s.active ? 1 : 0.55,
                      }}
                    >
                      {s.name}
                      {!s.active && "（未上線）"}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              onClick={addToQueue}
              className="w-full flex items-center justify-center gap-1 rounded-lg active:scale-95 transition-all py-2 text-base font-medium"
              style={{ backgroundColor: C.chipBg, color: C.text, border: `1px solid ${C.chipBorder}` }}
            >
              <UserPlus size={14} />
              加入名單
            </button>
          </div>

          {/* 名單列表 */}
          {queue.length === 0 ? (
            <p className="text-base text-center py-6" style={{ color: C.textMuted }}>
              目前沒有等待中的顧客
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {queue.map((q, idx) => (
                <div
                  key={q.id}
                  className="flex items-center gap-3 rounded-xl border p-3"
                  style={{
                    backgroundColor: idx === 0 ? C.soonestBg : C.panelBg,
                    borderColor: idx === 0 ? C.soonestBorder : C.panelBorder,
                  }}
                >
                  <span
                    className="font-mono-num text-base w-5 flex-shrink-0"
                    style={{ color: idx === 0 ? C.soonestText : C.textMuted }}
                  >
                    {idx + 1}
                  </span>
                  <span
                    className="w-6 h-6 rounded-full flex-shrink-0"
                    style={{ backgroundColor: q.color }}
                  />
                  <span
                    className="text-sm font-medium px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{
                      backgroundColor: q.gender === "女" ? C.female : C.male,
                      color: q.gender === "女" ? C.femaleText : C.maleText,
                    }}
                  >
                    {q.gender}
                  </span>
                  {q.assignedSlotId && (
                    <button
                      onClick={() => setAssignment(q.id, null)}
                      className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                      style={
                        isAssignedSlotOffline(q.assignedSlotId)
                          ? { backgroundColor: C.offlineBg, color: C.offlineText, border: `1px solid ${C.offlineBorder}` }
                          : { backgroundColor: C.assign, color: C.assignText }
                      }
                      title="點一下取消指定"
                    >
                      指定 {assignedSlotLabel(q.assignedSlotId)}
                      {isAssignedSlotOffline(q.assignedSlotId) && "（未上線）"}
                    </button>
                  )}
                  <span
                    className="text-base truncate flex-1"
                    style={{ color: idx === 0 ? C.soonestText : C.text }}
                  >
                    {q.note || "（無備註）"}
                  </span>
                  {idx === 0 && (
                    <span
                      className="text-xs font-semibold flex-shrink-0"
                      style={{ color: C.soonestText }}
                    >
                      下一位
                    </span>
                  )}
                  <button
                    onClick={() => removeFromQueue(q.id)}
                    className="flex-shrink-0"
                    style={{ color: idx === 0 ? "#CFE7FF" : C.textMuted }}
                    title="移除"
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 每個編號今日累積接待人數總覽 */}
        <div
          className="rounded-xl border p-5 mt-8"
          style={{ backgroundColor: C.panelBg, borderColor: C.panelBorder }}
        >
          <h2 className="text-lg font-semibold mb-4">各編號今日接待人數</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {perSlotStats.filter((stat) => stat.active).map((stat) => (
              <div
                key={stat.id}
                className="rounded-lg p-4"
                style={{
                  backgroundColor: stat.active ? C.chipBg : C.offlineBg,
                  border: `1px solid ${stat.active ? C.chipBorder : C.offlineBorder}`,
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span
                    className="text-lg font-semibold"
                    style={{ color: stat.active ? C.text : C.offlineText }}
                  >
                    {stat.name}
                    {!stat.active && (
                      <span className="text-sm font-normal ml-2" style={{ color: C.offlineDot }}>
                        （未上線）
                      </span>
                    )}
                  </span>
                  <span
                    className="text-base font-semibold"
                    style={{ color: stat.active ? C.text : C.offlineDot }}
                  >
                    今日已收 {stat.totalRevenue} 元
                  </span>
                </div>

                {stat.totalRevenue > 0 && (
                  <div className="mb-2 text-right">
                    <p className="text-sm font-medium" style={{ color: C.text }}>
                      25%：NT${stat.share25}
                    </p>
                    <p className="text-sm font-medium" style={{ color: C.text }}>
                      75%：NT${stat.share75}
                    </p>
                  </div>
                )}

                {stat.entries.length === 0 ? (
                  <p className="text-sm mb-2" style={{ color: C.textFaint }}>今日尚無紀錄</p>
                ) : (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {stat.entries.map((entry) =>
                      editingLogId === entry.id ? (
                        <div
                          key={entry.id}
                          className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg"
                          style={{ backgroundColor: C.page, border: `1px solid ${C.assign}` }}
                        >
                          <select
                            value={editMinutesDraft}
                            onChange={(e) => {
                              const val = e.target.value;
                              setEditMinutesDraft(val);
                              const estimated = estimatePriceForMinutes(parseInt(val, 10));
                              if (estimated != null) setEditPriceDraft(String(estimated));
                            }}
                            className="text-sm rounded px-1.5 py-1 outline-none"
                            style={{ backgroundColor: C.panelBg, color: C.text, border: `1px solid ${C.panelBorder}` }}
                          >
                            {(MINUTE_PRESET_OPTIONS.includes(parseInt(editMinutesDraft, 10))
                              ? MINUTE_PRESET_OPTIONS
                              : [parseInt(editMinutesDraft, 10) || 0, ...MINUTE_PRESET_OPTIONS].sort((a, b) => a - b)
                            ).map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                          <span className="text-sm" style={{ color: C.textMuted }}>分・NT$</span>
                          <input
                            type="number"
                            value={editPriceDraft}
                            onChange={(e) => setEditPriceDraft(e.target.value)}
                            className="w-16 text-sm rounded px-1.5 py-1 outline-none"
                            style={{ backgroundColor: C.panelBg, color: C.text, border: `1px solid ${C.panelBorder}` }}
                          />
                          <button
                            onClick={() => commitEditLogEntry(entry.id)}
                            className="rounded px-2 py-1 text-sm font-semibold"
                            style={{ backgroundColor: C.assign, color: C.assignText }}
                          >
                            存
                          </button>
                          <button
                            onClick={() => deleteLogEntry(entry.id)}
                            className="rounded px-2 py-1 text-sm"
                            style={{ backgroundColor: C.urgentBg, color: C.urgentText }}
                          >
                            刪
                          </button>
                        </div>
                      ) : (
                        <button
                          key={entry.id}
                          onClick={() => startEditLogEntry(entry)}
                          className="text-base font-medium px-3 py-1.5 rounded-lg whitespace-nowrap"
                          style={{
                            backgroundColor: C.page,
                            color: C.text,
                            border: `1px solid ${C.panelBorder}`,
                          }}
                          title="點一下可以修改分鐘數或金額"
                        >
                          {entry.minutes}分鐘・NT${entry.price}
                        </button>
                      )
                    )}
                  </div>
                )}

                {addingEntrySlotId === stat.id ? (
                  <div
                    className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg"
                    style={{ backgroundColor: C.page, border: `1px solid ${C.assign}` }}
                  >
                    <select
                      value={newEntryMinutes}
                      onChange={(e) => {
                        const val = e.target.value;
                        setNewEntryMinutes(val);
                        const estimated = estimatePriceForMinutes(parseInt(val, 10));
                        if (estimated != null) setNewEntryPrice(String(estimated));
                      }}
                      className="text-sm rounded px-1.5 py-1 outline-none"
                      style={{ backgroundColor: C.panelBg, color: C.text, border: `1px solid ${C.panelBorder}` }}
                    >
                      {MINUTE_PRESET_OPTIONS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <span className="text-sm" style={{ color: C.textMuted }}>分・NT$</span>
                    <input
                      type="number"
                      value={newEntryPrice}
                      onChange={(e) => setNewEntryPrice(e.target.value)}
                      className="w-16 text-sm rounded px-1.5 py-1 outline-none"
                      style={{ backgroundColor: C.panelBg, color: C.text, border: `1px solid ${C.panelBorder}` }}
                    />
                    <button
                      onClick={() => commitAddEntry(stat.id, stat.name)}
                      className="rounded px-2 py-1 text-sm font-semibold"
                      style={{ backgroundColor: C.assign, color: C.assignText }}
                    >
                      新增
                    </button>
                    <button
                      onClick={() => setAddingEntrySlotId(null)}
                      className="rounded px-2 py-1 text-sm"
                      style={{ backgroundColor: C.chipBg, color: C.chipText }}
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => startAddEntry(stat.id)}
                    className="flex items-center gap-1 text-sm font-medium px-2.5 py-1 rounded-lg"
                    style={{ backgroundColor: C.page, color: C.textMuted, border: `1px dashed ${C.panelBorder}` }}
                    title="漏按計時的話，可以在這裡手動補一筆"
                  >
                    <Plus size={12} />
                    補登一筆
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 未上線人頭：固定沉在最底部 */}
        {offlineSlots.length > 0 && (
          <div className="mt-8">
            <h2 className="text-lg font-semibold mb-1" style={{ color: C.offlineText }}>
              未上線人頭 ({offlineSlots.length})
            </h2>
            <p className="text-base mb-3" style={{ color: C.textMuted }}>
              不小心關到還在跑的人頭？按「復原計時」馬上接回原本的倒數
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {offlineSlots.map((slot) => {
                const slotLog = log.filter((e) => e.slotId === slot.id);
                const assignedCustomer = queue.find((q) => q.assignedSlotId === slot.id);
                return (
                <div
                  key={slot.id}
                  className="flex items-center gap-3 rounded-xl border p-3"
                  style={{ backgroundColor: C.offlineBg, borderColor: C.offlineBorder }}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: C.offlineDot }}
                  />
                  <div className="flex-1 min-w-0 flex items-center gap-1.5">
                    {editingId === slot.id ? (
                      <input
                        autoFocus
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        onBlur={() => commitEdit(slot.id)}
                        onKeyDown={(e) => e.key === "Enter" && commitEdit(slot.id)}
                        className="bg-transparent border-b text-base font-medium w-24 outline-none"
                        style={{ color: C.offlineText, borderColor: C.textFaint }}
                      />
                    ) : (
                      <button
                        onClick={() => startEdit(slot)}
                        className="text-base font-medium truncate flex items-center gap-1.5"
                        style={{ color: C.offlineText }}
                        title="下班中可以改名"
                      >
                        {slot.name}
                        <Pencil size={12} style={{ opacity: 0.4 }} className="flex-shrink-0" />
                      </button>
                    )}
                    {slotLog.length > 0 && (
                      <span className="text-sm flex-shrink-0" style={{ color: C.textFaint }}>
                        （今日 {slotLog.length} 人）
                      </span>
                    )}
                  </div>
                  {assignedCustomer && (
                    <span
                      className="text-xs font-medium px-2 py-1 rounded-full flex-shrink-0 whitespace-nowrap"
                      style={{ backgroundColor: C.chipBg, color: C.chipText, border: `1px solid ${C.chipBorder}` }}
                      title="這個人頭還有顧客指定給他，記得上線後處理"
                    >
                      有顧客等待
                    </span>
                  )}
                  {slot.savedRemainingMs ? (
                    <button
                      onClick={() => restoreSlot(slot.id)}
                      className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-semibold whitespace-nowrap"
                      style={{ backgroundColor: C.soonestBg, color: C.soonestText }}
                      title="接回原本的倒數"
                    >
                      <Undo2 size={12} />
                      復原 {formatRemaining(slot.savedRemainingMs)}（約{formatClockTime(now + slot.savedRemainingMs)}結束）
                    </button>
                  ) : (
                    <button
                      onClick={() => handleClockIn(slot.id)}
                      className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium"
                      style={{ backgroundColor: C.clockInBg, color: C.clockInText }}
                    >
                      <Sun size={13} />
                      上班
                    </button>
                  )}
                </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
