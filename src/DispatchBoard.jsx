import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Plus,
  Pencil,
  Check,
  Download,
  Zap,
  Power,
  X,
  UserPlus,
  Undo2,
} from "lucide-react";

// 這個 App 原本是在 Claude Artifact 環境裡用 window.storage 存資料，
// 部署到 Vercel 後改用瀏覽器的 localStorage 達到一樣的「重新整理資料還在」效果。
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
};

const UNIT_MS = 10 * 60 * 1000; // 10 分鐘
const URGENT_MS = 5 * 60 * 1000; // 5 分鐘內 = 緊急
const SLOT_COUNT = 10;
const SLOTS_KEY = "dispatch-board:slots";
const LOG_KEY_PREFIX = "dispatch-board:log:"; // + 日期 yyyy-mm-dd
const QUEUE_KEY = "dispatch-board:queue";

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
    active: true, // 是否今日上線接單
    savedRemainingMs: null, // 不小心關台時，暫存當下還剩多少毫秒
    savedCycleMinutes: 0,
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
  const loadedRef = useRef(false);
  const dayKey = useMemo(() => todayKey(), []);

  useEffect(() => {
    (async () => {
      try {
        const result = await storage.get(SLOTS_KEY, false);
        if (result && result.value) {
          const parsed = JSON.parse(result.value);
          if (Array.isArray(parsed) && parsed.length === SLOT_COUNT) {
            setSlots(
              parsed.map((s) => ({
                cycleMinutes: 0,
                active: true,
                savedRemainingMs: null,
                savedCycleMinutes: 0,
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
          if (s.readyAt && s.readyAt <= t && s.cycleMinutes > 0) {
            completions.push({
              slotId: s.id,
              slotName: s.name,
              minutes: s.cycleMinutes,
              time: s.readyAt,
            });
            return { ...s, cycleMinutes: 0 };
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

  const addUnit = useCallback((id) => {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== id || !s.active) return s;
        const isCurrentlyReady = !s.readyAt || s.readyAt <= Date.now();
        const base = isCurrentlyReady ? Date.now() : s.readyAt;
        return {
          ...s,
          readyAt: base + UNIT_MS,
          cycleMinutes: (isCurrentlyReady ? 0 : s.cycleMinutes) + 10,
        };
      })
    );
  }, []);

  const resetSlot = useCallback((id) => {
    setSlots((prev) =>
      prev.map((s) => (s.id === id ? { ...s, readyAt: null, cycleMinutes: 0 } : s))
    );
  }, []);

  const undoUnit = useCallback((id) => {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== id || !s.active || s.cycleMinutes <= 0 || !s.readyAt) return s;
        const newCycleMinutes = s.cycleMinutes - 10;
        if (newCycleMinutes <= 0) {
          return { ...s, readyAt: null, cycleMinutes: 0 };
        }
        return { ...s, readyAt: s.readyAt - UNIT_MS, cycleMinutes: newCycleMinutes };
      })
    );
  }, []);

  const toggleActive = useCallback((id) => {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        if (s.active) {
          // 關台：如果當下正在冷卻中，先暫存剩餘時間，之後可以馬上復原
          const remaining = s.readyAt ? s.readyAt - Date.now() : 0;
          const hasRunningTimer = remaining > 0;
          return {
            ...s,
            active: false,
            readyAt: null,
            cycleMinutes: 0,
            savedRemainingMs: hasRunningTimer ? remaining : null,
            savedCycleMinutes: hasRunningTimer ? s.cycleMinutes : 0,
          };
        }
        // 一般開台（非復原）：從「可接單」重新開始，不動用暫存的計時
        return { ...s, active: true };
      })
    );
  }, []);

  const restoreSlot = useCallback((id) => {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== id || !s.savedRemainingMs) return s;
        return {
          ...s,
          active: true,
          readyAt: Date.now() + s.savedRemainingMs,
          cycleMinutes: s.savedCycleMinutes,
          savedRemainingMs: null,
          savedCycleMinutes: 0,
        };
      })
    );
  }, []);

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

  const soonestId = useMemo(() => {
    let best = null;
    let bestRemaining = Infinity;
    slots.forEach((s) => {
      if (s.active && s.readyAt && s.readyAt > now) {
        const remaining = s.readyAt - now;
        if (remaining < bestRemaining) {
          bestRemaining = remaining;
          best = s.id;
        }
      }
    });
    return best;
  }, [slots, now]);

  // 上線中的人頭顯示在主看板；未上線的沉到頁面最底部（顧客名單下方）
  const onlineSlots = useMemo(() => slots.filter((s) => s.active), [slots]);
  const offlineSlots = useMemo(() => slots.filter((s) => !s.active), [slots]);

  const totalCount = log.length;
  const totalMinutes = log.reduce((sum, e) => sum + e.minutes, 0);
  const totalHoursWhole = Math.floor(totalMinutes / 60);
  const totalMinsRemainder = totalMinutes % 60;
  const totalTimeLabel =
    totalHoursWhole > 0 && totalMinsRemainder > 0
      ? `${totalHoursWhole}小時${totalMinsRemainder}分鐘`
      : totalHoursWhole > 0
      ? `${totalHoursWhole}小時`
      : `${totalMinsRemainder}分鐘`;

  // 每個編號今日各自累積的人數與分鐘數（用來給統一總覽區塊顯示）
  const perSlotStats = useMemo(() => {
    return slots.map((s) => {
      const entries = log.filter((e) => e.slotId === s.id);
      return {
        id: s.id,
        name: s.name,
        active: s.active,
        count: entries.length,
        minutes: entries.reduce((sum, e) => sum + e.minutes, 0),
      };
    });
  }, [slots, log]);

  const exportCsv = () => {
    const header = "人頭,分鐘數,完成時間\n";
    const rows = log
      .map((e) => {
        const t = new Date(e.time);
        const ts = `${String(t.getHours()).padStart(2, "0")}:${String(
          t.getMinutes()
        ).padStart(2, "0")}:${String(t.getSeconds()).padStart(2, "0")}`;
        return `${e.slotName},${e.minutes},${ts}`;
      })
      .join("\n");
    const summary = `\n總計,人頭次,${totalCount}\n總計,時數,${totalTimeLabel}`;
    const csv = "\uFEFF" + header + rows + summary;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `接單紀錄_${dayKey}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const clearLog = () => setLog([]);

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

      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-baseline justify-between mb-1">
          <h1 className="text-2xl font-semibold tracking-tight">林老闆專用計時器</h1>
          <span className="font-mono-num text-base" style={{ color: C.textMuted }}>
            {readyCount}/{activeSlots.length} 可接單
          </span>
        </div>
        <p className="text-base mb-4" style={{ color: C.textFaint }}>
          藍底 = 最快恢復・紅底 = 剩不到5分鐘・電源鍵可關閉今日未上線人頭
        </p>

        {/* 今日統計條 */}
        <div
          className="flex items-center justify-between mb-5 rounded-xl border px-4 py-3"
          style={{ backgroundColor: C.panelBg, borderColor: C.panelBorder }}
        >
          <div className="flex gap-6">
            <div>
              <div className="font-mono-num text-2xl font-semibold">{totalCount}</div>
              <div className="text-sm" style={{ color: C.textMuted }}>今日人頭次</div>
            </div>
            <div>
              <div className="font-mono-num text-2xl font-semibold">{totalTimeLabel}</div>
              <div className="text-sm" style={{ color: C.textMuted }}>今日時數</div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={exportCsv}
              className="flex items-center gap-1 rounded-lg active:scale-95 transition-all px-3 py-2 text-sm font-medium"
              style={{ backgroundColor: C.chipBg, color: C.text, border: `1px solid ${C.chipBorder}` }}
            >
              <Download size={13} />
              匯出CSV
            </button>
            <button
              onClick={clearLog}
              className="rounded-lg active:scale-95 transition-all px-3 py-2 text-sm font-medium"
              style={{ backgroundColor: C.chipBg, color: C.chipText, border: `1px solid ${C.chipBorder}` }}
              title="清空今日紀錄"
            >
              歸零
            </button>
          </div>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 gap-4 mb-8">
          {onlineSlots.map((slot) => {
            const remaining = slot.readyAt ? slot.readyAt - now : 0;
            const isReady = remaining <= 0;
            const isUrgent = !isReady && remaining <= URGENT_MS;
            const isSoonest = !isReady && slot.id === soonestId;
            const stackedUnits = isReady ? 0 : Math.ceil(remaining / UNIT_MS);

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
            const slotMinutes = slotLog.reduce((sum, e) => sum + e.minutes, 0);

            return (
              <div
                key={slot.id}
                className={`relative rounded-2xl border p-6 flex flex-col gap-4 transition-colors duration-300 ${
                  isUrgent ? "urgent-pulse" : ""
                }`}
                style={{ backgroundColor: bgColor, borderColor: borderColor }}
              >
                {isSoonest && (
                  <div
                    className="absolute -top-2 -right-2 flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: C.soonestBadgeBg,
                      color: C.soonestBadgeText,
                      boxShadow: "0 0 8px rgba(143,208,255,0.7)",
                    }}
                  >
                    <Zap size={10} strokeWidth={3} />
                    最快
                  </div>
                )}

                {/* 狀態燈 + 名稱 + 上線開關 */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="w-4 h-4 rounded-full flex-shrink-0"
                      style={{ backgroundColor: dotColorHex }}
                    />
                    {editingId === slot.id ? (
                      <input
                        autoFocus
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        onBlur={() => commitEdit(slot.id)}
                        onKeyDown={(e) => e.key === "Enter" && commitEdit(slot.id)}
                        className="bg-transparent border-b text-xl font-medium w-24 outline-none"
                        style={{ color: C.text, borderColor: C.textMuted }}
                      />
                    ) : (
                      <button
                        onClick={() => startEdit(slot)}
                        className="text-xl font-medium truncate flex items-center gap-1.5 group"
                        style={{ color: C.text }}
                      >
                        {slot.name}
                        <Pencil size={14} className="opacity-0 group-hover:opacity-40 flex-shrink-0" />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span
                      className="text-sm font-semibold px-2 py-1 rounded-full whitespace-nowrap"
                      style={{ backgroundColor: C.panelBg, color: C.textMuted }}
                      title="今日這個人頭已完成的人數・分鐘數"
                    >
                      今日已完成 {slotCount} 人・{slotMinutes} 分
                    </span>
                    <button
                      onClick={() => toggleActive(slot.id)}
                      className="p-1.5 rounded-md"
                      style={{ color: C.textMuted }}
                      title="關閉此人頭（今日未上線）"
                    >
                      <Power size={18} />
                    </button>
                  </div>
                </div>

                {assignedCustomer && (
                  <div
                    className="flex items-center gap-2 -mt-1 rounded-lg px-3 py-2"
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
                        疊加 {stackedUnits} 個單位・{formatClockTime(slot.readyAt)} 結束
                      </span>
                    </>
                  )}
                </div>

                {/* 操作 */}
                <div className="flex gap-3 mt-auto">
                  <button
                    onClick={() => addUnit(slot.id)}
                    className="flex-1 flex items-center justify-center gap-2 rounded-lg active:scale-95 transition-all py-3.5 text-lg font-medium"
                    style={{ backgroundColor: C.chipBg, color: C.text, border: `1px solid ${C.chipBorder}` }}
                  >
                    <Plus size={18} />
                    10分鐘
                  </button>
                  {!isReady && (
                    <>
                      <button
                        onClick={() => undoUnit(slot.id)}
                        className="rounded-lg active:scale-95 transition-all px-4 text-base font-medium whitespace-nowrap"
                        style={{ backgroundColor: C.chipBg, color: C.text, border: `1px solid ${C.chipBorder}` }}
                        title="退回上一個10分鐘單位"
                      >
                        上一步
                      </button>
                      <button
                        onClick={() => resetSlot(slot.id)}
                        className="rounded-lg active:scale-95 transition-all px-4 text-base font-medium whitespace-nowrap"
                        style={{ backgroundColor: C.chipBg, color: C.text, border: `1px solid ${C.chipBorder}` }}
                        title="重置為可接單"
                      >
                        歸零
                      </button>
                    </>
                  )}
                </div>
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
            <div className="space-y-2">
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
          className="rounded-xl border p-4 mt-8"
          style={{ backgroundColor: C.panelBg, borderColor: C.panelBorder }}
        >
          <h2 className="text-lg font-semibold mb-3">各編號今日接待人數</h2>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {perSlotStats.map((stat) => (
              <div
                key={stat.id}
                className="rounded-lg px-3 py-2.5 flex flex-col items-center"
                style={{
                  backgroundColor: stat.active ? C.chipBg : C.offlineBg,
                  border: `1px solid ${stat.active ? C.chipBorder : C.offlineBorder}`,
                }}
              >
                <span className="text-sm truncate max-w-full" style={{ color: C.chipText }}>
                  {stat.name}
                </span>
                <span
                  className="font-mono-num text-2xl font-semibold"
                  style={{ color: stat.active ? C.text : C.offlineDot }}
                >
                  {stat.count}
                </span>
                {stat.active ? (
                  <span className="text-sm" style={{ color: C.textFaint }}>
                    {stat.minutes} 分
                  </span>
                ) : (
                  <span className="text-sm font-medium" style={{ color: C.offlineText }}>
                    未上線
                  </span>
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
            <div className="space-y-2">
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
                  <span
                    className="text-base font-medium flex-1 truncate"
                    style={{ color: C.offlineText }}
                  >
                    {slot.name}
                    {slotLog.length > 0 && (
                      <span className="text-sm ml-2" style={{ color: C.textFaint }}>
                        （今日 {slotLog.length} 人）
                      </span>
                    )}
                  </span>
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
                      onClick={() => toggleActive(slot.id)}
                      className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium"
                      style={{ backgroundColor: C.chipBg, color: C.text, border: `1px solid ${C.chipBorder}` }}
                    >
                      <Power size={12} />
                      上線
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
