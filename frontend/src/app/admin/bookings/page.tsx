"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, LogIn, LogOut, QrCode, ScanLine, Search, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { SidebarLayout } from "@/components/SidebarLayout";
import type { Booking } from "@/types";

export default function AdminBookingsQRPage() {
  const { pushToast, subscribeWSEvents } = useApp();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [qrInput, setQrInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [gateAction, setGateAction] = useState<"auto" | "entry" | "exit">("auto");
  const [gateFeedback, setGateFeedback] = useState<{ tone: "success" | "info" | "error"; text: string } | null>(null);

  const loadBookings = useCallback(async () => {
    try {
      const res = await api.getAllBookings(statusFilter || undefined);
      setBookings(res.bookings);
    } catch (err) {
      pushToast("Error", err instanceof Error ? err.message : "Failed to load bookings", "error");
    }
  }, [statusFilter, pushToast]);

  useEffect(() => {
    loadBookings();
  }, [loadBookings]);

  useEffect(() => {
    return subscribeWSEvents((msg) => {
      if (msg.event === "admin_activity" || msg.event === "slot_updated") {
        loadBookings();
      }
    });
  }, [subscribeWSEvents, loadBookings]);

  const filteredBookings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return bookings;
    return bookings.filter(
      (b) =>
        b.booking_code.toLowerCase().includes(q) ||
        b.vehicle_number.toLowerCase().includes(q) ||
        (b.user_name || "").toLowerCase().includes(q) ||
        (b.slot_code || "").toLowerCase().includes(q) ||
        (b.location_name || "").toLowerCase().includes(q)
    );
  }, [bookings, searchQuery]);

  // If admin searches for a specific car or booking in Gate Terminal, show its live check-in/out state
  const gateMatchedBooking = useMemo(() => {
    const raw = (qrInput || searchQuery).trim();
    if (!raw) return null;
    let lookup = raw.toUpperCase();
    if (raw.startsWith("{")) {
      try {
        const parsed = JSON.parse(raw) as { booking_code?: string };
        lookup = (parsed.booking_code || "").toUpperCase();
      } catch {
        return null;
      }
    }
    if (!lookup) return null;
    return (
      bookings.find((b) => b.booking_code.toUpperCase() === lookup) ||
      bookings.find((b) => b.vehicle_number.toUpperCase().includes(lookup)) ||
      bookings.find((b) => b.booking_code.toUpperCase().includes(lookup)) ||
      null
    );
  }, [bookings, qrInput, searchQuery]);

  const runGateAction = async (payload: { qr_payload?: string; booking_code?: string; action: "auto" | "entry" | "exit" }) => {
    setGateFeedback(null);
    try {
      const res = await api.verifyQRGate(payload);
      setGateFeedback({ tone: "success", text: res.message });
      pushToast(res.action === "entry" ? "Checked In" : "Checked Out", res.message, "success");
      loadBookings();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid request";
      const isAlreadyOut = message.toLowerCase().includes("already checked out");
      setGateFeedback({ tone: isAlreadyOut ? "info" : "error", text: message });
      pushToast(isAlreadyOut ? "Already Checked Out" : "Gate Action Failed", message, isAlreadyOut ? "warning" : "error");
    }
  };

  const handleVerifyQR = async (e: React.FormEvent, explicitAction?: "entry" | "exit") => {
    e.preventDefault();
    const trimmed = (qrInput || searchQuery).trim();
    if (!trimmed) return;
    const isJson = trimmed.startsWith("{");
    await runGateAction({
      qr_payload: isJson ? trimmed : undefined,
      booking_code: isJson ? undefined : trimmed,
      action: explicitAction ?? gateAction,
    });
    if (qrInput) setQrInput("");
  };

  const handleAdminCancel = async (b: Booking) => {
    await api.cancelBooking(b.id);
    pushToast("Cancelled", `Booking ${b.booking_code} cancelled`, "info");
    loadBookings();
  };

  return (
    <SidebarLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <QrCode className="w-6 h-6 text-indigo-500" /> Customer Bookings, Check-In & Check-Out
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Search by car/vehicle number, booking ID, or QR payload to Check-In, Check-Out, or verify already checked-out vehicles.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search car no. / SPK-..."
                className="pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm w-56"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm"
            >
              <option value="">All Statuses</option>
              <option value="confirmed">Confirmed (Awaiting Check-In)</option>
              <option value="active">Checked In (Active)</option>
              <option value="completed">Already Checked Out</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>

        {/* QR Gate Simulator Panel */}
        <form
          onSubmit={(e) => handleVerifyQR(e)}
          className="rounded-2xl border border-indigo-500/30 bg-indigo-500/5 p-5 space-y-3"
        >
          <div className="text-sm font-bold flex items-center gap-2">
            <ScanLine className="w-4 h-4 text-indigo-500" /> Gate Check-In / Check-Out Terminal
          </div>
          <div className="flex flex-col md:flex-row gap-2.5">
            <input
              type="text"
              value={qrInput}
              onChange={(e) => setQrInput(e.target.value)}
              placeholder="Enter Vehicle Number (e.g. KA01MJ4582), Booking Code (SPK-...), or QR JSON"
              className="flex-1 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono"
            />
            <select
              value={gateAction}
              onChange={(e) => setGateAction(e.target.value as "auto" | "entry" | "exit")}
              className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            >
              <option value="auto">Auto Detect</option>
              <option value="entry">Check In (Entry)</option>
              <option value="exit">Check Out (Exit)</option>
            </select>
            <button
              type="button"
              onClick={(e) => handleVerifyQR(e, "entry")}
              className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold flex items-center justify-center gap-1.5"
            >
              <LogIn className="w-4 h-4" /> Check In
            </button>
            <button
              type="button"
              onClick={(e) => handleVerifyQR(e, "exit")}
              className="px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold flex items-center justify-center gap-1.5"
            >
              <LogOut className="w-4 h-4" /> Check Out
            </button>
            <button
              type="submit"
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold"
            >
              Verify
            </button>
          </div>

          {/* Live Vehicle / Booking Match Preview */}
          {gateMatchedBooking && (
            <div
              className={`rounded-xl border p-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                gateMatchedBooking.status === "completed"
                  ? "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300"
                  : gateMatchedBooking.status === "active"
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              }`}
            >
              <div>
                <span className="font-bold">{gateMatchedBooking.vehicle_number}</span> •{" "}
                <span className="font-mono">{gateMatchedBooking.booking_code}</span> • Slot{" "}
                <b>{gateMatchedBooking.slot_code}</b> ({gateMatchedBooking.location_name})
                {gateMatchedBooking.status === "completed" && gateMatchedBooking.actual_exit_time && (
                  <span className="ml-2">
                    — Checked out at {new Date(gateMatchedBooking.actual_exit_time).toLocaleString()}
                  </span>
                )}
              </div>
              <span className="px-2.5 py-1 rounded-full font-bold uppercase text-[11px] bg-white/80 dark:bg-slate-900/80 shrink-0 flex items-center gap-1">
                {gateMatchedBooking.status === "completed" && <CheckCircle2 className="w-3.5 h-3.5 text-blue-500" />}
                {gateMatchedBooking.status === "completed"
                  ? "Already Checked Out"
                  : gateMatchedBooking.status === "active"
                  ? "Checked In (Parked)"
                  : gateMatchedBooking.status}
              </span>
            </div>
          )}

          {gateFeedback && (
            <div
              className={`text-xs font-semibold ${
                gateFeedback.tone === "success"
                  ? "text-emerald-500"
                  : gateFeedback.tone === "info"
                  ? "text-amber-500"
                  : "text-rose-500"
              }`}
            >
              {gateFeedback.text}
            </div>
          )}
        </form>

        {/* Bookings Table */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-slate-400 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="p-3.5">Booking ID</th>
                <th className="p-3.5">Driver / Vehicle</th>
                <th className="p-3.5">Hub & Slot</th>
                <th className="p-3.5">Scheduled & Gate Times</th>
                <th className="p-3.5">Charges & Extra Time</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5 text-right">Check-In / Check-Out</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredBookings.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">
                    No matching cars or bookings found.
                  </td>
                </tr>
              ) : (
                filteredBookings.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="p-3.5 font-mono font-bold">{b.booking_code}</td>
                    <td className="p-3.5">
                      <div className="font-semibold">{b.user_name}</div>
                      <div className="text-slate-400 font-mono">{b.vehicle_number}</div>
                    </td>
                    <td className="p-3.5">
                      <div className="font-medium">{b.location_name}</div>
                      <div className="text-slate-400">Slot {b.slot_code}</div>
                    </td>
                    <td className="p-3.5 text-slate-500 space-y-0.5">
                      <div>
                        {new Date(b.start_time).toLocaleTimeString()} - {new Date(b.end_time).toLocaleTimeString()}
                      </div>
                      {b.actual_entry_time && (
                        <div className="text-[11px] text-emerald-500">
                          In: {new Date(b.actual_entry_time).toLocaleTimeString()}
                        </div>
                      )}
                      {b.actual_exit_time && (
                        <div className="text-[11px] text-blue-500">
                          Out: {new Date(b.actual_exit_time).toLocaleTimeString()}
                        </div>
                      )}
                    </td>
                    <td className="p-3.5 space-y-0.5">
                      <div className="font-bold">INR {b.final_amount ?? b.total_amount}</div>
                      <div className="text-[11px] text-slate-400">
                        OT Rate: INR {b.extra_time_hourly_rate ?? "--"}/hr
                      </div>
                      {(b.extra_charges ?? 0) > 0 && (
                        <div className="text-[11px] font-semibold text-rose-500">
                          +INR {b.extra_charges} ({b.overtime_minutes}m extra)
                        </div>
                      )}
                    </td>
                    <td className="p-3.5">
                      <span
                        className={`px-2.5 py-0.5 rounded-full font-semibold ${
                          b.status === "completed"
                            ? "bg-blue-500/15 text-blue-600 dark:text-blue-400"
                            : b.status === "active"
                            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                            : b.status === "confirmed"
                            ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                            : "bg-rose-500/15 text-rose-500"
                        }`}
                      >
                        {b.status === "completed"
                          ? "Checked Out"
                          : b.status === "active"
                          ? "Checked In"
                          : b.status}
                      </span>
                    </td>
                    <td className="p-3.5 text-right">
                      {b.status === "completed" ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Already Checked Out
                        </span>
                      ) : b.status === "cancelled" || b.status === "expired" ? (
                        <span className="text-slate-400 capitalize">{b.status}</span>
                      ) : (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            disabled={b.status !== "confirmed"}
                            onClick={() => runGateAction({ booking_code: b.booking_code, action: "entry" })}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-35 disabled:cursor-not-allowed text-white font-semibold inline-flex items-center gap-1"
                          >
                            <LogIn className="w-3 h-3" /> Check In
                          </button>
                          <button
                            disabled={b.status !== "active" && b.status !== "confirmed"}
                            onClick={() => runGateAction({ booking_code: b.booking_code, action: "exit" })}
                            className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-35 disabled:cursor-not-allowed text-white font-semibold inline-flex items-center gap-1"
                          >
                            <LogOut className="w-3 h-3" /> Check Out
                          </button>
                          <button
                            onClick={() => handleAdminCancel(b)}
                            title="Cancel Booking"
                            className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/10 inline-flex align-middle"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </SidebarLayout>
  );
}
