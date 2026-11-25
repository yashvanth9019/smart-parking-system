"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Activity, DollarSign, Radio, RefreshCw, ShieldAlert, TrendingUp } from "lucide-react";
import { api } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { SidebarLayout } from "@/components/SidebarLayout";
import { RevenueTrendBarChart } from "@/components/Charts";
import type { AdminAnalyticsResponse } from "@/types";

export default function AdminDashboardPage() {
  const { user, authLoading, subscribeWSEvents, pushToast } = useApp();
  const [period, setPeriod] = useState<"daily" | "weekly" | "monthly">("daily");
  const [data, setData] = useState<AdminAnalyticsResponse | null>(null);
  const [liveFeed, setLiveFeed] = useState<AdminAnalyticsResponse["activity_feed"]>([]);
  const [loading, setLoading] = useState(true);

  const isAdmin = user?.role === "admin" || user?.role === "superadmin";

  const loadAnalytics = useCallback(async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    try {
      const res = await api.getAdminAnalytics(period);
      setData(res);
      setLiveFeed(res.activity_feed);
    } catch (err) {
      pushToast("Error", err instanceof Error ? err.message : "Failed to load admin analytics", "error");
    } finally {
      setLoading(false);
    }
  }, [isAdmin, period, pushToast]);

  useEffect(() => {
    if (!authLoading) loadAnalytics();
  }, [authLoading, loadAnalytics]);

  useEffect(() => {
    return subscribeWSEvents((msg) => {
      if (msg.event === "admin_activity") {
        const act = msg.data as Record<string, unknown>;
        setLiveFeed((prev) => [
          {
            id: `${Date.now()}`,
            type: String(act.type || "event"),
            slot_code: String(act.slot_code || "--"),
            location_name: String(act.location_name || "Hub"),
            previous_status: String(act.previous_status || ""),
            new_status: String(act.new_status || ""),
            distance_cm: Number(act.distance_cm || 0),
            recorded_at: String(act.recorded_at || new Date().toISOString()),
          },
          ...prev.slice(0, 14),
        ]);
        loadAnalytics();
      } else if (msg.event === "slot_updated") {
        loadAnalytics();
      }
    });
  }, [subscribeWSEvents, loadAnalytics]);

  const handleSimulateBurst = async () => {
    try {
      const res = await api.simulateBurst(3);
      pushToast("IoT Simulation", `Triggered ${res.count} live ultrasonic sensor events`, "info");
    } catch (err) {
      pushToast("Simulation Error", err instanceof Error ? err.message : "Failed", "error");
    }
  };

  if (!authLoading && !isAdmin) {
    return (
      <SidebarLayout>
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-8 text-center space-y-3 max-w-lg mx-auto mt-12">
          <ShieldAlert className="w-10 h-10 text-amber-500 mx-auto" />
          <h2 className="text-lg font-bold">Admin Authentication Required</h2>
          <p className="text-sm text-slate-500">Sign in with an administrator account to access operations and analytics.</p>
          <Link href="/admin/login" className="inline-block px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold">
            Go to Admin Login
          </Link>
        </div>
      </SidebarLayout>
    );
  }

  return (
    <SidebarLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Admin Operations Command Center</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Real-time occupancy monitoring, revenue analytics, and live IoT telemetry.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSimulateBurst}
              className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold flex items-center gap-1.5"
            >
              <Radio className="w-4 h-4" /> Simulate IoT Traffic
            </button>
            <button
              onClick={loadAnalytics}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold flex items-center gap-1"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
          </div>
        </div>

        {loading || !data ? (
          <div className="h-64 rounded-2xl bg-slate-200 dark:bg-slate-800 animate-pulse" />
        ) : (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
                <div className="text-xs text-slate-500 flex items-center justify-between">
                  Total Revenue <DollarSign className="w-4 h-4 text-emerald-500" />
                </div>
                <div className="text-2xl font-bold mt-1">INR {data.kpis.total_revenue.toLocaleString()}</div>
                <div className="text-xs text-emerald-500 mt-1">Today: INR {data.kpis.today_revenue}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
                <div className="text-xs text-slate-500 flex items-center justify-between">
                  Live Occupancy <TrendingUp className="w-4 h-4 text-blue-500" />
                </div>
                <div className="text-2xl font-bold mt-1">{data.kpis.occupancy_pct}%</div>
                <div className="text-xs text-slate-400 mt-1">
                  {data.kpis.available_slots} free / {data.kpis.total_slots} total
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
                <div className="text-xs text-slate-500">Active & Confirmed Bookings</div>
                <div className="text-2xl font-bold mt-1">{data.kpis.active_bookings}</div>
                <div className="text-xs text-slate-400 mt-1">{data.kpis.total_bookings} total historical</div>
              </div>
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
                <div className="text-xs text-slate-500">Registered Drivers</div>
                <div className="text-2xl font-bold mt-1">{data.kpis.total_users}</div>
                <div className="text-xs text-slate-400 mt-1">{data.kpis.total_locations} managed hubs</div>
              </div>
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-base">Revenue Analytics</h2>
                  <div className="flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1 text-xs font-semibold">
                    {(["daily", "weekly", "monthly"] as const).map((p) => (
                      <button
                        key={p}
                        onClick={() => setPeriod(p)}
                        className={`px-2.5 py-1 rounded-lg capitalize ${
                          period === p ? "bg-white dark:bg-slate-700 shadow-sm" : "text-slate-500"
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
                <RevenueTrendBarChart
                  series={data.trend_series.map((s) => ({ label: s.label, value: s.revenue }))}
                  title="Revenue (INR)"
                />
              </div>

              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
                <h2 className="font-semibold text-base">Revenue by Parking Location</h2>
                <RevenueTrendBarChart
                  series={data.revenue_by_location.map((l) => ({ label: l.location_name.split(" ").slice(0, 2).join(" "), value: l.revenue }))}
                  title="Hub Revenue (INR)"
                  color="rgba(99, 102, 241, 0.85)"
                />
              </div>
            </div>

            {/* Real-Time Activity Stream */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-base flex items-center gap-2">
                  <Activity className="w-4 h-4 text-emerald-500" /> Real-Time Parking Activity Feed
                </h2>
                <span className="text-xs text-slate-400">Live WebSocket stream</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-slate-400 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-2 pr-4">Event Source</th>
                      <th className="py-2 pr-4">Location</th>
                      <th className="py-2 pr-4">Slot</th>
                      <th className="py-2 pr-4">Transition</th>
                      <th className="py-2 pr-4">Sensor</th>
                      <th className="py-2">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {liveFeed.map((item) => (
                      <tr key={item.id}>
                        <td className="py-2.5 pr-4 font-semibold uppercase text-indigo-500">{item.type}</td>
                        <td className="py-2.5 pr-4">{item.location_name}</td>
                        <td className="py-2.5 pr-4 font-mono font-bold">{item.slot_code}</td>
                        <td className="py-2.5 pr-4">
                          {item.previous_status ? `${item.previous_status} -> ${item.new_status}` : item.new_status || "--"}
                        </td>
                        <td className="py-2.5 pr-4">{item.distance_cm ? `${item.distance_cm} cm` : "--"}</td>
                        <td className="py-2.5 text-slate-400">{new Date(item.recorded_at).toLocaleTimeString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </SidebarLayout>
  );
}

