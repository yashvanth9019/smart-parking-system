"use client";

import React from "react";
import { Accessibility, Car, Radio, Wrench, Zap } from "lucide-react";
import type { ParkingSlot } from "@/types";

interface SlotGridProps {
  slots: ParkingSlot[];
  selectedSlotId?: string;
  onSlotClick?: (slot: ParkingSlot) => void;
  adminMode?: boolean;
}

export function SlotGrid({ slots, selectedSlotId, onSlotClick, adminMode = false }: SlotGridProps) {
  if (slots.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-10 text-center text-sm text-slate-500">
        No parking slots match the current filter.
      </div>
    );
  }

  const getStatusStyle = (status: ParkingSlot["status"], isSelected: boolean) => {
    const ring = isSelected ? "ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-slate-900" : "";
    switch (status) {
      case "available":
        return `bg-emerald-500/12 border-emerald-500/60 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 ${ring}`;
      case "occupied":
        return `bg-rose-500/12 border-rose-500/60 text-rose-700 dark:text-rose-300 hover:bg-rose-500/20 ${ring}`;
      case "reserved":
        return `bg-amber-400/15 border-amber-500/60 text-amber-700 dark:text-amber-300 hover:bg-amber-400/25 ${ring}`;
      case "maintenance":
        return `bg-slate-200/60 dark:bg-slate-800 border-slate-400/50 text-slate-500 ${ring}`;
    }
  };

  const getDotColor = (status: ParkingSlot["status"]) => {
    switch (status) {
      case "available":
        return "bg-emerald-500";
      case "occupied":
        return "bg-rose-500";
      case "reserved":
        return "bg-amber-400";
      default:
        return "bg-slate-400";
    }
  };

  const renderTypeIcon = (type: ParkingSlot["slot_type"]) => {
    switch (type) {
      case "ev":
        return <Zap className="w-3.5 h-3.5 text-cyan-500" />;
      case "handicapped":
        return <Accessibility className="w-3.5 h-3.5 text-blue-500" />;
      case "compact":
        return <Car className="w-3.5 h-3.5 opacity-75" />;
      default:
        return <Car className="w-3.5 h-3.5" />;
    }
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
      {slots.map((slot) => {
        const isSelected = slot.id === selectedSlotId;
        const clickable = Boolean(onSlotClick) && (adminMode || slot.status === "available");

        return (
          <button
            key={slot.id}
            type="button"
            disabled={!clickable}
            onClick={() => clickable && onSlotClick?.(slot)}
            className={`text-left rounded-xl border p-3 transition-all ${getStatusStyle(
              slot.status,
              isSelected
            )} ${clickable ? "cursor-pointer active:scale-[0.98]" : "cursor-default opacity-85"}`}
          >
            <div className="flex items-center justify-between gap-1">
              <span className="font-bold text-sm tracking-tight">{slot.slot_code}</span>
              <span className={`w-2.5 h-2.5 rounded-full ${getDotColor(slot.status)}`} />
            </div>

            <div className="flex items-center gap-1.5 mt-2 text-[11px] font-medium uppercase">
              {slot.status === "maintenance" ? <Wrench className="w-3.5 h-3.5" /> : renderTypeIcon(slot.slot_type)}
              <span>{slot.slot_type}</span>
              <span className="opacity-60">• {slot.floor}</span>
            </div>

            <div className="mt-2 pt-2 border-t border-current/15 flex items-center justify-between text-[11px]">
              <span className="capitalize font-semibold">{slot.status}</span>
              <span className="flex items-center gap-1 opacity-75" title={`Sensor ${slot.sensor_id}`}>
                <Radio className="w-3 h-3" />
                {slot.last_sensor_distance_cm ? `${Math.round(slot.last_sensor_distance_cm)}cm` : "--"}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

