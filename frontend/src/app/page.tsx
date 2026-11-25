"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Clock, Filter, MapPin, Search, Sparkles, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { SidebarLayout } from "@/components/SidebarLayout";
import { ParkingMap } from "@/components/ParkingMap";
import { SlotGrid } from "@/components/SlotGrid";
import { BookingModal } from "@/components/BookingModal";
import { OccupancyDoughnutChart } from "@/components/Charts";
import type { ParkingLocation, ParkingSlot } from "@/types";

export default function LiveDashboardPage() {
  const { user, subscribeWSEvents, pushToast } = useApp();
  const [locations, setLocations] = useState<ParkingLocation[]>([]);
  const [selectedLocId, setSelectedLocId] = useState<string>("");
  const [slots, setSlots] = useState<ParkingSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [bookingSlot, setBookingSlot] = useState<ParkingSlot | null>(null);

  const fetchLocations = useCallback(async (query?: string) => {
    try {
      setError(null);
      const res = await api.getLocations(query ? { search: query } : undefined);
      setLocations(res.locations);
      if (res.locations.length > 0) {
        setSelectedLocId((prev) =>
          prev && res.locations.some((l) => l.id === prev) ? prev : res.locations[0].id
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load parking locations.");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSlots = useCallback(async (locId: string) => {
    if (!locId) return;
    setSlotsLoading(true);
    try {
      const res = await api.getLocationDetail(locId);
      setSlots(res.slots);
      setLocations((prev) => prev.map((l) => (l.id === locId ? res.location : l)));
    } catch {
      // handled gracefully
    } finally {
      setSlotsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLocations();
  }, [fetchLocations]);

  useEffect(() => {
    if (selectedLocId) fetchSlots(selectedLocId);
  }, [selectedLocId, fetchSlots]);

  // Real-time WebSocket updates without page refresh
  useEffect(() => {
    return subscribeWSEvents((msg) => {
      if (msg.event === "slot_updated") {
        const updatedSlot = msg.data?.slot as ParkingSlot | undefined;
        const summary = msg.data?.location_summary as
          | { location_id: string; total_slots: number; available: number; occupied: number; reserved: number; occupancy_pct: number }
          | undefined;

        if (updatedSlot) {
          setSlots((prev) =>
            prev.some((s) => s.id === updatedSlot.id)
              ? prev.map((s) => (s.id === updatedSlot.id ? updatedSlot : s))
              : prev
          );
        }
        if (summary) {
          setLocations((prev) =>
            prev.map((loc) =>
              loc.id === summary.location_id
                ? {
                    ...loc,
                    total_slots: summary.total_slots,
                    available_slots: summary.available,
                    occupied_slots: summary.occupied,
                    reserved_slots: summary.reserved,
                    occupancy_pct: summary.occupancy_pct,
                  }
                : loc
            )
          );
        }
      } else if (msg.event === "location_updated") {
        fetchLocations(search);
      }
    });
  }, [subscribeWSEvents, fetchLocations, search]);

  const selectedLocation = useMemo(
    () => locations.find((l) => l.id === selectedLocId) || locations[0] || null,
    [locations, selectedLocId]
  );

  const totals = useMemo(() => {
    return locations.reduce(
      (acc, l) => ({
        total: acc.total + l.total_slots,
        available: acc.available + l.available_slots,
        occupied: acc.occupied + l.occupied_slots,
        reserved: acc.reserved + l.reserved_slots,
      }),
      { total: 0, available: 0, occupied: 0, reserved: 0 }
    );
  }, [locations]);

  const filteredSlots = useMemo(() => {
    return slots.filter((s) => {
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      if (typeFilter !== "all" && s.slot_type !== typeFilter) return false;
      return true;
    });
  }, [slots, statusFilter, typeFilter]);

  const openBooking = (slot: ParkingSlot | null) => {
    if (!user) {
      pushToast("Sign In Required", "Please sign in or register to reserve a parking slot.", "warning");
      return;
    }
    setBookingSlot(slot);
    setBookingModalOpen(true);
  };

  return (
    <SidebarLayout>
      <div className="space-y-6">
        {/* Top Hero + Search */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Live Smart Parking Dashboard</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Real-time IoT slot monitoring, dynamic pricing, and instant QR reservations.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:w-64">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  fetchLocations(e.target.value);
                }}
                placeholder="Search hub, street, city..."
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
            {selectedLocation && (
              <button
                onClick={() => openBooking(null)}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold flex items-center gap-1.5 shadow-sm shrink-0"
              >
                <Sparkles className="w-4 h-4" /> Smart Book
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-500">
            {error}
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Parking Slots</div>
            <div className="text-2xl font-bold mt-1">{totals.total}</div>
            <div className="text-xs text-slate-400 mt-1">Across {locations.length} active hubs</div>
          </div>
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-500/10 p-4">
            <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Available (Green)</div>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{totals.available}</div>
            <div className="text-xs text-emerald-600/80 dark:text-emerald-400/80 mt-1">Ready for instant entry</div>
          </div>
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 dark:bg-rose-500/10 p-4">
            <div className="text-xs font-medium text-rose-600 dark:text-rose-400">Occupied (Red)</div>
            <div className="text-2xl font-bold text-rose-600 dark:text-rose-400 mt-1">{totals.occupied}</div>
            <div className="text-xs text-rose-600/80 dark:text-rose-400/80 mt-1">Detected by IoT sensors</div>
          </div>
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 dark:bg-amber-500/10 p-4">
            <div className="text-xs font-medium text-amber-600 dark:text-amber-400">Reserved (Yellow)</div>
            <div className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">{totals.reserved}</div>
            <div className="text-xs text-amber-600/80 dark:text-amber-400/80 mt-1">Awaiting QR arrival</div>
          </div>
        </div>

        {/* Map + Live Overview Chart */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-base flex items-center gap-2">
                <MapPin className="w-4 h-4 text-blue-500" /> Interactive OpenStreetMap Hubs
              </h2>
              <span className="text-xs text-slate-500">Click any pin to inspect slots</span>
            </div>
            <ParkingMap
              locations={locations}
              selectedLocationId={selectedLocId}
              onSelectLocation={(loc) => setSelectedLocId(loc.id)}
            />
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between">
            <div>
              <h2 className="font-semibold text-base">Network Occupancy Split</h2>
              <p className="text-xs text-slate-500 mt-0.5">Live distribution synced via WebSocket</p>
            </div>
            <OccupancyDoughnutChart
              available={totals.available}
              occupied={totals.occupied}
              reserved={totals.reserved}
            />
            {!user && (
              <Link
                href="/login"
                className="text-center py-2 rounded-xl bg-slate-900 dark:bg-blue-600 text-white text-xs font-semibold"
              >
                Sign in to Book & Receive Alerts
              </Link>
            )}
          </div>
        </div>

        {/* Location Selector Cards */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-36 rounded-2xl bg-slate-200 dark:bg-slate-800 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {locations.map((loc) => {
              const selected = loc.id === selectedLocId;
              return (
                <button
                  key={loc.id}
                  type="button"
                  onClick={() => setSelectedLocId(loc.id)}
                  className={`text-left rounded-2xl border p-4 transition-all ${
                    selected
                      ? "border-blue-500 bg-blue-50/50 dark:bg-blue-950/25 shadow-md shadow-blue-500/10"
                      : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold text-sm leading-snug">{loc.name}</div>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-600/10 text-blue-600 dark:text-blue-400 shrink-0">
                      INR {loc.current_hourly_rate}/hr
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-1">{loc.address}</div>
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-2">
                    <Clock className="w-3.5 h-3.5" /> {loc.operating_hours}
                  </div>
                  <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs font-semibold">
                    <span className="text-emerald-600 dark:text-emerald-400">{loc.available_slots} Avail</span>
                    <span className="text-rose-500">{loc.occupied_slots} Occ</span>
                    <span className="text-amber-500">{loc.reserved_slots} Res</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Live Slot Grid for Selected Hub */}
        {selectedLocation && (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-bold text-lg">{selectedLocation.name} — Live Slot Matrix</h2>
                  {selectedLocation.dynamic_pricing_enabled && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-500/10 text-indigo-500">
                      <Zap className="w-3 h-3" /> {selectedLocation.pricing_tier} ({selectedLocation.current_multiplier}x)
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Click any green available slot to book directly, or use Smart Book for optimal allocation.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Filter className="w-4 h-4 text-slate-400" />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                >
                  <option value="all">All Statuses</option>
                  <option value="available">Available (Green)</option>
                  <option value="occupied">Occupied (Red)</option>
                  <option value="reserved">Reserved (Yellow)</option>
                </select>
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                >
                  <option value="all">All Types</option>
                  <option value="standard">Standard</option>
                  <option value="ev">EV Charging</option>
                  <option value="handicapped">Accessible</option>
                  <option value="compact">Compact</option>
                </select>
              </div>
            </div>

            {slotsLoading ? (
              <div className="h-40 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
            ) : (
              <SlotGrid slots={filteredSlots} onSlotClick={(slot) => openBooking(slot)} />
            )}
          </div>
        )}
      </div>

      {bookingModalOpen && selectedLocation && (
        <BookingModal
          location={selectedLocation}
          initialSlot={bookingSlot}
          onClose={() => setBookingModalOpen(false)}
          onBooked={() => fetchSlots(selectedLocation.id)}
        />
      )}
    </SidebarLayout>
  );
}

