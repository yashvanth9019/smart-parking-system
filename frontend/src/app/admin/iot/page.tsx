"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Brain, Cpu, Play, RefreshCw, Square } from "lucide-react";
import { api } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { SidebarLayout } from "@/components/SidebarLayout";
import { OccupancyForecastLineChart, RevenueTrendBarChart } from "@/components/Charts";
import type { OccupancyForecastPoint } from "@/types";

export default function AdminIoTAndMLPage() {
  const { pushToast, subscribeWSEvents } = useApp();
  const [autoSim, setAutoSim] = useState(false);
  const [logs, setLogs] = useState<Array<Record<string, unknown>>>([]);
  const [revForecast, setRevForecast] = useState<Array<{ date: string; day_name: string; predicted_total_revenue: number }>>([]);
  const [projectedTotal, setProjectedTotal] = useState(0);
  const [metrics, setMetrics] = useState<Record<string, number | string>>({});
  const [occForecast, setOccForecast] = useState<OccupancyForecastPoint[]>([]);

  const loadData = useCallback(async () => {
    try {
      const [logRes, revRes, occRes] = await Promise.all([
        api.getSensorLogs(25),
        api.getRevenueForecast(7),
        api.getOccupancyForecast(),
      ]);
      setLogs(logRes.logs);
      setRevForecast(revRes.daily_forecast);
      setProjectedTotal(revRes.projected_total_revenue);
      setMetrics(revRes.model_metrics);
      setOccForecast(occRes.forecast);
    } catch {
      // handled on auth guard
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!autoSim) return;
    const timer = setInterval(() => {
      api.simulateBurst(2).catch(() => {});
    }, 4000);
    return () => clearInterval(timer);
  }, [autoSim]);

  useEffect(() => {
    return subscribeWSEvents((msg) => {
      if (msg.event === "admin_activity") {
        api.getSensorLogs(25).then((res) => setLogs(res.logs)).catch(() => {});
      }
    });
  }, [subscribeWSEvents]);

  const handleRetrain = async () => {
    const res = await api.retrainML();
    setMetrics(res.metrics);
    pushToast("ML Models Retrained", `Occupancy R² = ${res.metrics.occupancy_r2}`, "success");
    loadData();
  };

  return (
    <SidebarLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Cpu className="w-6 h-6 text-emerald-500" /> IoT Simulator & ML Predictions
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Live ultrasonic sensor simulation mode + RandomForest & GradientBoosting forecasts.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAutoSim((v) => !v)}
              className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 text-white ${
                autoSim ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-600 hover:bg-emerald-700"
              }`}
            >
              {autoSim ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {autoSim ? "Stop Live Sim" : "Start Auto IoT Sim (4s)"}
            </button>
            <button
              onClick={handleRetrain}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Retrain ML
            </button>
          </div>
        </div>

        {/* ML Metrics Banner */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <div className="text-xs text-slate-500 flex items-center gap-1.5">
              <Brain className="w-4 h-4 text-indigo-500" /> 7-Day Revenue Prediction
            </div>
            <div className="text-2xl font-bold mt-1 text-emerald-500">INR {projectedTotal.toLocaleString()}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <div className="text-xs text-slate-500">Occupancy Model R²</div>
            <div className="text-2xl font-bold mt-1">{metrics.occupancy_r2 ?? "--"}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <div className="text-xs text-slate-500">Revenue Model R²</div>
            <div className="text-2xl font-bold mt-1">{metrics.revenue_r2 ?? "--"}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <div className="text-xs text-slate-500">Training Samples</div>
            <div className="text-2xl font-bold mt-1">{metrics.training_samples_occupancy ?? "--"}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
            <h2 className="font-semibold text-base">ML 7-Day Revenue Forecast (GradientBoosting)</h2>
            <RevenueTrendBarChart
              series={revForecast.map((d) => ({ label: `${d.day_name} (${d.date.slice(5)})`, value: d.predicted_total_revenue }))}
              title="Predicted Revenue (INR)"
            />
          </div>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
            <h2 className="font-semibold text-base">24-Hour Occupancy Forecast (RandomForest)</h2>
            <OccupancyForecastLineChart points={occForecast} />
          </div>
        </div>

        {/* Sensor Telemetry Logs */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
          <h2 className="font-semibold text-base">Latest Ultrasonic Sensor Telemetry (`sensor_logs`)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-2 pr-4">Sensor ID</th>
                  <th className="py-2 pr-4">Location</th>
                  <th className="py-2 pr-4">Slot</th>
                  <th className="py-2 pr-4">Distance</th>
                  <th className="py-2 pr-4">State</th>
                  <th className="py-2">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {logs.map((l) => (
                  <tr key={String(l.id)}>
                    <td className="py-2 pr-4 font-mono">{String(l.sensor_id)}</td>
                    <td className="py-2 pr-4">{String(l.location_name)}</td>
                    <td className="py-2 pr-4 font-bold">{String(l.slot_code)}</td>
                    <td className="py-2 pr-4">{String(l.distance_cm)} cm</td>
                    <td className="py-2 pr-4">
                      {String(l.previous_status)} -&gt; <b>{String(l.new_status)}</b>
                    </td>
                    <td className="py-2 uppercase text-indigo-500 font-semibold">{String(l.source)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </SidebarLayout>
  );
}

