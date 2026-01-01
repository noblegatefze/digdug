"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type Chain = "Base" | "BSC" | "Solana";
type WalletChain = "EVM" | "Solana";

type Asset = {
  id: string;
  chain: Chain;
  symbol: string;
  name: string;
  decimals: number;

  // optional onchain identifiers for linking
  contract?: string; // EVM token contract OR Solana mint (mock ok)
};

type Treasure = {
  id: string;
  title: string;
  remaining: number; // now stateful
  ends: string;
  digCostUSDDD: number;
  rewardAssetId: string;
  description: string;
  maxPerWallet: string;
  distribution: string;
  paused: boolean;
};

type SponsorPool = {
  assetId: string;
  address: string;
  balance: number;
};

type WalletState = {
  chain: WalletChain;
  address: string;
};

type Screen =
  | "start"
  | "intro1"
  | "intro2"
  | "intro3"
  | "feed"
  | "details"
  | "digging"
  | "success"
  | "claim"
  | "stats"
  | "adminLogin"
  | "admin"
  | "profile";

type Ledger = Record<string, number>;

type IntroRewardFlags = {
  start: boolean;
  intro1: boolean;
  intro2: boolean;
  intro3: boolean;
};

type FeedSort = "ending" | "cheapest" | "remaining";

type ToastKind = "info" | "warn";

type ToastState = {
  id: string;
  msg: string;
  kind: ToastKind;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function shortAddr(addr: string) {
  if (!addr) return "";
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function fmtAmount(n: number, decimals: number) {
  const d = clamp(decimals, 0, 8);
  const pow = Math.pow(10, d);
  const v = Math.round(n * pow) / pow;
  return v.toLocaleString(undefined, { maximumFractionDigits: d });
}

function fmtInt(n: number) {
  return Math.max(0, Math.floor(n)).toLocaleString();
}

function explorerBase(chain: Chain) {
  if (chain === "Base") return "https://basescan.org";
  if (chain === "BSC") return "https://bscscan.com";
  return "https://solscan.io";
}

function explorerAddressLink(chain: Chain, address: string) {
  const base = explorerBase(chain);
  if (chain === "Solana") return `${base}/account/${address}`;
  return `${base}/address/${address}`;
}

function explorerTxLink(chain: Chain, tx: string) {
  const base = explorerBase(chain);
  if (chain === "Solana") return `${base}/tx/${tx}`;
  return `${base}/tx/${tx}`;
}

function explorerTokenLink(chain: Chain, tokenOrContract: string) {
  const base = explorerBase(chain);
  if (chain === "Solana") return `${base}/token/${tokenOrContract}`;
  return `${base}/token/${tokenOrContract}`;
}

function todayKeyLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function randId(len = 22) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function stableMockTx(chain: Chain, seed: string) {
  // Deterministic "receipt" ids for UI previews (mock only)
  // EVM: 0x + 64 hex chars, Solana: base58-ish 44 chars
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  if (chain === "Solana") {
    const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let out = "";
    let x = h >>> 0;
    for (let i = 0; i < 44; i++) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      out += chars[Math.abs(x) % chars.length];
    }
    return out;
  }
  const hex = "0123456789abcdef";
  let out = "0x";
  let x = h >>> 0;
  for (let i = 0; i < 64; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out += hex[Math.abs(x) % 16];
  }
  return out;
}

function parseEndsToMinutes(ends: string) {
  // Supports mock formats like "1h 22m", "2d 03h", "6h 05m"
  // Returns minutes; unknown => large number
  try {
    let d = 0,
      h = 0,
      m = 0;
    const dm = ends.match(/(\d+)\s*d/i);
    const hm = ends.match(/(\d+)\s*h/i);
    const mm = ends.match(/(\d+)\s*m/i);
    if (dm) d = parseInt(dm[1] || "0", 10);
    if (hm) h = parseInt(hm[1] || "0", 10);
    if (mm) m = parseInt(mm[1] || "0", 10);
    const total = d * 24 * 60 + h * 60 + m;
    return Number.isFinite(total) ? total : 9999999;
  } catch {
    return 9999999;
  }
}

// ----------------- local persistence (main game) -----------------
const STORAGE_KEY = "digdugdo_mock_v2";
const STORAGE_VERSION = 2;

// ----------------- local persistence (anti-abuse) -----------------
const ABUSE_KEY = "digdugdo_abuse_v1";

// dapp version
const DAPP_VERSION = "0.2.12";

// ---------- ADMIN ----------
const ADMIN_PIN = process.env.NEXT_PUBLIC_ADMIN_PIN || "123456";

// ---------- SITE MODE ----------
const SITE_LIVE_KEY = "digdugdo_site_live_v1";
const PREVIEW_BYPASS_KEY = "digdugdo_preview_bypass_v1";
const USERNAME_KEY = "digdugdo_username_v1";


type PersistedState = {
  v: number;
  hasCompletedIntro: boolean;
  introRewards: IntroRewardFlags;

  usddd: number;
  usdddMinted: number;
  usdddSpent: number;
  usdddTransferred: number;
  usdddBurned?: number;
  digCount: number;
  ledger: Ledger;
};

type AbuseState = {
  sessionId: string; // local-only anonymous id
  cooldowns: Record<string, number>; // treasureId -> unix ms when dig is allowed again
  daily: {
    dayKey: string; // YYYY-MM-DD local
    digs: number;
  };
};

function defaultIntroFlags(): IntroRewardFlags {
  return { start: false, intro1: false, intro2: false, intro3: false };
}

function safeParse(json: string | null): PersistedState | null {
  if (!json) return null;
  try {
    const obj = JSON.parse(json);
    if (!obj || typeof obj !== "object") return null;
    if (obj.v !== STORAGE_VERSION) return null;
    return obj as PersistedState;
  } catch {
    return null;
  }
}

function safeParseAbuse(json: string | null): AbuseState | null {
  if (!json) return null;
  try {
    const obj = JSON.parse(json);
    if (!obj || typeof obj !== "object") return null;
    if (typeof obj.sessionId !== "string") return null;
    if (!obj.cooldowns || typeof obj.cooldowns !== "object") return null;
    if (!obj.daily || typeof obj.daily !== "object") return null;
    if (typeof obj.daily.dayKey !== "string") return null;
    if (typeof obj.daily.digs !== "number") return null;
    return obj as AbuseState;
  } catch {
    return null;
  }
}

function defaultAbuseState(): AbuseState {
  return {
    sessionId: randId(26),
    cooldowns: {},
    daily: { dayKey: todayKeyLocal(), digs: 0 },
  };
}

export default function Home() {
  // ---------- PROJECT LINKS (edit these to real ones) ----------
  const PROJECT = useMemo(
    () => ({
      website: "https://digdug.do",
      x: "https://x.com/DigDugDo",
      // USDDD token contract/mint (mock placeholder)
      usddd: {
        chain: "Base" as Chain,
        contract: "0xD1gDugDo00000000000000000000000000000001",
      },
    }),
    []
  );

  // ---------- CONFIG / MOCK DATA ----------
  const assets = useMemo<Asset[]>(
    () => [
      {
        id: "base-xyz",
        chain: "Base",
        symbol: "XYZ",
        name: "XYZ Token",
        decimals: 4,
        contract: "0x1111111111111111111111111111111111111111",
      },
      {
        id: "base-abc",
        chain: "Base",
        symbol: "ABC",
        name: "ABC Token",
        decimals: 4,
        contract: "0x2222222222222222222222222222222222222222",
      },
      {
        id: "bsc-myst",
        chain: "BSC",
        symbol: "MYST",
        name: "MYST Token",
        decimals: 4,
        contract: "0x3333333333333333333333333333333333333333",
      },
    ],
    []
  );

  // Base treasure definitions (remaining is a number now)
  const treasureBase = useMemo<Treasure[]>(
    () => [
      {
        id: "t1",
        title: "Gold Pouch — XYZ",
        remaining: 8240,
        ends: "1h 22m",
        digCostUSDDD: 1,
        rewardAssetId: "base-xyz",
        description: "A sponsor reward pool for early diggers (mock).",
        maxPerWallet: "1 withdraw",
        distribution: "Random amount",
        paused: false,
      },
      {
        id: "t2",
        title: "Desert Cache — ABC",
        remaining: 2010,
        ends: "6h 05m",
        digCostUSDDD: 2,
        rewardAssetId: "base-abc",
        description: "Deeper dig. Higher variance (mock).",
        maxPerWallet: "1 withdraw",
        distribution: "Fixed or random mix",
        paused: false,
      },
      {
        id: "t3",
        title: "Hidden Vein — MYST",
        remaining: 12450,
        ends: "2d 03h",
        digCostUSDDD: 1,
        rewardAssetId: "bsc-myst",
        description: "A long-running pool hidden in the dunes (mock).",
        maxPerWallet: "1 withdraw/day",
        distribution: "Random amount",
        paused: false,
      },
    ],
    []
  );

  // stateful treasure list so "remaining" can drop
  const [treasures, setTreasures] = useState<Treasure[]>(treasureBase);

  // if the memo changes (dev hot reload), keep treasures in sync once (best-effort)
  useEffect(() => {
    setTreasures(treasureBase);
  }, [treasureBase]);

  const PROOF = useMemo(() => {
    return {
      treasury: {
        label: "DigDug.Do Treasury (USDDD Reserve)",
        chain: "Base" as Chain,
        address: "0x2B0D3F0A5b2a9c3d9f8cE88E2aD8b1aA0bC0DeE1",
      },
      sponsorPools: [
        { assetId: "base-xyz", address: "0x8F7a3C1E2d9b4a5f6c7D8e9F0a1b2C3d4E5f6789", balance: 250_000 },
        { assetId: "base-abc", address: "0xA1b2C3d4E5f678901234567890aBcDeF12345678", balance: 140_000 },
        { assetId: "bsc-myst", address: "0x9aBCdEf01234567890abCDEF1234567890aBCdEf", balance: 500_000 },
      ] satisfies SponsorPool[],
      lastProofTx: {
        label: "Latest sponsor top-up receipt",
        chain: "Base" as Chain,
        tx: "0x111122223333444455556666777788889999AAAABBBBCCCCDDDDEEEEFFFF0000",
      },
    };
  }, []);

  const DIG_SECONDS = 10;
  const INTRO_REWARD = 2.5;
  const EMPTY_REFILL = 5;

  // ---------- Anti-abuse knobs (walletless) ----------
  const COOLDOWN_SECONDS = 60; // per treasure
  const DAILY_DIG_CAP = 25; // per browser per day (local)

  // ---------- APP STATE ----------
  const [screen, setScreen] = useState<Screen>("start");
  const [username, setUsername] = useState<string>("");
  const [siteLive, setSiteLive] = useState<boolean>(false);
  const [previewBypass, setPreviewBypass] = useState<boolean>(false);
  const [adminAuthed, setAdminAuthed] = useState(false);
  const [adminPin, setAdminPin] = useState("");
  const [versionTaps, setVersionTaps] = useState(0);

  const [selected, setSelected] = useState<Treasure | null>(null);
  const [wallet, setWallet] = useState<WalletState | null>(null);

  const [hasCompletedIntro, setHasCompletedIntro] = useState(false);
  const [introRewards, setIntroRewards] = useState<IntroRewardFlags>(defaultIntroFlags());

  const [usddd, setUsddd] = useState(0);
  const [usdddMinted, setUsdddMinted] = useState(0);
  const [usdddSpent, setUsdddSpent] = useState(0);
  const [usdddTransferred, setUsdddTransferred] = useState(0);
  const [usdddBurned, setUsdddBurned] = useState(0);
  const [digCount, setDigCount] = useState(0);

  const [ledger, setLedger] = useState<Ledger>({});
  const [countdown, setCountdown] = useState(DIG_SECONDS);
  const [balancePulse, setBalancePulse] = useState(false);

  // feed sorting (C)
  const [feedSort, setFeedSort] = useState<FeedSort>("ending");

  // toast (B)
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  // ---------- SITE MODE (Coming Soon vs Live) ----------
  useEffect(() => {
    try {
      setSiteLive(localStorage.getItem(SITE_LIVE_KEY) === "1");
      setPreviewBypass(sessionStorage.getItem(PREVIEW_BYPASS_KEY) === "1");
    } catch {
      // ignore
    }
  }, []);

  // ---------- USERNAME (local identity) ----------
  useEffect(() => {
    try {
      const existing = localStorage.getItem(USERNAME_KEY);
      if (existing && existing.trim()) {
        setUsername(existing.trim());
      } else {
        const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
        const name = `Dugger-${rand}`;
        localStorage.setItem(USERNAME_KEY, name);
        setUsername(name);
      }
    } catch {
      // ignore
    }
  }, []);

  // Persist site mode across reloads
  useEffect(() => {
    try {
      localStorage.setItem(SITE_LIVE_KEY, siteLive ? "1" : "0");
    } catch {}
  }, [siteLive]);


  // ambient sound (optional)
  const [soundOn, setSoundOn] = useState(false);
  const windAudioRef = useRef<HTMLAudioElement | null>(null);
  const blipAudioRef = useRef<HTMLAudioElement | null>(null);

  // anti-abuse state
  const [abuse, setAbuse] = useState<AbuseState>(defaultAbuseState());

  // last reward refs for success screen display
  const lastRewardAssetRef = useRef<string>("");
  const lastRewardAmountRef = useRef<number>(0);

  const sponsorPoolsByAsset = useMemo(() => {
    const map: Record<string, SponsorPool> = {};
    for (const p of PROOF.sponsorPools) map[p.assetId] = p;
    return map;
  }, [PROOF]);

  function showToast(msg: string, kind: ToastKind = "info", ms = 2400) {
    const id = randId(10);
    setToast({ id, msg, kind });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), ms) as unknown as number;
  }

  // ---------- HYDRATE PERSISTED STATE ----------
  useEffect(() => {
    const persisted = safeParse(localStorage.getItem(STORAGE_KEY));
    if (persisted) {
      setHasCompletedIntro(!!persisted.hasCompletedIntro);
      setIntroRewards(persisted.introRewards || defaultIntroFlags());

      setUsddd(typeof persisted.usddd === "number" ? persisted.usddd : 0);
      setUsdddMinted(persisted.usdddMinted || 0);
      setUsdddSpent(persisted.usdddSpent || 0);
      setUsdddTransferred(persisted.usdddTransferred || 0);
      setDigCount(persisted.digCount || 0);

      setLedger(persisted.ledger || {});
    }

    const persistedAbuse = safeParseAbuse(localStorage.getItem(ABUSE_KEY));
    if (persistedAbuse) {
      setAbuse((prev) => ({
        ...prev,
        ...persistedAbuse,
        // guard if day has changed
        daily:
          persistedAbuse.daily?.dayKey === todayKeyLocal()
            ? persistedAbuse.daily
            : { dayKey: todayKeyLocal(), digs: 0 },
      }));
    }
  }, []);

  // ---------- AUDIO (optional; requires user interaction) ----------
  useEffect(() => {
    // These files should exist in /public/sfx in production builds.
    // If they don't, the UI still works (audio simply won't play).
    try {
      windAudioRef.current = new Audio("/sfx/wind.mp3");
      windAudioRef.current.loop = true;
      windAudioRef.current.volume = 0;

      blipAudioRef.current = new Audio("/sfx/blip.mp3");
      blipAudioRef.current.loop = false;
      blipAudioRef.current.volume = 0.35;
    } catch {
      // ignore
    }
  }, []);

  function fadeAudio(a: HTMLAudioElement | null, target: number, ms = 450) {
    if (!a) return;
    const start = a.volume ?? 0;
    const steps = 18;
    const stepMs = Math.max(16, Math.floor(ms / steps));
    let i = 0;
    const t = setInterval(() => {
      i++;
      const v = start + ((target - start) * i) / steps;
      a.volume = Math.max(0, Math.min(1, v));
      if (i >= steps) clearInterval(t);
    }, stepMs);
  }

  async function enableSound() {
    const wind = windAudioRef.current;
    if (!wind) return;
    try {
      // Some browsers require play() to be called from a user gesture.
      await wind.play();
      fadeAudio(wind, 0.15, 550);
      setSoundOn(true);
    } catch {
      // ignore (user gesture not granted)
      setSoundOn(false);
    }
  }

  function disableSound() {
    const wind = windAudioRef.current;
    if (!wind) {
      setSoundOn(false);
      return;
    }
    fadeAudio(wind, 0, 350);
    setTimeout(() => {
      try {
        wind.pause();
        wind.currentTime = 0;
      } catch { }
    }, 420);
    setSoundOn(false);
  }

  function toggleSound() {
    if (soundOn) disableSound();
    else enableSound();
  }

  function playBlip() {
    if (!soundOn) return;
    const b = blipAudioRef.current;
    if (!b) return;
    try {
      b.currentTime = 0;
      void b.play();
    } catch {
      // ignore
    }
  }

  // ---------- PERSIST ON CHANGE ----------
  useEffect(() => {
    const st: PersistedState = {
      v: STORAGE_VERSION,
      hasCompletedIntro,
      introRewards,
      usddd,
      usdddMinted,
      usdddSpent,
      usdddTransferred,
      usdddBurned: 0,
      digCount,
      ledger,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(st));
  }, [hasCompletedIntro, introRewards, usddd, usdddMinted, usdddSpent, usdddTransferred, digCount, ledger]);

  useEffect(() => {
    localStorage.setItem(ABUSE_KEY, JSON.stringify(abuse));
  }, [abuse]);

  // ---------- INTRO FLOW (A) ----------
  function mintIntroRewardOnce(step: keyof IntroRewardFlags) {
    // Gate using current state (prevents StrictMode double-invoke issues)
    if (introRewards?.[step]) return;

    // Mark step as rewarded
    setIntroRewards((prev) => ({ ...(prev || defaultIntroFlags()), [step]: true }));

    // Mint exactly once
    setUsddd((v) => Math.round((v + INTRO_REWARD) * 100) / 100);
    setUsdddMinted((m) => Math.round((m + INTRO_REWARD) * 100) / 100);

    setBalancePulse(true);
    setTimeout(() => setBalancePulse(false), 280);
  }

  function nextIntro() {
    if (screen === "start") {
      mintIntroRewardOnce("start");
      setScreen("intro1");
      return;
    }
    if (screen === "intro1") {
      mintIntroRewardOnce("intro1");
      setScreen("intro2");
      return;
    }
    if (screen === "intro2") {
      mintIntroRewardOnce("intro2");
      setScreen("intro3");
      return;
    }
    if (screen === "intro3") {
      mintIntroRewardOnce("intro3");
      setHasCompletedIntro(true);
      setScreen("feed");
      return;
    }
  }

  function goIntroReplay() {
    setScreen("start");
  }

  // ---------- NAV ----------
  function openDetails(t: Treasure) {
    setSelected(t);
    setScreen("details");
  }

  function backToFeed() {
    setSelected(null);
    setScreen("feed");
  }

  function goToTreasures() {
    setSelected(null);
    setScreen("feed");
  }

  // ---------- WALLET (MOCK) ----------
  function connectMockWallet() {
    // super simple mock: alternate chain by dig count for demo
    const chain: WalletChain = digCount % 2 === 0 ? "EVM" : "Solana";
    const addr =
      chain === "Solana"
        ? "9vQJZx7fWZgq4dQvVbqgWQkCwY9h4uJxVv3xY7nYwqP3"
        : "0x5A3b1c2d3E4f5678901234567890aBCdEf123456";
    setWallet({ chain, address: addr });
  }

  // ---------- ANTI-ABUSE HELPERS ----------
  const nowMs = Date.now();
  const dailyKey = todayKeyLocal();
  const digsToday = abuse.daily.dayKey === dailyKey ? abuse.daily.digs : 0;
  const digsLeft = Math.max(0, DAILY_DIG_CAP - digsToday);

  function isOnCooldown(treasureId: string) {
    const until = abuse.cooldowns[treasureId] || 0;
    return until > nowMs;
  }

  function cooldownRemainingSec(treasureId: string) {
    const until = abuse.cooldowns[treasureId] || 0;
    return Math.max(0, Math.ceil((until - nowMs) / 1000));
  }

  // ---------- GAME LOGIC ----------
  function canAfford(t: Treasure) {
    return usddd >= t.digCostUSDDD;
  }

  function canDigNow(t: Treasure) {
    if (t.paused) return false;
    if (t.remaining <= 0) return false;
    if (digsLeft <= 0) return false;
    if (isOnCooldown(t.id)) return false;
    if (!canAfford(t)) return false;
    return true;
  }

  const rewardRows = Object.entries(ledger).filter(([, amt]) => amt > 0).length;

  function refillCredits() {
    // only refill if empty-ish
    if (usddd > 0) return;
    setUsddd((v) => Math.round((v + EMPTY_REFILL) * 100) / 100);
    setUsdddMinted((m) => Math.round((m + EMPTY_REFILL) * 100) / 100);
    setBalancePulse(true);
    setTimeout(() => setBalancePulse(false), 280);
  }

  function goWithdraw() {
    setScreen("claim");
  }

  function goStats() {
    setScreen("stats");
  }

  function withdrawAll() {
    const rows = Object.entries(ledger).filter(([, amt]) => amt > 0);
    setLedger({});
    setUsdddTransferred((x) => x + rows.length);
    setScreen("feed");
  }

  function resetDemoData() {
    // Operator-only: hard reset demo + return to Coming Soon
    resetAll();
    try {
      localStorage.setItem(SITE_LIVE_KEY, "0");
      sessionStorage.removeItem(PREVIEW_BYPASS_KEY);
    } catch {}
    setSiteLive(false);
    setPreviewBypass(false);
  }

  function resetAll() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(ABUSE_KEY);

    setHasCompletedIntro(false);
    setIntroRewards(defaultIntroFlags());
    setScreen("start");
    setSelected(null);
    setWallet(null);
    setUsddd(0);
    setUsdddMinted(0);
    setUsdddSpent(0);
    setUsdddTransferred(0);
    setUsdddBurned(0);
    setDigCount(0);
    setLedger({});

    setAbuse(defaultAbuseState());
    setTreasures(treasureBase);
    setFeedSort("ending");
    setToast(null);
  }

  function spendNow(cost: number) {
    setUsddd((v) => Math.round((v - cost) * 100) / 100);
    setUsdddSpent((sp) => Math.round((sp + cost) * 100) / 100);
    setBalancePulse(true);
    setTimeout(() => setBalancePulse(false), 280);
  }

  function decrementRemaining(treasureId: string) {
    setTreasures((prev) =>
      prev.map((t) => (t.id === treasureId ? { ...t, remaining: Math.max(0, t.remaining - 1) } : t))
    );
  }

  function startDig(currentT: Treasure) {
    const tk = todayKeyLocal();
    const todaysDigs = abuse.daily.dayKey === tk ? abuse.daily.digs : 0;

    if (todaysDigs >= DAILY_DIG_CAP) return;
    if (isOnCooldown(currentT.id)) return;
    if (!canAfford(currentT)) return;
    if (currentT.remaining <= 0) return;

    // will this dig exhaust the vein?
    const willExhaust = currentT.remaining === 1;

    // IMPORTANT: spend immediately so header always matches the action
    spendNow(currentT.digCostUSDDD);
    setDigCount((d) => d + 1);

    // reduce pool "remaining" immediately (mock)
    decrementRemaining(currentT.id);

    // selection for the dig/success screens
    setSelected(currentT);

    const now = Date.now();
    setAbuse((prev) => {
      const nextDaily = prev.daily.dayKey === tk ? prev.daily : { dayKey: tk, digs: 0 };
      return {
        ...prev,
        daily: { dayKey: tk, digs: nextDaily.digs + 1 },
        cooldowns: { ...prev.cooldowns, [currentT.id]: now + COOLDOWN_SECONDS * 1000 },
      };
    });

    // B: exhaustion moment
    if (willExhaust) {
      showToast("Vein exhausted. New treasures appear soon.", "warn", 2800);
    }

    playBlip();
    setScreen("digging");
  }

  // ---------- DIGGING COUNTDOWN ----------
  useEffect(() => {
    if (screen !== "digging") return;

    setCountdown(DIG_SECONDS);
    const t = window.setInterval(() => {
      setCountdown((s) => {
        if (s <= 1) {
          window.clearInterval(t);
          setScreen("success");
          playBlip();

          if (selected) {
            // reward at end (mock)
            const a = assets.find((x) => x.id === selected.rewardAssetId);
            const base = a?.symbol === "MYST" ? 18 : a?.symbol === "ABC" ? 12 : 8;
            const reward = Math.max(0.0001, Math.round((Math.random() * base + 0.01) * 10000) / 10000);

            lastRewardAmountRef.current = reward;
            lastRewardAssetRef.current = selected.rewardAssetId;

            setLedger((prev) => {
              const cur = prev[selected.rewardAssetId] || 0;
              return { ...prev, [selected.rewardAssetId]: cur + reward };
            });
          }
          return 0;
        }
        return s - 1;
      });
    }, 1000);

    return () => window.clearInterval(t);
  }, [screen, DIG_SECONDS, selected, assets]);

  const isIntro = screen === "start" || screen === "intro1" || screen === "intro2" || screen === "intro3";
  const diggingActive = screen === "digging";

  const sortedTreasures = useMemo(() => {
    const list = [...treasures];
    if (feedSort === "cheapest") {
      list.sort((a, b) => a.digCostUSDDD - b.digCostUSDDD || parseEndsToMinutes(a.ends) - parseEndsToMinutes(b.ends));
      return list;
    }
    if (feedSort === "remaining") {
      list.sort((a, b) => b.remaining - a.remaining || parseEndsToMinutes(a.ends) - parseEndsToMinutes(b.ends));
      return list;
    }
    // default: ending soon
    list.sort((a, b) => parseEndsToMinutes(a.ends) - parseEndsToMinutes(b.ends) || a.digCostUSDDD - b.digCostUSDDD);
    return list;
  }, [treasures, feedSort]);
  // Coming Soon gate
  if (!siteLive && !adminAuthed && !previewBypass && screen !== "adminLogin" && screen !== "admin") {
    const walletLabel = wallet ? `Connected: ${shortAddr(wallet.address)}` : "No wallet connected";
    return (
      <ComingSoonScreen
        walletLabel={wallet ? "Connected" : "No wallet connected"}
        onBypass={() => {
          try {
            sessionStorage.setItem(PREVIEW_BYPASS_KEY, "1");
          } catch {}
          setPreviewBypass(true);
          setScreen("start");
        }}
      />

    );
  }



  return (
    <main className="relative min-h-screen text-amber-50 bg-neutral-950">
      <DesertScene diggingActive={diggingActive} />

      {/* Toast */}
      <Toast toast={toast} />

      <div className="relative mx-auto w-full max-w-md px-4 sm:px-6 pt-6 pb-16">
        <ScannerFrame>
          <Header
            wallet={wallet}
            usddd={usddd}
            balancePulse={balancePulse}
            rewardsCount={rewardRows}
            onWithdraw={goWithdraw}
            onStats={goStats}
            onIntro={goIntroReplay}
            onToggleSound={toggleSound}
            soundOn={soundOn}
            isStats={screen === "stats"}
            username={username}
            onProfile={() => setScreen("profile")}
          />

          {isIntro && (
            <IntroCard
              screen={screen}
              onNext={nextIntro}
              hasCompletedIntro={hasCompletedIntro}
              introRewards={introRewards}
              onGoDig={() => setScreen("feed")}
            />
          )}

          {screen === "feed" && (
            <div className="space-y-4">
              {/* Sort control (C) */}
              <FeedControls sort={feedSort} onSort={setFeedSort} />

              {sortedTreasures.map((t) => (
                <TreasureCard key={t.id} treasure={t} assets={assets} onOpen={() => openDetails(t)} />
              ))}
              <div className="text-xs text-amber-200/70 pt-1">No wallet needed to start. Connect only when withdrawing.</div>
            </div>
          )}

          {screen === "details" && selected && (
            <TreasureDetails
              treasure={treasures.find((x) => x.id === selected.id) || selected}
              assets={assets}
              usddd={usddd}
              canAfford={canAfford(treasures.find((x) => x.id === selected.id) || selected)}
              canDigNow={canDigNow(treasures.find((x) => x.id === selected.id) || selected)}
              digsLeft={digsLeft}
              digsToday={digsToday}
              dailyCap={DAILY_DIG_CAP}
              cooldownRemaining={cooldownRemainingSec(selected.id)}
              cooldownSeconds={COOLDOWN_SECONDS}
              onBack={backToFeed}
              onDig={() => startDig(treasures.find((x) => x.id === selected.id) || selected)}
              onRefill={refillCredits}
              emptyRefillAmount={EMPTY_REFILL}
              websiteUrl={PROJECT.website}
              xUrl={PROJECT.x}
            />
          )}

          {screen === "digging" && selected && (
            <DiggingScreen treasure={selected} countdown={countdown} seconds={DIG_SECONDS} />
          )}

          {screen === "success" && selected && (
            <SuccessScreen
              treasure={selected}
              assets={assets}
              rewardAssetId={lastRewardAssetRef.current}
              rewardAmount={lastRewardAmountRef.current}
              onBackToFeed={goToTreasures}
              onWithdraw={goWithdraw}
            />
          )}

          {screen === "claim" && (
            <WithdrawScreen
              wallet={wallet}
              assets={assets}
              ledger={ledger}
              onBack={goToTreasures}
              onConnect={connectMockWallet}
              onWithdraw={withdrawAll}
            />
          )}

          {screen === "profile" && (
            <ProfileScreen
              username={username || "Dugger"}
              onSave={(next) => {
                setUsername(next);
                try {
                  localStorage.setItem(USERNAME_KEY, next);
                } catch {}
              }}
              onBack={() => setScreen("feed")}
            />
          )}

          {screen === "adminLogin" && (
            <AdminLogin
              pin={adminPin}
              setPin={setAdminPin}
              onCancel={() => setScreen("feed")}
              onSubmit={() => {
                if (adminPin === ADMIN_PIN) {
                  setAdminAuthed(true);
                  setAdminPin("");
                  setScreen("admin");
                }
              }}
            />
          )}

          {screen === "admin" && adminAuthed && (
            <AdminScreen
              treasures={treasures}
              setTreasures={setTreasures}
              usddd={usddd}
              setUsddd={setUsddd}
              setUsdddMinted={setUsdddMinted}
              setUsdddBurned={setUsdddBurned}
              digCount={digCount}
              siteLive={siteLive}
              setSiteLive={setSiteLive}
              onResetDemo={resetDemoData}
              onExit={() => {
                setAdminAuthed(false);
                setScreen("feed");
              }}
            />
          )}

          {screen === "stats" && (
            <ProofScreen
              assets={assets}
              proof={PROOF}
              sponsorPoolsByAsset={sponsorPoolsByAsset}
              usddd={usddd}
              usdddMinted={usdddMinted}
              usdddSpent={usdddSpent}
              usdddTransferred={usdddTransferred}
              usdddBurned={usdddBurned}
              digCount={digCount}
              ledger={ledger}
              onBack={goToTreasures}
              onReset={resetAll}
              sessionId={abuse.sessionId}
              dailyKey={dailyKey}
              digsToday={digsToday}
              dailyCap={DAILY_DIG_CAP}
              cooldownSeconds={COOLDOWN_SECONDS}
            />
          )}
        </ScannerFrame>
      </div>

      <button
        onClick={() => {
          setVersionTaps((n) => {
            const next = n + 1;
            if (next >= 5) {
              setVersionTaps(0);
              setScreen("adminLogin");
            }
            return next;
          });
        }}
        className="fixed bottom-4 left-0 right-0 text-center text-[11px] text-amber-200/35"
        title="Version"
      >
        DIGDUG.DO dapp v{DAPP_VERSION}
      </button>
    </main>
  );
}

/* =======================
   TOAST
======================= */

function Toast({ toast }: { toast: ToastState | null }) {
  if (!toast) return null;

  const base =
    "fixed top-4 left-1/2 -translate-x-1/2 z-[60] w-[92%] max-w-md rounded-2xl border px-4 py-3 text-sm shadow-[0_12px_45px_rgba(0,0,0,0.55)] backdrop-blur-[10px]";
  const style =
    toast.kind === "warn"
      ? "bg-neutral-950/65 border-amber-200/25 text-amber-50"
      : "bg-neutral-950/60 border-amber-200/18 text-amber-100/90";

  return (
    <div className={`${base} ${style}`}>
      <div className="flex items-start gap-2">
        <div className="mt-0.5">{toast.kind === "warn" ? "⛏️" : "ℹ️"}</div>
        <div className="min-w-0">{toast.msg}</div>
      </div>
    </div>
  );
}

/* =======================
   FEED CONTROLS (SORT)
======================= */

function FeedControls({ sort, onSort }: { sort: FeedSort; onSort: (s: FeedSort) => void }) {
  return (
    <div className="rounded-2xl bg-neutral-900/55 border border-amber-200/15 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-amber-50">Treasure feed</div>

        <div className="flex items-center gap-2">
          <div className="text-[11px] text-amber-200/70">Sort</div>
          <select
            value={sort}
            onChange={(e) => onSort(e.target.value as FeedSort)}
            className="rounded-xl border border-amber-200/18 bg-neutral-950/30 px-3 py-2 text-[12px] text-amber-50 outline-none"
          >
            <option value="ending">Ending soon</option>
            <option value="cheapest">Cheapest</option>
            <option value="remaining">Most remaining</option>
          </select>
        </div>
      </div>

      <div className="mt-2 text-[11px] text-amber-200/55">Pick a pool, dig, and stack rewards until you withdraw.</div>
    </div>
  );
}

/* =======================
   BACKGROUND + SCANNER FRAME
======================= */

function DesertScene({ diggingActive }: { diggingActive: boolean }) {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden">
      {/* sky + vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,214,140,0.18),transparent_55%),linear-gradient(to_bottom,rgba(8,10,14,0.85),rgba(0,0,0,0.96))]" />

      {/* distant dunes */}
      <div className="absolute -bottom-36 left-[-15%] right-[-15%] h-[55%] opacity-55">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_70%,rgba(251,191,36,0.16),transparent_58%),radial-gradient(circle_at_58%_78%,rgba(251,191,36,0.12),transparent_60%),radial-gradient(circle_at_88%_65%,rgba(251,191,36,0.10),transparent_60%)] animate-[duneDrift_18s_ease-in-out_infinite]" />
      </div>

      {/* near dunes */}
      <div className="absolute -bottom-28 left-[-20%] right-[-20%] h-[58%] opacity-70 blur-[0.2px]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_78%,rgba(251,191,36,0.18),transparent_58%),radial-gradient(circle_at_52%_84%,rgba(251,191,36,0.14),transparent_60%),radial-gradient(circle_at_86%_76%,rgba(251,191,36,0.12),transparent_62%)] animate-[duneDrift_12s_ease-in-out_infinite]" />
      </div>

      {/* blowing sand particles */}
      <div className={`absolute inset-0 mix-blend-screen ${diggingActive ? "opacity-60" : "opacity-45"}`}>
        <div
          className={`absolute inset-0 bg-[radial-gradient(circle_at_10%_20%,rgba(255,255,255,0.22)_1px,transparent_2px),radial-gradient(circle_at_55%_35%,rgba(255,255,255,0.16)_1px,transparent_2px),radial-gradient(circle_at_85%_70%,rgba(255,255,255,0.12)_1px,transparent_2px)] bg-[size:320px_320px] ${diggingActive ? "animate-[sandDriftFast_6s_linear_infinite]" : "animate-[sandDrift_9s_linear_infinite]"
            }`}
        />
      </div>

      {/* heat shimmer overlay */}
      <div
        className={`absolute inset-0 mix-blend-overlay bg-[linear-gradient(120deg,transparent,rgba(255,255,255,0.10),transparent)] bg-[size:220%_220%] ${diggingActive
          ? "opacity-28 animate-[shimmerFast_3.2s_ease-in-out_infinite]"
          : "opacity-20 animate-[shimmer_4.5s_ease-in-out_infinite]"
          } [filter:blur(0.6px)]`}
      />

      {/* dark edge vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(0,0,0,0.86))]" />

      <style jsx>{`
        @keyframes duneDrift {
          0% {
            transform: translateX(0px);
          }
          50% {
            transform: translateX(26px);
          }
          100% {
            transform: translateX(0px);
          }
        }
        @keyframes sandDrift {
          0% {
            transform: translateX(-40px) translateY(0px);
          }
          100% {
            transform: translateX(40px) translateY(-10px);
          }
        }
        @keyframes sandDriftFast {
          0% {
            transform: translateX(-55px) translateY(0px);
          }
          100% {
            transform: translateX(55px) translateY(-14px);
          }
        }
        @keyframes shimmer {
          0% {
            transform: translateY(0px);
            opacity: 0.16;
          }
          50% {
            transform: translateY(6px);
            opacity: 0.22;
          }
          100% {
            transform: translateY(0px);
            opacity: 0.16;
          }
        }
        @keyframes shimmerFast {
          0% {
            transform: translateY(0px);
            opacity: 0.18;
          }
          50% {
            transform: translateY(8px);
            opacity: 0.28;
          }
          100% {
            transform: translateY(0px);
            opacity: 0.18;
          }
        }
      `}</style>
    </div>
  );
}

function BackgroundFX() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* sky + vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,214,140,0.14),transparent_55%),linear-gradient(to_bottom,rgba(8,10,14,0.85),rgba(0,0,0,0.96))]" />

      {/* distant dunes */}
      <div className="absolute -bottom-36 left-[-15%] right-[-15%] h-[55%] opacity-55">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_70%,rgba(251,191,36,0.14),transparent_58%),radial-gradient(circle_at_58%_78%,rgba(251,191,36,0.10),transparent_60%),radial-gradient(circle_at_88%_65%,rgba(251,191,36,0.08),transparent_60%)] animate-[duneDrift_18s_ease-in-out_infinite]" />
      </div>

      {/* dark edge vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(0,0,0,0.88))]" />

      <style jsx>{`
        @keyframes duneDrift {
          0% {
            transform: translateX(0px);
          }
          50% {
            transform: translateX(26px);
          }
          100% {
            transform: translateX(0px);
          }
        }
      `}</style>
    </div>
  );
}


function ScannerFrame({ children }: { children: ReactNode }) {
  return (
    <div className="relative rounded-[28px] border border-amber-200/18 bg-neutral-950/25 overflow-hidden shadow-[0_0_0_1px_rgba(0,0,0,0.55)_inset,0_12px_55px_rgba(0,0,0,0.65)]">
      {/* scanlines */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.22] bg-[repeating-linear-gradient(to_bottom,rgba(255,255,255,0.05)_0px,rgba(255,255,255,0.05)_1px,transparent_3px,transparent_7px)] mix-blend-overlay" />
      {/* subtle grid */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.06] bg-[linear-gradient(to_right,rgba(255,255,255,0.7)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.7)_1px,transparent_1px)] bg-[size:96px_96px]" />
      {/* inner glow */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(0,210,255,0.10),transparent_55%),radial-gradient(circle_at_50%_115%,rgba(251,191,36,0.09),transparent_60%)]" />
      {/* corner brackets */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-4 top-4 h-5 w-5 border-l-2 border-t-2 border-amber-200/30 rounded-[6px]" />
        <div className="absolute right-4 top-4 h-5 w-5 border-r-2 border-t-2 border-amber-200/30 rounded-[6px]" />
        <div className="absolute left-4 bottom-4 h-5 w-5 border-l-2 border-b-2 border-amber-200/30 rounded-[6px]" />
        <div className="absolute right-4 bottom-4 h-5 w-5 border-r-2 border-b-2 border-amber-200/30 rounded-[6px]" />
      </div>

      <div className="relative p-1">
        <div className="rounded-[26px] border border-amber-200/10 bg-neutral-900/40 backdrop-blur-[10px]">
          <div className="p-3 sm:p-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

/* =======================
   HEADER
======================= */

function Header({
  wallet,
  usddd,
  balancePulse,
  rewardsCount,
  onWithdraw,
  onStats,
  onIntro,
  onToggleSound,
  soundOn,
  isStats,
  username,
  onProfile,
}: {
  wallet: WalletState | null;
  usddd: number;
  balancePulse: boolean;
  rewardsCount: number;
  onWithdraw: () => void;
  onStats: () => void;
  onIntro: () => void;
  onToggleSound: () => void;
  soundOn: boolean;
  isStats: boolean;
  username: string;
  onProfile: () => void;
}) {
  const pillBase =
    "rounded-2xl border px-4 py-2 text-[11px] font-semibold tracking-wide transition hover:border-amber-200/35 active:scale-[0.99]";
  const pillIdle = "border-amber-200/18 bg-neutral-950/25 text-amber-100/85";
  const pillActive = "border-amber-200/40 bg-neutral-950/35 text-amber-50";

  return (
    <header className="mb-6">
      <div className="rounded-3xl bg-neutral-900/55 border border-amber-200/15 overflow-hidden">
        <div className="relative p-5 sm:p-6">
          <div className="pointer-events-none absolute inset-0 opacity-[0.06] bg-[linear-gradient(to_right,rgba(255,255,255,0.55)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.55)_1px,transparent_1px)] bg-[size:72px_72px]" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(251,191,36,0.10),transparent_55%),radial-gradient(ellipse_at_bottom,rgba(0,0,0,0.55),rgba(0,0,0,0.92))]" />

          <div className="relative mx-auto w-full max-w-[420px] space-y-5">
            <div className="flex items-start gap-3 px-1">
              <div className="relative h-11 w-11 rounded-2xl bg-neutral-950/40 border border-amber-200/18 grid place-items-center overflow-hidden shrink-0">
                <div className="h-6 w-6 opacity-75 bg-[linear-gradient(to_right,rgba(251,191,36,0.9)_1px,transparent_1px),linear-gradient(to_bottom,rgba(251,191,36,0.9)_1px,transparent_1px)] bg-[size:6px_6px]" />
                <div className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-amber-200/80 shadow-[0_0_0_6px_rgba(251,191,36,0.10)]" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="text-xs tracking-[0.35em] text-amber-200/80">DIGDUG.DO</div>
                <div className="mt-1 text-sm text-amber-50 font-semibold">Dig For Treasure Drops</div>
                <div className="mt-1 text-[10px] text-amber-200/50">Powered by USDDD</div>
              </div>
            </div>

            <div className="text-center">
              <div
                className={`text-4xl sm:text-[44px] leading-none font-extrabold tabular-nums ${balancePulse ? "scale-[1.02] text-amber-50" : "text-amber-100"
                  } transition-transform`}
              >
                {usddd.toFixed(2)}
              </div>
              <div className="mt-1 text-xs tracking-[0.25em] text-amber-200/70">USDDD CREDITS</div>
            </div>

            <div className="flex items-center justify-center gap-2">
              <button onClick={onWithdraw} className={`${pillBase} ${pillIdle}`} title="Withdraw rewards">
                Withdraw{" "}
                <span className="ml-1 inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[10px] border border-amber-200/18 bg-neutral-950/25 text-amber-100/85">
                  {rewardsCount}
                </span>
              </button>

              <button onClick={onStats} className={`${pillBase} ${isStats ? pillActive : pillIdle}`} title="Stats & proof">
                Stats
              </button>

              <button
                onClick={onToggleSound}
                className={`${pillBase} ${pillIdle}`}
                title={soundOn ? "Sound on" : "Sound off"}
              >
                {soundOn ? "🔊" : "🔇"}
              </button>

              <button onClick={onIntro} className={`${pillBase} ${pillIdle}`} title="Replay intro">
                Intro
              </button>
            </div>

            <div className="mt-1 flex items-center justify-between text-[11px] text-amber-200/55">
              <button
                onClick={onProfile}
                className="text-amber-200/70 hover:text-amber-100 underline underline-offset-4 truncate max-w-[55%]"
                title="Edit username"
              >
                @{username || "Dugger"}
              </button>
              <div>{wallet ? `Connected: ${shortAddr(wallet.address)}` : "No wallet connected"}</div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}


/* =======================
   COMING SOON + PROFILE
======================= */

function ComingSoonScreen({
  walletLabel,
  onBypass,
}: {
  walletLabel: string;
  onBypass: () => void;
}) {
  const [taps, setTaps] = useState(0);
  return (
    <div className="min-h-screen w-full bg-[#050505] text-amber-50">
      <BackgroundFX />

      <div className="mx-auto max-w-md px-4 py-10">
        <div className="rounded-[28px] border border-amber-200/14 bg-neutral-950/35 p-6 shadow-[0_0_120px_rgba(245,200,80,0.06)] animate-cardPulse">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-2xl border border-amber-200/18 bg-neutral-950/60 grid place-items-center">
              <div className="text-amber-200/80 text-sm font-semibold">DD</div>
            </div>
            <div className="min-w-0">
              <div className="text-[11px] tracking-[0.35em] text-amber-200/55">DIGDUG.DO</div>
              <div className="mt-1 text-lg font-semibold leading-tight">Dig For Free Crypto Treasure</div>
              <div className="mt-1 text-xs text-amber-200/60">Powered by USDDD</div>
            </div>
          </div>

          <div className="mt-8 text-center">
            <div className="text-4xl font-semibold tracking-tight">Coming Soon</div>
            <div className="mt-3 text-sm text-amber-200/70">
              Treasure drops are being prepared. Early diggers get the edge.
            </div>
          </div>

          <div className="mt-8">
            <a
              href="https://x.com/toastpunk"
              target="_blank"
              rel="noreferrer"
              className="block w-full rounded-2xl bg-amber-200 px-4 py-3 text-center text-sm font-semibold text-neutral-950 active:scale-[0.99]"
            >
              Follow @toastpunk on X
            </a>
          </div>

          <div className="mt-6 flex items-center justify-between text-[12px] text-amber-200/65">
            <div className="text-amber-200/65">@toastpunk</div>
            <div>{walletLabel}</div>
          </div>

          <button
            onClick={() => {
              setTaps((n) => {
                const next = n + 1;
                if (next >= 7) {
                  onBypass();
                  return 0;
                }
                return next;
              });
            }}
            className="mt-6 w-full text-right text-[11px] text-amber-200/55 hover:text-amber-200/80 select-none"
            title="Tap 7x to preview"
          >
            v{DAPP_VERSION}
          </button>

        </div>
      </div>
    </div>
  );
}

function ProfileScreen({
  username,
  onSave,
  onBack,
}: {
  username: string;
  onSave: (next: string) => void;
  onBack: () => void;
}) {
  const [draft, setDraft] = useState(username);
  const [err, setErr] = useState<string | null>(null);

  function validate(v: string) {
    const s = v.trim();
    if (s.length < 3) return "Username must be at least 3 characters.";
    if (s.length > 20) return "Username must be 20 characters or less.";
    if (!/^[a-zA-Z0-9_]+$/.test(s)) return "Use only letters, numbers, and underscore.";
    return null;
  }

  return (
    <div className="min-h-screen w-full bg-[#050505] text-amber-50">
      <BackgroundFX />
      <div className="mx-auto max-w-md px-4 py-10">
        <div className="rounded-[28px] border border-amber-200/14 bg-neutral-950/35 p-6 shadow-[0_0_120px_rgba(245,200,80,0.06)]">
          <button onClick={onBack} className="text-xs text-amber-200/80 underline">
            ← Back
          </button>
          <div className="mt-3 text-xl font-semibold">Profile</div>
          <div className="mt-1 text-xs text-amber-200/65">Set your public username (stored locally for now).</div>

          <div className="mt-4">
            <div className="text-[11px] text-amber-200/70">Username</div>
            <input
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setErr(null);
              }}
              className="mt-2 w-full rounded-xl border border-amber-200/18 bg-neutral-950/40 px-3 py-2 text-amber-50 outline-none text-sm"
              placeholder="e.g. Dugger_42"
            />
            {err && <div className="mt-2 text-[11px] text-red-300/80">{err}</div>}
          </div>

          <button
            className="mt-4 w-full rounded-2xl bg-amber-200 px-4 py-3 text-sm font-semibold text-neutral-950 active:scale-[0.99]"
            onClick={() => {
              const e = validate(draft);
              if (e) return setErr(e);
              onSave(draft.trim());
              onBack();
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

/* =======================
   INTRO
======================= */

function IntroCard({
  screen,
  onNext,
  hasCompletedIntro,
  introRewards,
  onGoDig,
}: {
  screen: "start" | "intro1" | "intro2" | "intro3";
  onNext: () => void;
  hasCompletedIntro: boolean;
  introRewards: IntroRewardFlags;
  onGoDig: () => void;
}) {
  const card = "rounded-2xl bg-neutral-900/55 border border-amber-200/15 p-5";

  const stepKey: keyof IntroRewardFlags =
    screen === "start" ? "start" : screen === "intro1" ? "intro1" : screen === "intro2" ? "intro2" : "intro3";

  const alreadyRewarded = introRewards?.[stepKey] === true;
  const buttonSuffix = alreadyRewarded ? "" : " (+2.5 USDDD)";

  // Reusable Page 1 (for new users + people who click Intro later)
  if (screen === "start") {
    return (
      <div className={card}>
        <div className="text-xs uppercase tracking-wide text-amber-200/60">Welcome</div>

        <div className="mt-3 space-y-1">
          <div className="text-2xl font-extrabold leading-tight text-amber-50">
            DIG <span className="text-amber-200">Free Crypto Treasure</span>
          </div>
          <div className="text-sm text-amber-200/85 leading-relaxed">
            Withdraw What You <span className="font-semibold text-amber-50">DUG</span>
            <br />
            <span className="font-semibold text-amber-50">DO</span> Whatever You Want
          </div>
        </div>

        <div className="mt-4 text-sm text-amber-100 space-y-1">
          <div>• Dig using USDDD credits</div>
          <div>• Rewards are stored until you withdraw</div>
          <div>• No wallet needed to start</div>
        </div>

        {hasCompletedIntro ? (
          <button
            onClick={onGoDig}
            className="mt-5 w-full rounded-2xl bg-amber-200 text-neutral-950 font-semibold py-4 active:scale-[0.99]"
          >
            Go Dig
          </button>
        ) : (
          <button
            onClick={onNext}
            className="mt-5 w-full rounded-2xl bg-amber-200 text-neutral-950 font-semibold py-4 active:scale-[0.99]"
          >
            Start{buttonSuffix}
          </button>
        )}
      </div>
    );
  }

  // Page 2 = Dig
  if (screen === "intro1") {
    return (
      <div className={card}>
        <div className="text-xs uppercase tracking-wide text-amber-200/60">Step 1</div>
        <div className="mt-2 text-3xl font-extrabold leading-none">
          <span className="text-amber-50">Dig</span>
        </div>

        <div className="mt-3 text-sm text-amber-200/85 leading-relaxed">
          Choose a treasure pool and spend <span className="font-semibold text-amber-50">USDDD credits</span> to dig.
        </div>

        <div className="mt-4 rounded-2xl bg-neutral-950/35 border border-amber-200/12 p-4 text-sm text-amber-200/85 space-y-2">
          <div className="flex items-start gap-2">
            <span className="mt-0.5">⛏️</span>
            <span>
              Pick a pool you like (ending soon / cheapest / most remaining)
            </span>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-0.5">🪙</span>
            <span>
              Each dig costs USDDD — your balance updates instantly
            </span>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-0.5">🎁</span>
            <span>
              Every dig drops a random reward into your stash
            </span>
          </div>
        </div>

        <button
          onClick={onNext}
          className="mt-5 w-full rounded-2xl bg-amber-200 text-neutral-950 font-semibold py-4 active:scale-[0.99]"
        >
          Next{buttonSuffix}
        </button>
      </div>
    );
  }


  // Page 3 = Dug
  if (screen === "intro2") {
    return (
      <div className={card}>
        <div className="text-xs uppercase tracking-wide text-amber-200/60">Step 2</div>
        <div className="mt-2 text-3xl font-extrabold leading-none">
          <span className="text-amber-50">Dug</span>
        </div>

        <div className="mt-3 text-sm text-amber-200/85 leading-relaxed">
          Your dig completes fast — rewards go into your <span className="font-semibold text-amber-50">unwithdrawn stash</span>.
        </div>

        <div className="mt-4 rounded-2xl bg-neutral-950/35 border border-amber-200/12 p-4 text-sm text-amber-200/85 space-y-2">
          <div className="flex items-start gap-2">
            <span className="mt-0.5">⏱️</span>
            <span>
              Dig finishes in seconds (watch the scan bar)
            </span>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-0.5">📦</span>
            <span>
              Rewards stay stored until you choose to withdraw
            </span>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-0.5">🔁</span>
            <span>
              Keep digging to stack multiple rewards
            </span>
          </div>
        </div>

        <button
          onClick={onNext}
          className="mt-5 w-full rounded-2xl bg-amber-200 text-neutral-950 font-semibold py-4 active:scale-[0.99]"
        >
          Next{buttonSuffix}
        </button>
      </div>
    );
  }


  // Page 4 = Do
  return (
    <div className={card}>
      <div className="text-xs uppercase tracking-wide text-amber-200/60">Step 3</div>
      <div className="mt-2 text-3xl font-extrabold leading-none">
        <span className="text-amber-50">Do</span>
      </div>

      <div className="mt-3 text-sm text-amber-200/85 leading-relaxed">
        When you’re ready, withdraw to your wallet and get per-chain receipts.
      </div>

      <div className="mt-4 rounded-2xl bg-neutral-950/35 border border-amber-200/12 p-4 text-sm text-amber-200/85 space-y-2">
        <div className="flex items-start gap-2">
          <span className="mt-0.5">👛</span>
          <span>
            Connect a wallet only when withdrawing
          </span>
        </div>
        <div className="flex items-start gap-2">
          <span className="mt-0.5">🧾</span>
          <span>
            Each chain shows its own explorer receipt
          </span>
        </div>
        <div className="flex items-start gap-2">
          <span className="mt-0.5">✨</span>
          <span>
            Do whatever you want with your rewards
          </span>
        </div>
      </div>

      <button
        onClick={onNext}
        className="mt-5 w-full rounded-2xl bg-amber-200 text-neutral-950 font-semibold py-4 active:scale-[0.99]"
      >
        Enter{buttonSuffix}
      </button>
    </div>
  );
}

/* =======================
   TREASURE FEED + DETAILS
======================= */


function TreasureCard({
  treasure,
  assets,
  onOpen,
}: {
  treasure: Treasure;
  assets: Asset[];
  onOpen: () => void;
}) {
  const a = assets.find((x) => x.id === treasure.rewardAssetId);
  const tokenText = a ? `${a.symbol} on ${a.chain}` : treasure.rewardAssetId;

  const exhausted = treasure.remaining <= 0;
  const paused = treasure.paused === true;

  return (
    <div
      className={`relative rounded-2xl bg-neutral-900/55 border p-5 overflow-hidden ${exhausted ? "border-amber-200/10" : "border-amber-200/15"
        }`}
    >
      {/* Exhausted overlay */}
      {exhausted && (
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-neutral-950/25" />
          <div className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_18%_22%,rgba(251,191,36,0.14),transparent_60%),radial-gradient(circle_at_74%_68%,rgba(251,191,36,0.10),transparent_62%)]" />
          <div className="absolute inset-0 opacity-35 bg-[repeating-linear-gradient(90deg,rgba(255,255,255,0.05)_0px,rgba(255,255,255,0.05)_1px,transparent_2px,transparent_7px)]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(0,0,0,0.65))]" />
        </div>
      )}

      <div className={`relative flex items-start justify-between gap-3 ${exhausted ? "opacity-75" : "opacity-100"}`}>
        <div className="min-w-0">
          <div className={`text-lg font-semibold ${exhausted ? "text-amber-100/70" : "text-amber-50"}`}>
            {treasure.title}
          </div>
          <div className="text-amber-200/85 mt-2 space-y-1">
            <div>🪙 Left: {fmtInt(treasure.remaining)}</div>
            <div>⏳ Ends: {treasure.ends}</div>
            <div>⛏️ Cost: {treasure.digCostUSDDD} USDDD</div>
            <div>🎁 Token: {tokenText}</div>
          </div>

          {paused && !exhausted && <div className="mt-3 text-[11px] text-amber-200/65">This pool is paused.</div>}
          {exhausted && <div className="mt-3 text-[11px] text-amber-200/65">This vein is exhausted.</div>}
        </div>

        <button
          onClick={onOpen}
          className={`shrink-0 rounded-2xl font-semibold px-4 py-3 active:scale-[0.99] ${exhausted
            ? "bg-neutral-900/40 text-amber-200/50 border border-amber-200/12"
            : "bg-amber-200 text-neutral-950"
            }`}
          title={exhausted ? "View details" : "Open details"}
        >
          {exhausted ? "Exhausted" : paused ? "Paused" : "Dig"}
        </button>
      </div>
    </div>
  );
}

function TreasureDetails({
  treasure,
  assets,
  usddd,
  canAfford,
  canDigNow,
  digsLeft,
  digsToday,
  dailyCap,
  cooldownRemaining,
  cooldownSeconds,
  onBack,
  onDig,
  onRefill,
  emptyRefillAmount,
  websiteUrl,
  xUrl,
}: {
  treasure: Treasure;
  assets: Asset[];
  usddd: number;
  canAfford: boolean;
  canDigNow: boolean;
  digsLeft: number;
  digsToday: number;
  dailyCap: number;
  cooldownRemaining: number;
  cooldownSeconds: number;
  onBack: () => void;
  onDig: () => void;
  onRefill: () => void;
  emptyRefillAmount: number;

  websiteUrl: string;
  xUrl: string;
}) {
  const a = assets.find((x) => x.id === treasure.rewardAssetId);

  const linkBtn =
    "inline-flex items-center justify-center rounded-2xl border border-amber-200/18 bg-neutral-950/25 px-3 py-2 text-[12px] text-amber-100/85 transition hover:border-amber-200/35 active:scale-[0.99]";

  const tokenLink =
    a?.contract && a?.chain ? explorerTokenLink(a.chain, a.contract) : a?.chain ? explorerBase(a.chain) : null;

  const limitedByPaused = treasure.paused === true;
  const limitedByDaily = digsLeft <= 0;
  const limitedByCooldown = cooldownRemaining > 0;
  const limitedByEmpty = treasure.remaining <= 0;

  return (
    <div className="rounded-2xl bg-neutral-900/55 border border-amber-200/15 p-5">
      <button onClick={onBack} className="text-xs text-amber-200/80 hover:text-amber-100 underline underline-offset-4">
        ← Back
      </button>

      <div className="mt-3 text-xl font-semibold">{treasure.title}</div>
      <div className="text-amber-200/80 mt-1 text-sm">
        Cost: {treasure.digCostUSDDD} USDDD • Token: {a ? `${a.symbol} on ${a.chain}` : treasure.rewardAssetId}
      </div>

      {/* A: Exhausted banner */}
      {limitedByEmpty && (
        <div className="mt-4 rounded-2xl border border-amber-200/18 bg-neutral-950/35 p-4">
          <div className="text-sm font-semibold text-amber-50">This vein is exhausted.</div>
          <div className="mt-1 text-xs text-amber-200/70">New treasure pools appear soon. Check back later.</div>
        </div>
      )}

      {limitedByPaused && !limitedByEmpty && (
        <div className="mt-4 rounded-2xl border border-amber-200/18 bg-neutral-950/35 p-4">
          <div className="text-sm font-semibold text-amber-50">This pool is paused.</div>
          <div className="mt-1 text-xs text-amber-200/70">Operator has temporarily disabled digs for this treasure.</div>
        </div>
      )}

      <div className="mt-4 rounded-2xl bg-neutral-950/35 border border-amber-200/12 p-4">
        <div className="text-sm font-semibold">Project links</div>
        <div className="mt-3 flex items-center gap-2">
          <a className={linkBtn} href={websiteUrl} target="_blank" rel="noreferrer" title="Website">
            🌐
          </a>
          <a className={linkBtn} href={xUrl} target="_blank" rel="noreferrer" title="X / Twitter">
            𝕏
          </a>
          {tokenLink ? (
            <a className={linkBtn} href={tokenLink} target="_blank" rel="noreferrer" title="Token contract / mint">
              📄
            </a>
          ) : (
            <span className="text-xs text-amber-200/55">Token link unavailable</span>
          )}
        </div>

        {a?.contract && (
          <div className="mt-3 text-[11px] text-amber-200/60">
            Token: <span className="text-amber-100/90 font-semibold">{a.symbol}</span> •{" "}
            <span className="tabular-nums">{shortAddr(a.contract)}</span>
          </div>
        )}
      </div>

      <div className="mt-4 rounded-2xl bg-neutral-950/35 border border-amber-200/12 p-4">
        <div className="text-sm font-semibold">Dig limits</div>
        <div className="mt-2 text-xs text-amber-200/75 space-y-1">
          <div>
            • Daily cap:{" "}
            <span className="font-semibold text-amber-100">
              {digsToday}/{dailyCap}
            </span>{" "}
            (left {digsLeft})
          </div>
          <div>
            • Cooldown: <span className="font-semibold text-amber-100">{cooldownSeconds}s</span> per treasure
          </div>
          <div>
            • Pool remaining: <span className="font-semibold text-amber-100">{fmtInt(treasure.remaining)}</span>
          </div>
        </div>

        {limitedByDaily && (
          <div className="mt-3 text-xs text-amber-200/70">You reached today’s dig cap. Come back tomorrow.</div>
        )}
        {limitedByCooldown && (
          <div className="mt-3 text-xs text-amber-200/70">
            Cooldown active for this treasure:{" "}
            <span className="font-semibold text-amber-100 tabular-nums">{cooldownRemaining}s</span>
          </div>
        )}
      </div>

      <div className="mt-4 rounded-2xl bg-neutral-950/35 border border-amber-200/12 p-4">
        <div className="text-sm text-amber-200/85">
          <div>🪙 Left: {fmtInt(treasure.remaining)}</div>
          <div>⏳ Ends: {treasure.ends}</div>
          <div>🎯 Max per wallet: {treasure.maxPerWallet}</div>
          <div>🎲 Distribution: {treasure.distribution}</div>
        </div>
        <div className="mt-3 text-xs text-amber-200/70">{treasure.description}</div>
      </div>

      {!canAfford && (
        <div className="mt-4 rounded-2xl bg-neutral-950/35 border border-amber-200/12 p-4">
          <div className="text-sm text-amber-200/85">
            You need {treasure.digCostUSDDD.toFixed(2)} USDDD. Your balance is {usddd.toFixed(2)}.
          </div>
          <button
            onClick={onRefill}
            className="mt-3 w-full rounded-2xl bg-neutral-900/30 border border-amber-200/18 text-amber-50 font-semibold py-3 hover:border-amber-200/32 active:scale-[0.99]"
          >
            Refill +{emptyRefillAmount} USDDD (mock)
          </button>
        </div>
      )}

      <button
        onClick={onDig}
        disabled={!canDigNow}
        className={`mt-5 w-full rounded-2xl font-semibold py-4 active:scale-[0.99] ${canDigNow ? "bg-amber-200 text-neutral-950" : "bg-neutral-900/40 text-amber-200/40 cursor-not-allowed"
          }`}
      >
        {limitedByEmpty
          ? "Exhausted"
          : limitedByPaused
            ? "Paused"
            : limitedByDaily
              ? "Daily limit reached"
              : limitedByCooldown
                ? `Cooldown (${cooldownRemaining}s)`
                : !canAfford
                  ? "Need more USDDD"
                  : "Dig now"}
      </button>
    </div>
  );
}

/* =======================
   DIGGING + SUCCESS
======================= */

function DiggingScreen({
  treasure,
  countdown,
  seconds,
}: {
  treasure: Treasure;
  countdown: number;
  seconds: number;
}) {
  const pct = Math.round(((seconds - countdown) / seconds) * 100);

  return (
    <div className="rounded-2xl bg-neutral-900/55 border border-amber-200/15 p-5 relative overflow-hidden animate-[digPulse_1.2s_ease-in-out_infinite]">
      {/* subtle glow */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(251,191,36,0.12),transparent_62%)]" />

      {/* tiny shake to feel like a handheld scanner */}
      <div className="absolute inset-0 pointer-events-none animate-[digShake_0.22s_linear_infinite] opacity-[0.06] bg-[linear-gradient(to_right,rgba(255,255,255,0.25),transparent)]" />

      <div className="relative">
        <div className="text-xl font-semibold">Digging…</div>
        <div className="text-amber-200/80 mt-2 text-sm">{treasure.title}</div>

        <div className="mt-5">
          <div className="h-3 rounded-full bg-neutral-950/35 border border-amber-200/12 overflow-hidden relative">
            <div className="h-full bg-amber-200/80 transition-[width] duration-300 relative" style={{ width: `${pct}%` }}>
              {/* scan sweep on the filled portion */}
              <div className="absolute inset-0 opacity-60 animate-[scanSweep_1.1s_linear_infinite] bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.45),transparent)]" />
              {/* micro-grain */}
              <div className="absolute inset-0 opacity-25 bg-[repeating-linear-gradient(90deg,rgba(0,0,0,0.18)_0px,rgba(0,0,0,0.18)_1px,transparent_2px,transparent_6px)]" />
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between text-xs text-amber-200/70">
            <span className="tabular-nums">{countdown}s</span>
            <span className="tabular-nums">{pct}%</span>
          </div>
        </div>

        <div className="mt-5 text-xs text-amber-200/70">Simulating digging… (mock)</div>
      </div>

      <style jsx>{`
        @keyframes scanSweep {
          0% {
            transform: translateX(-40%);
          }
          100% {
            transform: translateX(140%);
          }
        }
        @keyframes digShake {
          0% {
            transform: translate(0px, 0px);
          }
          25% {
            transform: translate(0.6px, -0.4px);
          }
          50% {
            transform: translate(-0.5px, 0.5px);
          }
          75% {
            transform: translate(0.4px, 0.6px);
          }
          100% {
            transform: translate(0px, 0px);
          }
        }
        @keyframes digPulse {
          0% {
            box-shadow: 0 0 0 rgba(251, 191, 36, 0);
          }
          50% {
            box-shadow: 0 0 0 1px rgba(251, 191, 36, 0.06), 0 10px 35px rgba(0, 0, 0, 0.25);
          }
          100% {
            box-shadow: 0 0 0 rgba(251, 191, 36, 0);
          }
        }
      `}</style>
    </div>
  );
}

function SuccessScreen({
  treasure,
  assets,
  rewardAssetId,
  rewardAmount,
  onBackToFeed,
  onWithdraw,
}: {
  treasure: Treasure;
  assets: Asset[];
  rewardAssetId: string;
  rewardAmount: number;
  onBackToFeed: () => void;
  onWithdraw: () => void;
}) {
  const a = assets.find((x) => x.id === rewardAssetId);

  return (
    <div className="rounded-2xl bg-neutral-900/55 border border-amber-200/15 p-5">
      <div className="text-xl font-semibold">You found treasure</div>
      <div className="text-amber-200/80 mt-2 text-sm">{treasure.title}</div>

      <div className="mt-4 rounded-2xl bg-neutral-950/35 border border-amber-200/12 p-4 space-y-2">
        <div className="text-sm text-amber-200/85">
          Reward:{" "}
          <span className="text-amber-50 font-semibold">{fmtAmount(rewardAmount, a?.decimals ?? 6)}</span>{" "}
          {a ? a.symbol : rewardAssetId}
        </div>

        <div className="text-xs text-amber-200/75 leading-relaxed">
          Stored as <span className="font-semibold text-amber-100">unwithdrawn tokens</span> until you withdraw.
          <br />
          You can safely go <span className="font-semibold">Back</span> and withdraw later, or withdraw now.
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <button
          onClick={onBackToFeed}
          className="rounded-2xl bg-neutral-900/30 border border-amber-200/18 text-amber-50 font-semibold py-3 hover:border-amber-200/32 active:scale-[0.99]"
        >
          Back
        </button>
        <button
          onClick={onWithdraw}
          className="rounded-2xl bg-amber-200 text-neutral-950 font-semibold py-3 active:scale-[0.99]"
        >
          Withdraw
        </button>
      </div>
    </div>
  );
}

/* =======================
   WITHDRAW
======================= */

function WithdrawScreen({
  wallet,
  assets,
  ledger,
  onBack,
  onConnect,
  onWithdraw,
}: {
  wallet: WalletState | null;
  assets: Asset[];
  ledger: Ledger;
  onBack: () => void;
  onConnect: () => void;
  onWithdraw: () => void;
}) {
  const rows = Object.entries(ledger).filter(([, amt]) => amt > 0);

  const preview = useMemo(() => {
    if (!wallet || rows.length === 0) return [];

    return rows.map(([assetId, amt]) => {
      const a = assets.find((x) => x.id === assetId);
      const chain = a?.chain ?? "Base";
      const to = wallet.address;

      const seed = `${wallet.address}:${assetId}:${amt}:${chain}`;
      const tx = stableMockTx(chain, seed);

      const canSend =
        (chain === "Solana" && wallet.chain === "Solana") || (chain !== "Solana" && wallet.chain === "EVM");

      return {
        assetId,
        amt,
        asset: a,
        chain,
        to,
        tx,
        txLink: explorerTxLink(chain, tx),
        canSend,
      };
    });
  }, [wallet, rows, assets]);

  return (
    <div className="rounded-2xl bg-neutral-900/55 border border-amber-200/15 p-5">
      <button onClick={onBack} className="text-xs text-amber-200/80 hover:text-amber-100 underline underline-offset-4">
        ← Back
      </button>

      <div className="mt-3 text-xl font-semibold">Withdraw</div>
      <div className="text-xs text-amber-200/70 mt-2">Connect a wallet to withdraw your unclaimed rewards (mock).</div>

      {!wallet ? (
        <button
          onClick={onConnect}
          className="mt-5 w-full rounded-2xl bg-amber-200 text-neutral-950 font-semibold py-4 active:scale-[0.99]"
        >
          Connect Wallet (mock)
        </button>
      ) : (
        <div className="mt-5 rounded-2xl bg-neutral-950/35 border border-amber-200/12 p-4">
          <div className="text-sm font-semibold">Connected</div>
          <div className="text-xs text-amber-200/75 mt-1">{shortAddr(wallet.address)}</div>
          <div className="mt-1 text-[11px] text-amber-200/55">Wallet type: {wallet.chain}</div>
        </div>
      )}

      {/* Receipts UX: current balances */}
      <div className="mt-4 rounded-2xl bg-neutral-950/35 border border-amber-200/12 p-4">
        <div className="text-sm font-semibold">Unwithdrawn rewards</div>
        <div className="mt-3 space-y-2">
          {rows.length === 0 ? (
            <div className="text-sm text-amber-200/80">None yet.</div>
          ) : (
            rows.map(([assetId, amt]) => {
              const a = assets.find((x) => x.id === assetId);
              return (
                <div key={assetId} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm text-amber-50">{a ? `${a.symbol} (${a.chain})` : assetId}</div>
                  </div>
                  <div className="text-sm font-semibold text-amber-50 tabular-nums">
                    {fmtAmount(amt, a?.decimals ?? 6)}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Withdraw preview (per-chain receipts) */}
      {wallet && rows.length > 0 && (
        <div className="mt-4 rounded-2xl bg-neutral-950/35 border border-amber-200/12 p-4">
          <div className="text-sm font-semibold">Withdraw preview</div>
          <div className="mt-2 text-[11px] text-amber-200/65">
            This is a mock receipt preview. In production, each chain produces an onchain tx + explorer receipt.
          </div>

          <div className="mt-3 space-y-3">
            {preview.map((p) => (
              <div key={p.assetId} className="rounded-xl border border-amber-200/12 bg-neutral-950/25 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-amber-50">
                      {p.asset ? `${p.asset.symbol} (${p.chain})` : p.assetId}
                    </div>
                    <div className="mt-1 text-xs text-amber-200/75">
                      To: <span className="font-semibold text-amber-100">{shortAddr(p.to)}</span>
                    </div>
                    <div className="mt-1 text-xs text-amber-200/75">
                      Amount:{" "}
                      <span className="font-semibold text-amber-100 tabular-nums">
                        {fmtAmount(p.amt, p.asset?.decimals ?? 6)}
                      </span>
                    </div>

                    {!p.canSend && (
                      <div className="mt-2 text-[11px] text-amber-200/70">
                        ⚠ Wallet type mismatch for this chain. (EVM wallet can’t receive Solana tokens and vice versa.)
                      </div>
                    )}
                  </div>

                  <a
                    href={p.txLink}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-xs text-amber-200/80 underline underline-offset-4 hover:text-amber-100"
                    title="Explorer receipt (mock)"
                  >
                    View receipt
                  </a>
                </div>

                <div className="mt-2 text-[11px] text-amber-200/55 break-all">Tx: {shortAddr(p.tx)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={onWithdraw}
        disabled={!wallet || rows.length === 0}
        className={`mt-5 w-full rounded-2xl font-semibold py-4 active:scale-[0.99] ${wallet && rows.length > 0
          ? "bg-amber-200 text-neutral-950"
          : "bg-neutral-900/40 text-amber-200/40 cursor-not-allowed"
          }`}
      >
        Withdraw all (mock)
      </button>

      <div className="mt-3 text-xs text-amber-200/65">
        In production: per-chain withdrawals with onchain receipts + explorer links.
      </div>
    </div>
  );
}

/* =======================
   PROOF / STATS
======================= */

function ProofScreen({
  assets,
  proof,
  sponsorPoolsByAsset,
  usddd,
  usdddMinted,
  usdddSpent,
  usdddTransferred,
  usdddBurned,
  digCount,
  ledger,
  onBack,
  onReset,
  sessionId,
  dailyKey,
  digsToday,
  dailyCap,
  cooldownSeconds,
}: {
  assets: Asset[];
  proof: {
    treasury: { label: string; chain: Chain; address: string };
    sponsorPools: SponsorPool[];
    lastProofTx: { label: string; chain: Chain; tx: string };
  };
  sponsorPoolsByAsset: Record<string, SponsorPool>;
  usddd: number;
  usdddMinted: number;
  usdddSpent: number;
  usdddTransferred: number;
  usdddBurned: number;
  digCount: number;
  ledger: Ledger;
  onBack: () => void;
  onReset: () => void;

  sessionId: string;
  dailyKey: string;
  digsToday: number;
  dailyCap: number;
  cooldownSeconds: number;
}) {
  const rows = Object.entries(ledger).filter(([, amt]) => amt > 0);
  const digsLeft = Math.max(0, dailyCap - digsToday);

  return (
    <div className="rounded-2xl bg-neutral-900/55 border border-amber-200/15 p-5">
      <button onClick={onBack} className="text-xs text-amber-200/80 hover:text-amber-100 underline underline-offset-4">
        ← Back
      </button>

      <div className="mt-3 text-xl font-semibold">Stats</div>
      <div className="text-xs text-amber-200/70 mt-2">Wallets, receipts and stats (mock).</div>

      <div className="mt-4 rounded-2xl bg-neutral-950/35 border border-amber-200/12 p-4">
        <div className="text-sm font-semibold">Walletless limits (local)</div>
        <div className="mt-2 text-xs text-amber-200/75 space-y-1">
          <div>
            • Session: <span className="font-semibold text-amber-100 tabular-nums">{shortAddr(sessionId)}</span>
          </div>
          <div>
            • Day: <span className="font-semibold text-amber-100 tabular-nums">{dailyKey}</span>
          </div>
          <div>
            • Daily digs:{" "}
            <span className="font-semibold text-amber-100 tabular-nums">
              {digsToday}/{dailyCap}
            </span>{" "}
            (left {digsLeft})
          </div>
          <div>
            • Cooldown: <span className="font-semibold text-amber-100 tabular-nums">{cooldownSeconds}s</span> per treasure
          </div>
        </div>
        <div className="mt-3 text-[11px] text-amber-200/55">
          Note: this is walletless + local only (mock). In production, server-side rules apply.
        </div>
      </div>

      <div className="mt-4 rounded-2xl bg-neutral-950/35 border border-amber-200/12 p-4">
        <div className="text-sm font-semibold">{proof.treasury.label}</div>
        <a
          className="text-xs text-amber-200/80 underline underline-offset-4 hover:text-amber-100"
          href={explorerAddressLink(proof.treasury.chain, proof.treasury.address)}
          target="_blank"
          rel="noreferrer"
        >
          {shortAddr(proof.treasury.address)} • {proof.treasury.chain} explorer
        </a>
      </div>

      <div className="mt-4 rounded-2xl bg-neutral-950/35 border border-amber-200/12 p-4">
        <div className="text-sm font-semibold">Sponsor pools</div>
        <div className="mt-3 space-y-2">
          {proof.sponsorPools.map((p) => {
            const a = assets.find((x) => x.id === p.assetId);
            const label = a ? `${a.symbol} (${a.chain})` : p.assetId;
            return (
              <div key={p.assetId} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-amber-50">{label}</div>
                  <a
                    className="text-xs text-amber-200/80 underline underline-offset-4 hover:text-amber-100"
                    href={explorerAddressLink(a?.chain ?? "Base", p.address)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortAddr(p.address)}
                  </a>
                </div>
                <div className="text-sm font-semibold text-amber-50 tabular-nums">{p.balance.toLocaleString()}</div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 rounded-2xl bg-neutral-950/35 border border-amber-200/12 p-4">
          <div className="text-sm font-semibold">{proof.lastProofTx.label}</div>
          <a
            className="text-xs text-amber-200/80 underline underline-offset-4 hover:text-amber-100"
            href={explorerTxLink(proof.lastProofTx.chain, proof.lastProofTx.tx)}
            target="_blank"
            rel="noreferrer"
          >
            {shortAddr(proof.lastProofTx.tx)} • {proof.lastProofTx.chain} tx
          </a>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-neutral-950/35 border border-amber-200/12 p-4">
          <div className="text-xs text-amber-200/70">Credits</div>
          <div className="mt-1 text-lg font-semibold tabular-nums">{usddd.toFixed(2)}</div>
        </div>
        <div className="rounded-2xl bg-neutral-950/35 border border-amber-200/12 p-4">
          <div className="text-xs text-amber-200/70">Digs</div>
          <div className="mt-1 text-lg font-semibold tabular-nums">{digCount}</div>
        </div>
        <div className="rounded-2xl bg-neutral-950/35 border border-amber-200/12 p-4">
          <div className="text-xs text-amber-200/70">Credits minted</div>
          <div className="mt-1 text-lg font-semibold tabular-nums">{usdddMinted.toFixed(2)}</div>
        </div>
        <div className="rounded-2xl bg-neutral-950/35 border border-amber-200/12 p-4">
          <div className="text-xs text-amber-200/70">Credits spent</div>
          <div className="mt-1 text-lg font-semibold tabular-nums">{usdddSpent.toFixed(2)}</div>
        </div>
        <div className="rounded-2xl bg-neutral-950/35 border border-amber-200/12 p-4">
          <div className="text-xs text-amber-200/70">Credits burned</div>
          <div className="mt-1 text-lg font-semibold tabular-nums">{usdddBurned.toFixed(2)}</div>
        </div>
        <div className="rounded-2xl bg-neutral-950/35 border border-amber-200/12 p-4">
          <div className="text-xs text-amber-200/70">Withdrawals</div>
          <div className="mt-1 text-lg font-semibold tabular-nums">{usdddTransferred}</div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl bg-neutral-950/35 border border-amber-200/12 p-4">
        <div className="text-sm font-semibold">Unwithdrawn rewards</div>
        <div className="mt-3 space-y-2">
          {rows.length === 0 ? (
            <div className="text-sm text-amber-200/80">None yet.</div>
          ) : (
            rows.map(([assetId, amt]) => {
              const a = assets.find((x) => x.id === assetId);
              const pool = sponsorPoolsByAsset[assetId];
              return (
                <div key={assetId} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm text-amber-50">{a ? `${a.symbol} (${a.chain})` : assetId}</div>
                    {pool && <div className="text-xs text-amber-200/70">Pool balance: {pool.balance.toLocaleString()}</div>}
                  </div>
                  <div className="text-sm font-semibold text-amber-50 tabular-nums">{fmtAmount(amt, a?.decimals ?? 6)}</div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

/* =======================
   ADMIN
======================= */

function AdminLogin({
  pin,
  setPin,
  onSubmit,
  onCancel,
}: {
  pin: string;
  setPin: (s: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-2xl bg-neutral-900/55 border border-amber-200/15 p-5">
      <div className="text-xl font-semibold">Operator Login</div>
      <div className="text-xs text-amber-200/70 mt-1">Enter operator PIN</div>
      <input
        type="password"
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        className="mt-4 w-full rounded-xl border border-amber-200/18 bg-neutral-950/40 px-4 py-3 text-amber-50 outline-none"
        placeholder="PIN"
      />
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          onClick={onCancel}
          className="rounded-2xl bg-neutral-900/30 border border-amber-200/18 text-amber-50 font-semibold py-3"
        >
          Cancel
        </button>
        <button
          onClick={onSubmit}
          className="rounded-2xl bg-amber-200 text-neutral-950 font-semibold py-3"
        >
          Enter
        </button>
      </div>
    </div>
  );
}

function AdminScreen({
  treasures,
  setTreasures,
  usddd,
  setUsddd,
  setUsdddMinted,
  setUsdddBurned,
  digCount,
  siteLive,
  setSiteLive,
  onResetDemo,
  onExit,
}: {
  treasures: Treasure[];
  setTreasures: (t: Treasure[]) => void;
  usddd: number;
  setUsddd: (n: number | ((v: number) => number)) => void;
  setUsdddMinted: (n: number | ((v: number) => number)) => void;
  setUsdddBurned: (n: number | ((v: number) => number)) => void;
  digCount: number;
  siteLive: boolean;
  setSiteLive: (b: boolean | ((v: boolean) => boolean)) => void;
  onResetDemo: () => void;
  onExit: () => void;
}) {
  const [mintAmt, setMintAmt] = useState(10);
  const [burnAmt, setBurnAmt] = useState(10);

  const [draft, setDraft] = useState<Record<string, { digCostUSDDD: number; ends: string }>>(() => {
    const out: Record<string, { digCostUSDDD: number; ends: string }> = {};
    for (const t of treasures) out[t.id] = { digCostUSDDD: t.digCostUSDDD, ends: t.ends };
    return out;
  });

  useEffect(() => {
    setDraft((prev) => {
      const next = { ...prev };
      for (const t of treasures) {
        next[t.id] = next[t.id] || { digCostUSDDD: t.digCostUSDDD, ends: t.ends };
      }
      return next;
    });
  }, [treasures]);

  function applyTreasureEdits(id: string) {
    const d = draft[id];
    if (!d) return;
    setTreasures(
      treasures.map((t) =>
        t.id === id
          ? {
            ...t,
            digCostUSDDD: Math.max(0, Number.isFinite(d.digCostUSDDD) ? d.digCostUSDDD : t.digCostUSDDD),
            ends: (d.ends || "").trim() || t.ends,
          }
          : t
      )
    );
  }

  function togglePause(id: string) {
    setTreasures(treasures.map((t) => (t.id === id ? { ...t, paused: !t.paused } : t)));
  }

  function mintCredits() {
    const amt = Math.max(0, Number(mintAmt) || 0);
    if (!amt) return;
    setUsddd((v) => Math.round((v + amt) * 100) / 100);
    setUsdddMinted((m) => Math.round((m + amt) * 100) / 100);
  }

  function burnCredits() {
    const amt = Math.max(0, Number(burnAmt) || 0);
    if (!amt) return;
    setUsddd((v) => Math.round(Math.max(0, v - amt) * 100) / 100);
    setUsdddBurned((b) => Math.round((b + amt) * 100) / 100);
  }

  const input =
    "w-full rounded-xl border border-amber-200/18 bg-neutral-950/40 px-3 py-2 text-amber-50 outline-none text-sm";

  const btn =
    "rounded-xl border border-amber-200/18 bg-neutral-950/25 px-3 py-2 text-xs font-semibold text-amber-50 hover:border-amber-200/32 active:scale-[0.99]";
  const btnPrimary = "rounded-xl bg-amber-200 text-neutral-950 text-xs font-semibold px-3 py-2 active:scale-[0.99]";

  return (
    <div className="rounded-2xl bg-neutral-900/55 border border-amber-200/15 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xl font-semibold">Operator Panel</div>
        <button onClick={onExit} className="text-xs text-amber-200/80 underline">
          Exit
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-neutral-950/35 border border-amber-200/12 p-4">
          <div className="text-xs text-amber-200/70">Total USDDD</div>
          <div className="text-lg font-semibold tabular-nums">{usddd.toFixed(2)}</div>
        </div>
        <div className="rounded-xl bg-neutral-950/35 border border-amber-200/12 p-4">
          <div className="text-xs text-amber-200/70">Total digs</div>
          <div className="text-lg font-semibold tabular-nums">{digCount}</div>
        </div>
      </div>

      <div className="rounded-2xl bg-neutral-950/35 border border-amber-200/12 p-4">
        <div className="rounded-2xl border border-amber-200/12 bg-neutral-950/30 p-4">
          <div className="text-sm font-semibold">Site controls</div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="text-[11px] text-amber-200/70">
              Site mode: <span className="font-semibold text-amber-100">{siteLive ? "LIVE" : "COMING SOON"}</span>
            </div>
            <button
              className={btn}
              onClick={() => {
                const next = !siteLive;
                if (!confirm(`Switch site to ${next ? "LIVE" : "COMING SOON"}?`)) return;
                setSiteLive(next);
              }}
            >
              Toggle
            </button>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="text-[11px] text-amber-200/70">Reset demo data (operator only)</div>
            <button
              className={btn}
              onClick={() => {
                if (!confirm("Reset ALL demo data? This clears credits, ledger, treasures, and returns to Coming Soon.")) return;
                onResetDemo();
              }}
            >
              Reset demo data
            </button>
          </div>
        </div>

        <div className="text-sm font-semibold">USDDD controls (mock)</div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <div className="text-[11px] text-amber-200/70">Mint credits</div>
            <input className={input} type="number" min={0} step={0.01} value={mintAmt} onChange={(e) => setMintAmt(Number(e.target.value))} />
            <button className={btnPrimary} onClick={mintCredits}>Mint</button>
          </div>
          <div className="space-y-2">
            <div className="text-[11px] text-amber-200/70">Burn credits</div>
            <input className={input} type="number" min={0} step={0.01} value={burnAmt} onChange={(e) => setBurnAmt(Number(e.target.value))} />
            <button className={btn} onClick={burnCredits}>Burn</button>
          </div>
        </div>
        <div className="mt-3 text-[11px] text-amber-200/55">
          Note: Mint/Burn is UI-only in this demo. Later we swap to wallet-based operator auth + onchain/admin calls.
        </div>
      </div>

      <div className="rounded-2xl bg-neutral-950/35 border border-amber-200/12 p-4">
        <div className="text-sm font-semibold mb-2">Treasure controls</div>
        <div className="space-y-4">
          {treasures.map((t) => {
            const d = draft[t.id] || { digCostUSDDD: t.digCostUSDDD, ends: t.ends };
            return (
              <div key={t.id} className="rounded-2xl border border-amber-200/12 bg-neutral-950/20 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-amber-50">{t.title}</div>
                    <div className="mt-1 text-[11px] text-amber-200/65">
                      Remaining: <span className="font-semibold text-amber-100 tabular-nums">{fmtInt(t.remaining)}</span>{" "}
                      • Status:{" "}
                      <span className={`font-semibold ${t.paused ? "text-amber-200" : "text-amber-100"}`}>
                        {t.paused ? "Paused" : "Live"}
                      </span>
                    </div>
                  </div>
                  <button className={btn} onClick={() => togglePause(t.id)}>
                    {t.paused ? "Resume" : "Pause"}
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[11px] text-amber-200/70">Dig cost (USDDD)</div>
                    <input
                      className={input}
                      type="number"
                      min={0}
                      step={0.01}
                      value={d.digCostUSDDD}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          [t.id]: { ...(prev[t.id] || d), digCostUSDDD: Number(e.target.value) },
                        }))
                      }
                    />
                  </div>
                  <div>
                    <div className="text-[11px] text-amber-200/70">Ends (label)</div>
                    <input
                      className={input}
                      value={d.ends}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          [t.id]: { ...(prev[t.id] || d), ends: e.target.value },
                        }))
                      }
                      placeholder="e.g. 6h 05m"
                    />
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between gap-3">
                  <button className={btn} onClick={() => setTreasures(treasures.map((x) => (x.id === t.id ? { ...x, remaining: x.remaining + 100 } : x)))}>
                    +100 remaining
                  </button>
                  <button className={btnPrimary} onClick={() => applyTreasureEdits(t.id)}>
                    Save changes
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
