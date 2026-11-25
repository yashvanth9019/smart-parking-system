"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  BarChart3,
  Bell,
  Car,
  CheckCheck,
  LayoutDashboard,
  LogIn,
  LogOut,
  MapPin,
  Menu,
  Moon,
  QrCode,
  ShieldCheck,
  Sun,
  Ticket,
  User,
  X,
} from "lucide-react";
import { useApp } from "@/context/AppContext";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

export function SidebarLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, theme, toggleTheme, logout, wsConnected, notifications, unreadCount, markRead, markAllRead } = useApp();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  const isAdmin = user?.role === "admin" || user?.role === "superadmin";

  const userNav: NavItem[] = [
    { href: "/", label: "Live Dashboard", icon: <LayoutDashboard className="w-4 h-4" /> },
    { href: "/bookings", label: "My Bookings & QR", icon: <Ticket className="w-4 h-4" /> },
    { href: "/analytics", label: "ML Forecast", icon: <BarChart3 className="w-4 h-4" /> },
    { href: "/profile", label: "Profile & Vehicle", icon: <User className="w-4 h-4" /> },
  ];

  const adminNav: NavItem[] = [
    { href: "/admin", label: "Admin Command", icon: <ShieldCheck className="w-4 h-4" /> },
    { href: "/admin/locations", label: "Locations & Slots", icon: <MapPin className="w-4 h-4" /> },
    { href: "/admin/bookings", label: "All Bookings & QR Gate", icon: <QrCode className="w-4 h-4" /> },
    { href: "/admin/iot", label: "IoT & ML Analytics", icon: <Activity className="w-4 h-4" /> },
    { href: "/", label: "Public Live View", icon: <LayoutDashboard className="w-4 h-4" /> },
  ];

  const navItems = isAdmin ? adminNav : userNav;

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors">
      {/* Mobile Sidebar Backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-64 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col transition-transform duration-200 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="h-16 px-5 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
          <Link href={isAdmin ? "/admin" : "/"} className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
              <Car className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-base tracking-tight leading-none">SmartPark RTD</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {isAdmin ? "Admin Control" : "Real-Time Parking"}
              </div>
            </div>
          </Link>
          <button
            className="lg:hidden p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  active
                    ? "bg-blue-600 text-white shadow-sm shadow-blue-600/25"
                    : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/80"
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </Link>
            );
          })}

          {!isAdmin && (
            <div className="pt-4 mt-4 border-t border-slate-200 dark:border-slate-800">
              <Link
                href="/admin/login"
                className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Admin Portal</span>
              </Link>
            </div>
          )}
        </nav>

        {/* Slot Legend & User Card */}
        <div className="p-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
          <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3 text-xs space-y-1.5">
            <div className="font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-[10px]">
              Live Slot Legend
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Available
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500" /> Occupied
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> Reserved
              </span>
            </div>
          </div>

          {user ? (
            <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-slate-100 dark:bg-slate-800/80">
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{user.name}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {user.vehicle_number || user.role.toUpperCase()}
                </div>
              </div>
              <button
                onClick={() => {
                  logout();
                  router.push("/login");
                }}
                title="Sign out"
                className="p-2 rounded-lg text-slate-500 hover:text-rose-500 hover:bg-white dark:hover:bg-slate-700 transition-colors"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
            >
              <LogIn className="w-4 h-4" /> Sign In / Register
            </Link>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="h-16 sticky top-0 z-30 border-b border-slate-200 dark:border-slate-800 bg-white/85 dark:bg-slate-900/85 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              className="lg:hidden p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-xs font-medium px-2.5 py-1 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
              <span
                className={`w-2 h-2 rounded-full ${
                  wsConnected ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
                }`}
              />
              <span>{wsConnected ? "RTD WebSocket Live" : "Reconnecting..."}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 relative">
            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              aria-label="Toggle theme"
              className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              {theme === "dark" ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-700" />}
            </button>

            {/* Notification Bell */}
            {user && (
              <div className="relative">
                <button
                  onClick={() => setNotifOpen((o) => !o)}
                  className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors relative"
                >
                  <Bell className="w-4 h-4" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </button>

                {notifOpen && (
                  <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl z-50 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                      <span className="font-semibold text-sm">Real-Time Alerts</span>
                      <button
                        onClick={markAllRead}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                      >
                        <CheckCheck className="w-3.5 h-3.5" /> Mark all read
                      </button>
                    </div>
                    <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                      {notifications.length === 0 ? (
                        <div className="p-6 text-center text-sm text-slate-500">No notifications yet.</div>
                      ) : (
                        notifications.slice(0, 15).map((n) => (
                          <div
                            key={n.id}
                            onClick={() => !n.is_read && markRead(n.id)}
                            className={`p-3.5 cursor-pointer transition-colors ${
                              n.is_read
                                ? "opacity-70 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                                : "bg-blue-50/60 dark:bg-blue-950/20 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">{n.title}</span>
                              {!n.is_read && <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />}
                            </div>
                            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">{n.message}</p>
                            <p className="text-[10px] text-slate-400 mt-1">
                              {new Date(n.created_at).toLocaleString()}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}

