"use client";

import React, { useCallback, useEffect, useState } from "react";
import { MapPin, Plus, Radio, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { SidebarLayout } from "@/components/SidebarLayout";
import { SlotGrid } from "@/components/SlotGrid";
import { AdminLocationMapPicker } from "@/components/AdminLocationMapPicker";
import type { ParkingLocation, ParkingSlot } from "@/types";

export default function AdminLocationsPage() {
  const { pushToast, subscribeWSEvents } = useApp();
  const [locations, setLocations] = useState<ParkingLocation[]>([]);
  const [selectedLocId, setSelectedLocId] = useState<string>("");
  const [slots, setSlots] = useState<ParkingSlot[]>([]);

  // New location form
  const [showAddLoc, setShowAddLoc] = useState(false);
  const [locForm, setLocForm] = useState({
    name: "",
    address: "",
    city: "Bengaluru",
    latitude: 12.9716,
    longitude: 77.5946,
    base_hourly_rate: 55,
    operating_hours: "24/7 Open",
    dynamic_pricing_enabled: true,
    initial_slot_count: 8,
  });

  // New slot form
  const [slotForm, setSlotForm] = useState({
    slot_code: "",
    floor: "G",
    zone: "A",
    slot_type: "standard",
  });

  const loadLocations = useCallback(async () => {
    const res = await api.getLocations();
    setLocations(res.locations);
    if (res.locations.length > 0) {
      setSelectedLocId((prev) => prev || res.locations[0].id);
    } else {
      setShowAddLoc(true);
    }
  }, []);

  const loadSlots = useCallback(async (locId: string) => {
    if (!locId) return;
    const res = await api.getLocationDetail(locId);
    setSlots(res.slots);
  }, []);

  useEffect(() => {
    loadLocations();
  }, [loadLocations]);

  useEffect(() => {
    if (selectedLocId) loadSlots(selectedLocId);
  }, [selectedLocId, loadSlots]);

  useEffect(() => {
    return subscribeWSEvents((msg) => {
      if (msg.event === "slot_updated") {
        const updated = msg.data?.slot as ParkingSlot | undefined;
        if (updated) {
          setSlots((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
        }
      }
    });
  }, [subscribeWSEvents]);

  const handleCreateLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.createLocation(locForm);
      pushToast("Location Added", `${res.location.name} created with ${locForm.initial_slot_count} slots.`, "success");
      setShowAddLoc(false);
      setLocForm({ ...locForm, name: "", address: "" });
      await loadLocations();
      setSelectedLocId(res.location.id);
    } catch (err) {
      pushToast("Error", err instanceof Error ? err.message : "Failed to create location", "error");
    }
  };

  const handleDeleteLocation = async (id: string, name: string) => {
    try {
      await api.deleteLocation(id);
      pushToast("Deleted", `${name} removed.`, "info");
      setSelectedLocId("");
      await loadLocations();
    } catch (err) {
      pushToast("Cannot Delete", err instanceof Error ? err.message : "Failed", "error");
    }
  };

  const handleUpdateRate = async (loc: ParkingLocation, newRate: number) => {
    if (isNaN(newRate) || newRate <= 0) return;
    try {
      await api.updateLocation(loc.id, { base_hourly_rate: newRate });
      pushToast("Price Updated", `${loc.name} base rate set to INR ${newRate}/hr`, "success");
      await loadLocations();
    } catch (err) {
      pushToast("Error", err instanceof Error ? err.message : "Failed to update rate", "error");
    }
  };

  const handleAddSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLocId) return;
    try {
      await api.createSlot({ ...slotForm, location_id: selectedLocId, status: "available" });
      pushToast("Slot Created", `Added slot ${slotForm.slot_code}`, "success");
      setSlotForm({ ...slotForm, slot_code: "" });
      await loadSlots(selectedLocId);
      await loadLocations();
    } catch (err) {
      pushToast("Error", err instanceof Error ? err.message : "Failed to add slot", "error");
    }
  };

  const handleToggleSimulateSlot = async (slot: ParkingSlot) => {
    try {
      const res = await api.simulateSlotToggle(slot.id);
      pushToast("Sensor Toggled", `${slot.slot_code}: ${res.previous_status} -> ${res.new_status}`, "info");
    } catch (err) {
      pushToast("Error", err instanceof Error ? err.message : "Simulation failed", "error");
    }
  };

  return (
    <SidebarLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <MapPin className="w-6 h-6 text-indigo-500" /> Manage Locations, Pricing & Slots
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              CRUD control over parking hubs, dynamic hourly rates, and live ultrasonic slot simulation.
            </p>
          </div>
          <button
            onClick={() => setShowAddLoc((v) => !v)}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> Add Location
          </button>
        </div>

        {showAddLoc && (
          <form
            onSubmit={handleCreateLocation}
            className="rounded-2xl border border-indigo-500/30 bg-white dark:bg-slate-900 p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-base flex items-center gap-2">
                <MapPin className="w-4 h-4 text-indigo-500" /> Pick or Search Parking Location on Map
              </h2>
              <span className="text-xs text-slate-400">
                Lat: {locForm.latitude} • Lng: {locForm.longitude}
              </span>
            </div>

            <AdminLocationMapPicker
              latitude={locForm.latitude}
              longitude={locForm.longitude}
              existingLocations={locations}
              onPickLocation={({ latitude, longitude, suggestedName, suggestedAddress, suggestedCity }) => {
                setLocForm((prev) => ({
                  ...prev,
                  latitude,
                  longitude,
                  name: suggestedName ?? prev.name,
                  address: suggestedAddress ?? prev.address,
                  city: suggestedCity || prev.city,
                }));
              }}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Hub Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. MG Road Smart Hub"
                  value={locForm.name}
                  onChange={(e) => setLocForm({ ...locForm, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Street Address</label>
                <input
                  type="text"
                  required
                  placeholder="Street Address"
                  value={locForm.address}
                  onChange={(e) => setLocForm({ ...locForm, address: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">City</label>
                <input
                  type="text"
                  required
                  placeholder="City"
                  value={locForm.city}
                  onChange={(e) => setLocForm({ ...locForm, city: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Operating Hours</label>
                <input
                  type="text"
                  placeholder="24/7 Open"
                  value={locForm.operating_hours}
                  onChange={(e) => setLocForm({ ...locForm, operating_hours: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Latitude</label>
                <input
                  type="number"
                  step="0.000001"
                  value={locForm.latitude}
                  onChange={(e) => setLocForm({ ...locForm, latitude: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Longitude</label>
                <input
                  type="number"
                  step="0.000001"
                  value={locForm.longitude}
                  onChange={(e) => setLocForm({ ...locForm, longitude: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Base Rate (INR/hr)</label>
                <input
                  type="number"
                  min={10}
                  value={locForm.base_hourly_rate}
                  onChange={(e) => setLocForm({ ...locForm, base_hourly_rate: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Initial Parking Slots</label>
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={locForm.initial_slot_count}
                  onChange={(e) => setLocForm({ ...locForm, initial_slot_count: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={() => setShowAddLoc(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
              >
                Save Parking Hub & Create {locForm.initial_slot_count} Slots
              </button>
            </div>
          </form>
        )}

        {/* Locations Table */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-400 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="p-4">Parking Hub</th>
                <th className="p-4">Slots (Avail / Total)</th>
                <th className="p-4">Base Rate (INR/hr)</th>
                <th className="p-4">Dynamic Pricing</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {locations.map((loc) => (
                <tr
                  key={loc.id}
                  onClick={() => setSelectedLocId(loc.id)}
                  className={`cursor-pointer ${
                    loc.id === selectedLocId ? "bg-indigo-50/50 dark:bg-indigo-950/20" : "hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  }`}
                >
                  <td className="p-4">
                    <div className="font-semibold">{loc.name}</div>
                    <div className="text-xs text-slate-500">{loc.address}</div>
                  </td>
                  <td className="p-4 text-xs font-semibold">
                    <span className="text-emerald-500">{loc.available_slots}</span> / {loc.total_slots}
                  </td>
                  <td className="p-4" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        defaultValue={loc.base_hourly_rate}
                        onBlur={(e) => handleUpdateRate(loc, Number(e.target.value))}
                        className="w-20 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                      />
                    </div>
                  </td>
                  <td className="p-4">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        api.updateLocation(loc.id, { dynamic_pricing_enabled: !loc.dynamic_pricing_enabled }).then(loadLocations);
                      }}
                      className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                        loc.dynamic_pricing_enabled
                          ? "bg-emerald-500/15 text-emerald-500"
                          : "bg-slate-200 dark:bg-slate-700 text-slate-500"
                      }`}
                    >
                      {loc.dynamic_pricing_enabled ? "Enabled" : "Fixed"}
                    </button>
                  </td>
                  <td className="p-4 text-right" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => handleDeleteLocation(loc.id, loc.name)}
                      className="p-2 rounded-lg text-rose-500 hover:bg-rose-500/10"
                      title="Delete location"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Slot Management & Sensor Toggle */}
        {selectedLocId && (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <h2 className="font-bold text-base flex items-center gap-2">
                  <Radio className="w-4 h-4 text-emerald-500" />
                  Live Slots (Click any slot to simulate vehicle arrival/departure)
                </h2>
              </div>
              <form onSubmit={handleAddSlot} className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  required
                  placeholder="Code (e.g. G-A09)"
                  value={slotForm.slot_code}
                  onChange={(e) => setSlotForm({ ...slotForm, slot_code: e.target.value.toUpperCase() })}
                  className="w-32 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs uppercase"
                />
                <input
                  type="text"
                  placeholder="Floor"
                  value={slotForm.floor}
                  onChange={(e) => setSlotForm({ ...slotForm, floor: e.target.value })}
                  className="w-16 px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                />
                <select
                  value={slotForm.slot_type}
                  onChange={(e) => setSlotForm({ ...slotForm, slot_type: e.target.value })}
                  className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                >
                  <option value="standard">Standard</option>
                  <option value="ev">EV</option>
                  <option value="handicapped">Accessible</option>
                  <option value="compact">Compact</option>
                </select>
                <button type="submit" className="px-3 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-semibold">
                  + Add Slot
                </button>
              </form>
            </div>

            <SlotGrid slots={slots} adminMode onSlotClick={handleToggleSimulateSlot} />
          </div>
        )}
      </div>
    </SidebarLayout>
  );
}

