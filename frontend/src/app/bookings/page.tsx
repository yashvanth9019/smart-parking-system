"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Calendar, QrCode, X, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { SidebarLayout } from "@/components/SidebarLayout";
import type { Booking } from "@/types";

export default function MyBookingsPage() {
  const { user, pushToast, subscribeWSEvents } = useApp();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [qrModal, setQrModal] = useState<Booking | null>(null);

  const loadBookings = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    try {
      const res = await api.getMyBookings(statusFilter || undefined);
      setBookings(res.bookings);
    } catch (err) {
      pushToast("Error", err instanceof Error ? err.message : "Failed to load bookings", "error");
    } finally {
      setLoading(false);
    }
  }, [user, statusFilter, pushToast]);

  useEffect(() => {
    loadBookings();
  }, [loadBookings]);

  useEffect(() => {
    return subscribeWSEvents((msg) => {
      if (msg.event === "notification" || msg.event === "slot_updated") {
        loadBookings();
      }
    });
  }, [subscribeWSEvents, loadBookings]);

  const handleCancel = async (b: Booking) => {
    try {
      await api.cancelBooking(b.id);
      pushToast("Booking Cancelled", `${b.booking_code} cancelled & refund initiated.`, "info");
      loadBookings();
    } catch (err) {
      pushToast("Cancel Failed", err instanceof Error ? err.message : "Could not cancel", "error");
    }
  };

  const statusBadge = (status: Booking["status"]) => {
    switch (status) {
      case "active":
        return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
      case "confirmed":
        return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
      case "completed":
        return "bg-blue-500/15 text-blue-600 dark:text-blue-400";
      default:
        return "bg-rose-500/15 text-rose-500";
    }
  };

  return (
    <SidebarLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">My Bookings & QR Passes</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Show your encrypted QR code at the parking gate for automated entry and exit.
            </p>
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm"
          >
            <option value="">All Bookings</option>
            <option value="active">Active</option>
            <option value="confirmed">Confirmed</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        {!user ? (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center space-y-3">
            <p className="text-sm text-slate-500">Sign in to view your parking reservations and QR entry tickets.</p>
            <Link href="/login" className="inline-block px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold">
              Sign In
            </Link>
          </div>
        ) : loading ? (
          <div className="h-48 rounded-2xl bg-slate-200 dark:bg-slate-800 animate-pulse" />
        ) : bookings.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-10 text-center space-y-2">
            <p className="text-sm text-slate-500">No bookings found.</p>
            <Link href="/" className="text-sm font-semibold text-blue-600 hover:underline">
              Browse Live Parking Hubs
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {bookings.map((b) => (
              <div
                key={b.id}
                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between gap-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-mono text-xs text-slate-500">{b.booking_code}</div>
                    <h3 className="font-bold text-base mt-0.5">{b.location_name}</h3>
                    <div className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5" />
                      {new Date(b.start_time).toLocaleString()} — {new Date(b.end_time).toLocaleTimeString()}
                    </div>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${statusBadge(b.status)}`}>
                    {b.status}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3 text-xs">
                  <div>
                    <div className="text-slate-400">Slot</div>
                    <div className="font-bold">{b.slot_code}</div>
                  </div>
                  <div>
                    <div className="text-slate-400">Vehicle</div>
                    <div className="font-bold">{b.vehicle_number}</div>
                  </div>
                  <div>
                    <div className="text-slate-400">Amount</div>
                    <div className="font-bold text-emerald-600 dark:text-emerald-400">
                      INR {b.final_amount ?? b.total_amount}
                    </div>
                  </div>
                </div>

                <div className="rounded-xl bg-amber-500/10 border border-amber-500/25 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300 flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <b>Extra Time Rate:</b> INR {b.extra_time_hourly_rate ?? "--"}/hr after {b.grace_period_minutes ?? 10}m grace
                  </span>
                  {(b.extra_charges ?? 0) > 0 && (
                    <span className="font-bold text-rose-600 dark:text-rose-400">
                      Overtime: +{b.overtime_minutes}m (INR {b.extra_charges})
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setQrModal(b)}
                    className="flex-1 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
                  >
                    <QrCode className="w-4 h-4" /> View QR Pass
                  </button>
                  {(b.status === "confirmed" || b.status === "active") && (
                    <button
                      onClick={() => handleCancel(b)}
                      className="px-3.5 py-2 rounded-xl border border-rose-500/40 text-rose-500 hover:bg-rose-500/10 text-xs font-semibold flex items-center gap-1"
                    >
                      <XCircle className="w-4 h-4" /> Cancel
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {qrModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 text-center space-y-4">
            <div className="flex items-center justify-between">
              <span className="font-bold text-base">Gate Entry QR Ticket</span>
              <button onClick={() => setQrModal(null)} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="bg-white p-3 rounded-2xl inline-block border border-slate-200">
              <img src={qrModal.qr_image_base64} alt="Booking QR" className="w-48 h-48 mx-auto" />
            </div>
            <div className="text-xs space-y-1">
              <div className="font-mono font-bold text-sm">{qrModal.booking_code}</div>
              <div className="text-slate-500">{qrModal.location_name} • Slot {qrModal.slot_code}</div>
              <div className="text-[11px] text-slate-400 break-all bg-slate-100 dark:bg-slate-800 p-2 rounded-lg mt-2">
                {qrModal.qr_token}
              </div>
            </div>
          </div>
        </div>
      )}
    </SidebarLayout>
  );
}

