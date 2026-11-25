"use client";

import React, { useEffect, useState } from "react";
import { Brain, Clock, TrendingUp } from "lucide-react";
import { api } from "@/lib/api";
import { SidebarLayout } from "@/components/SidebarLayout";
import { OccupancyForecastLineChart, PeakHoursBarChart } from "@/components/Charts";
import type { OccupancyForecastPoint, ParkingLocation, PeakHourPoint } from "@/types";

export default function MLForecastPage() {
  const [locations, setLocations] = useState<ParkingLocation[]>([]);
  const [selectedLocId, setSelectedLocId] = useState<string>("");
  const [forecast, setForecast] = useState<OccupancyForecastPoint[]>([]);
  const [bestTime, setBestTime] = useState<string>("--");
  const [peakTime, setPeakTime] = useState<string>("--");
  const [peakPct, setPeakPct] = useState<number>(0);
  const [peakProfile, setPeakProfile] = useState<PeakHourPoint[]>([]);
  const [topPeakHours, setTopPeakHours] = useState<string[]>([]);
  const [offPeakHours, setOffPeakHours] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getLocations().then((res) => {
      setLocations(res.locations);
      if (res.locations.length > 0) setSelectedLocId(res.locations[0].id);
    });
  }, []);

  useEffect(() => {
    if (!selectedLocId) return;
    setLoading(true);
    Promise.all([api.getOccupancyForecast(selectedLocId), api.getPeakHours(selectedLocId)])
      .then(([occRes, peakRes]) => {
        setForecast(occRes.forecast);
        setBestTime(occRes.best_time_to_park);
        setPeakTime(occRes.peak_time);
        setPeakPct(occRes.peak_occupancy_pct);
        setPeakProfile(peakRes.hourly_profile);
        setTopPeakHours(peakRes.top_peak_hours);
        setOffPeakHours(peakRes.off_peak_hours);
      })
      .finally(() => setLoading(false));
  }, [selectedLocId]);

  return (
    <SidebarLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Brain className="w-6 h-6 text-indigo-500" /> ML Occupancy & Peak-Hour Forecast
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              RandomForest demand forecasting to help drivers avoid congestion and find cheaper off-peak hours.
            </p>
          </div>
          <select
            value={selectedLocId}
            onChange={(e) => setSelectedLocId(e.target.value)}
            className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm"
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
            <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <Clock className="w-4 h-4" /> Recommended Arrival
            </div>
            <div className="text-2xl font-bold mt-1">{bestTime}</div>
            <div className="text-xs text-slate-500 mt-1">Lowest predicted congestion window</div>
          </div>
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4">
            <div className="text-xs font-medium text-rose-500 flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4" /> Peak Congestion Hour
            </div>
            <div className="text-2xl font-bold mt-1">
              {peakTime} ({peakPct}%)
            </div>
            <div className="text-xs text-slate-500 mt-1">Highest predicted occupancy</div>
          </div>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <div className="text-xs font-medium text-slate-500">Top Peak / Quiet Hours</div>
            <div className="text-xs mt-2">
              <span className="font-semibold text-rose-500">Peak:</span> {topPeakHours.join(", ")}
            </div>
            <div className="text-xs mt-1">
              <span className="font-semibold text-emerald-500">Quiet:</span> {offPeakHours.join(", ")}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="h-72 rounded-2xl bg-slate-200 dark:bg-slate-800 animate-pulse" />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <h2 className="font-semibold text-base">Next 24-Hour Occupancy Prediction</h2>
              <OccupancyForecastLineChart points={forecast} />
            </div>
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <h2 className="font-semibold text-base">Weekday vs Weekend Peak-Hour Profile</h2>
              <PeakHoursBarChart profile={peakProfile} />
            </div>
          </div>
        )}
      </div>
    </SidebarLayout>
  );
}

