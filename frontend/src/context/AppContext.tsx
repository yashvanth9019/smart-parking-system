"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api, WS_BASE } from "@/lib/api";
import type { AppNotification, ParkingSlot, UserProfile } from "@/types";

export interface WSEventMessage {
  event: string;
  data: Record<string, unknown>;
  timestamp?: string;
}

interface ToastItem {
  id: string;
  title: string;
  message: string;
  tone: "info" | "success" | "warning" | "error";
}

interface AppContextValue {
  user: UserProfile | null;
  token: string | null;
  authLoading: boolean;
  theme: "light" | "dark";
  toggleTheme: () => void;
  setSession: (token: string, user: UserProfile) => void;
  refreshUser: () => Promise<void>;
  logout: () => void;
  wsConnected: boolean;
  notifications: AppNotification[];
  unreadCount: number;
  refreshNotifications: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  subscribeWSEvents: (listener: (msg: WSEventMessage) => void) => () => void;
  pushToast: (title: string, message: string, tone?: ToastItem["tone"]) => void;
  latestSlotEvent: ParkingSlot | null;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [wsConnected, setWsConnected] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [latestSlotEvent, setLatestSlotEvent] = useState<ParkingSlot | null>(null);

  const listenersRef = useRef<Set<(msg: WSEventMessage) => void>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pushToast = useCallback((title: string, message: string, tone: ToastItem["tone"] = "info") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [{ id, title, message, tone }, ...prev].slice(0, 4));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  // Theme initialization
  useEffect(() => {
    const saved = localStorage.getItem("smartpark_theme") as "light" | "dark" | null;
    const initial = saved || "dark";
    setTheme(initial);
    document.documentElement.classList.toggle("dark", initial === "dark");
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem("smartpark_theme", next);
      document.documentElement.classList.toggle("dark", next === "dark");
      return next;
    });
  }, []);

  const refreshNotifications = useCallback(async () => {
    const storedToken = localStorage.getItem("smartpark_token");
    if (!storedToken) return;
    try {
      const res = await api.getNotifications();
      setNotifications(res.notifications);
      setUnreadCount(res.unread_count);
    } catch {
      // Ignore if unauthenticated
    }
  }, []);

  const refreshUser = useCallback(async () => {
    const storedToken = localStorage.getItem("smartpark_token");
    if (!storedToken) {
      setUser(null);
      setToken(null);
      setAuthLoading(false);
      return;
    }
    try {
      const res = await api.getProfile();
      setUser(res.user);
      setToken(storedToken);
      localStorage.setItem("smartpark_user", JSON.stringify(res.user));
      await refreshNotifications();
    } catch {
      localStorage.removeItem("smartpark_token");
      localStorage.removeItem("smartpark_user");
      setUser(null);
      setToken(null);
    } finally {
      setAuthLoading(false);
    }
  }, [refreshNotifications]);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const setSession = useCallback(
    (newToken: string, newUser: UserProfile) => {
      localStorage.setItem("smartpark_token", newToken);
      localStorage.setItem("smartpark_user", JSON.stringify(newUser));
      setToken(newToken);
      setUser(newUser);
      refreshNotifications();
    },
    [refreshNotifications]
  );

  const logout = useCallback(() => {
    localStorage.removeItem("smartpark_token");
    localStorage.removeItem("smartpark_user");
    setToken(null);
    setUser(null);
    setNotifications([]);
    setUnreadCount(0);
  }, []);

  const markRead = useCallback(async (id: string) => {
    await api.markNotificationRead(id);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
  }, []);

  const markAllRead = useCallback(async () => {
    await api.markAllNotificationsRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);
  }, []);

  const subscribeWSEvents = useCallback((listener: (msg: WSEventMessage) => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  // Live WebSocket connection with automatic reconnect
  useEffect(() => {
    let active = true;

    const connect = () => {
      if (!active) return;
      const wsToken = localStorage.getItem("smartpark_token");
      const url = `${WS_BASE}/ws/parking${wsToken ? `?token=${encodeURIComponent(wsToken)}` : ""}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!active) return;
        setWsConnected(true);
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data) as WSEventMessage;
          if (msg.event === "slot_updated" && msg.data?.slot) {
            setLatestSlotEvent(msg.data.slot as ParkingSlot);
          }
          if (msg.event === "notification" && msg.data) {
            const notif = msg.data as unknown as AppNotification;
            setNotifications((prev) => [notif, ...prev].slice(0, 40));
            setUnreadCount((c) => c + 1);
            const tone =
              notif.type === "expiry_alert"
                ? "warning"
                : notif.type === "booking_cancelled"
                ? "info"
                : "success";
            pushToast(notif.title, notif.message, tone);
          }
          listenersRef.current.forEach((cb) => cb(msg));
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (!active) return;
        setWsConnected(false);
        reconnectTimerRef.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();
    const pingTimer = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ action: "ping" }));
      }
    }, 25000);

    return () => {
      active = false;
      clearInterval(pingTimer);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [token, pushToast]);

  return (
    <AppContext.Provider
      value={{
        user,
        token,
        authLoading,
        theme,
        toggleTheme,
        setSession,
        refreshUser,
        logout,
        wsConnected,
        notifications,
        unreadCount,
        refreshNotifications,
        markRead,
        markAllRead,
        subscribeWSEvents,
        pushToast,
        latestSlotEvent,
      }}
    >
      {children}
      {/* Floating Real-Time Toast Stack */}
      <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-xl border p-3.5 shadow-xl backdrop-blur-md transition-all ${
              t.tone === "success"
                ? "bg-emerald-950/90 border-emerald-500/50 text-emerald-50"
                : t.tone === "warning"
                ? "bg-amber-950/90 border-amber-500/50 text-amber-50"
                : t.tone === "error"
                ? "bg-rose-950/90 border-rose-500/50 text-rose-50"
                : "bg-slate-900/95 border-slate-700 text-slate-100"
            }`}
          >
            <div className="text-xs font-semibold uppercase tracking-wide opacity-90">{t.title}</div>
            <div className="text-sm mt-0.5 leading-snug">{t.message}</div>
          </div>
        ))}
      </div>
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}

