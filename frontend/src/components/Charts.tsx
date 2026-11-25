"use client";

import React from "react";
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Title,
  Tooltip,
} from "chart.js";
import { Bar, Doughnut, Line } from "react-chartjs-2";
import type { OccupancyForecastPoint, PeakHourPoint } from "@/types";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

export function OccupancyDoughnutChart({
  available,
  occupied,
  reserved,
}: {
  available: number;
  occupied: number;
  reserved: number;
}) {
  return (
    <div className="h-56 flex items-center justify-center">
      <Doughnut
        data={{
          labels: ["Available", "Occupied", "Reserved"],
          datasets: [
            {
              data: [available, occupied, reserved],
              backgroundColor: ["#10b981", "#ef4444", "#f59e0b"],
              borderWidth: 0,
              hoverOffset: 6,
            },
          ],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          cutout: "68%",
          plugins: {
            legend: { position: "bottom", labels: { boxWidth: 12, padding: 14 } },
          },
        }}
      />
    </div>
  );
}

export function OccupancyForecastLineChart({ points }: { points: OccupancyForecastPoint[] }) {
  return (
    <div className="h-72">
      <Line
        data={{
          labels: points.map((p) => p.hour_label),
          datasets: [
            {
              label: "Predicted Occupancy (%)",
              data: points.map((p) => p.predicted_occupancy_pct),
              borderColor: "#3b82f6",
              backgroundColor: "rgba(59, 130, 246, 0.16)",
              fill: true,
              tension: 0.35,
              pointRadius: 3,
            },
          ],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: { min: 0, max: 100, ticks: { callback: (v) => `${v}%` } },
          },
          plugins: {
            legend: { display: true, position: "top" },
          },
        }}
      />
    </div>
  );
}

export function PeakHoursBarChart({ profile }: { profile: PeakHourPoint[] }) {
  return (
    <div className="h-72">
      <Bar
        data={{
          labels: profile.map((p) => p.hour_label),
          datasets: [
            {
              label: "Weekday Occupancy (%)",
              data: profile.map((p) => p.weekday_occupancy_pct),
              backgroundColor: "rgba(99, 102, 241, 0.8)",
              borderRadius: 4,
            },
            {
              label: "Weekend Occupancy (%)",
              data: profile.map((p) => p.weekend_occupancy_pct),
              backgroundColor: "rgba(16, 185, 129, 0.75)",
              borderRadius: 4,
            },
          ],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          scales: { y: { min: 0, max: 100 } },
          plugins: { legend: { position: "top" } },
        }}
      />
    </div>
  );
}

export function RevenueTrendBarChart({
  series,
  title = "Revenue (INR)",
  color = "rgba(16, 185, 129, 0.85)",
}: {
  series: { label: string; value: number }[];
  title?: string;
  color?: string;
}) {
  return (
    <div className="h-72">
      <Bar
        data={{
          labels: series.map((s) => s.label),
          datasets: [
            {
              label: title,
              data: series.map((s) => s.value),
              backgroundColor: color,
              borderRadius: 6,
            },
          ],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: "top" } },
        }}
      />
    </div>
  );
}

