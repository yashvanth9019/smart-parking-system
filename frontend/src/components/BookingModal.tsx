"use client";

import React, { useEffect, useState } from "react";
import { CheckCircle2, CreditCard, Loader2, Sparkles, X } from "lucide-react";
import { api } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import type { Booking, ParkingLocation, ParkingSlot, PricingQuote } from "@/types";

interface BookingModalProps {
  location: ParkingLocation;
  initialSlot?: ParkingSlot | null;
  onClose: () => void;
  onBooked: (booking: Booking) => void;
}

function toLocalInputValue(date: Date): string {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

export function BookingModal({ location, initialSlot, onClose, onBooked }: BookingModalProps) {
  const { user, pushToast } = useApp();

  const now = new Date();
  const defaultStart = new Date(now.getTime() + 10 * 60000);
  const defaultEnd = new Date(defaultStart.getTime() + 2 * 3600000);

  const [startTime, setStartTime] = useState(toLocalInputValue(defaultStart));
  const [endTime, setEndTime] = useState(toLocalInputValue(defaultEnd));
  const [autoAllocate, setAutoAllocate] = useState(!initialSlot);
  const [preferredType, setPreferredType] = useState<string>(initialSlot?.slot_type || "standard");
  const [vehicleNumber, setVehicleNumber] = useState(user?.vehicle_number || "KA01AB1234");
  const [paymentMethod, setPaymentMethod] = useState("upi");

  const [quote, setQuote] = useState<PricingQuote | null>(null);
  const [recommendedSlot, setRecommendedSlot] = useState<ParkingSlot | null>(initialSlot || null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmedBooking, setConfirmedBooking] = useState<Booking | null>(null);

  useEffect(() => {
    let active = true;
    async function fetchQuote() {
      setError(null);
      const st = new Date(startTime);
      const et = new Date(endTime);
      if (isNaN(st.getTime()) || isNaN(et.getTime()) || et <= st) {
        setQuote(null);
        return;
      }
      setQuoteLoading(true);
      try {
        const res = await api.getBookingQuote({
          location_id: location.id,
          start_time: st.toISOString(),
          end_time: et.toISOString(),
          slot_type: preferredType,
        });
        if (!active) return;
        setQuote(res.pricing);
        if (autoAllocate) {
          setRecommendedSlot(res.recommended_slot);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Failed to calculate price");
      } finally {
        if (active) setQuoteLoading(false);
      }
    }
    fetchQuote();
    return () => {
      active = false;
    };
  }, [location.id, startTime, endTime, preferredType, autoAllocate]);

  const handleConfirmBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.createBooking({
        location_id: location.id,
        slot_id: autoAllocate ? undefined : initialSlot?.id,
        auto_allocate: autoAllocate,
        preferred_slot_type: preferredType,
        vehicle_number: vehicleNumber,
        start_time: new Date(startTime).toISOString(),
        end_time: new Date(endTime).toISOString(),
        payment_method: paymentMethod,
        payment_confirmed: true,
      });
      setConfirmedBooking(res.booking);
      pushToast("Booking Confirmed", `Slot ${res.booking.slot_code} booked (${res.booking.booking_code})`, "success");
      onBooked(res.booking);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Booking failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden max-h-[92vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-lg">{confirmedBooking ? "QR Parking Pass Ready" : "Book Parking Slot"}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">{location.name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        {confirmedBooking ? (
          <div className="p-6 text-center space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
              <CheckCircle2 className="w-4 h-4" /> Confirmed & Paid
            </div>

            <div className="bg-white p-4 rounded-2xl inline-block border border-slate-200 shadow-sm">
              <img src={confirmedBooking.qr_image_base64} alt="Entry QR Code" className="w-48 h-48 mx-auto" />
            </div>

            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 p-4 text-left text-sm space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-500">Booking ID</span>
                <span className="font-mono font-bold">{confirmedBooking.booking_code}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Assigned Slot</span>
                <span className="font-semibold">
                  {confirmedBooking.slot_code} ({confirmedBooking.slot_floor})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Vehicle</span>
                <span className="font-semibold">{confirmedBooking.vehicle_number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Total Paid</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400">
                  INR {confirmedBooking.total_amount}
                </span>
              </div>
              <div className="pt-2 border-t border-slate-200 dark:border-slate-700 text-xs text-amber-600 dark:text-amber-400">
                <b>Extra Time Policy:</b> {confirmedBooking.grace_period_minutes ?? 10}-min grace period; overtime after exit time is billed at{" "}
                <b>INR {confirmedBooking.extra_time_hourly_rate ?? Math.round(location.current_hourly_rate * 1.5)}/hr</b> (1.5x rate) at Check-Out.
              </div>
            </div>

            <button
              onClick={onClose}
              className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleConfirmBooking} className="p-5 space-y-4">
            {error && (
              <div className="rounded-xl bg-rose-500/10 border border-rose-500/40 text-rose-600 dark:text-rose-400 p-3 text-xs font-medium">
                {error}
              </div>
            )}

            {/* Smart Allocation Toggle */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-blue-500" />
                  Smart Slot Allocation
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {autoAllocate
                    ? recommendedSlot
                      ? `Auto-selected best slot: ${recommendedSlot.slot_code} (${recommendedSlot.floor})`
                      : "Finding optimal conflict-free slot..."
                    : `Manual pick: Slot ${initialSlot?.slot_code || "None"}`}
                </div>
              </div>
              {initialSlot && (
                <button
                  type="button"
                  onClick={() => setAutoAllocate((v) => !v)}
                  className="text-xs px-2.5 py-1.5 rounded-lg bg-blue-600/10 text-blue-600 dark:text-blue-400 font-semibold"
                >
                  {autoAllocate ? `Use ${initialSlot.slot_code}` : "Auto Pick"}
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Entry Time</label>
                <input
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Exit Time</label>
                <input
                  type="datetime-local"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Vehicle Number</label>
                <input
                  type="text"
                  value={vehicleNumber}
                  onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
                  required
                  placeholder="KA01MJ4582"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm uppercase"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Slot Preference</label>
                <select
                  value={preferredType}
                  onChange={(e) => setPreferredType(e.target.value)}
                  disabled={!autoAllocate}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
                >
                  <option value="standard">Standard</option>
                  <option value="ev">EV Charging</option>
                  <option value="handicapped">Accessible</option>
                  <option value="compact">Compact</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">Payment Method</label>
              <div className="grid grid-cols-4 gap-2">
                {["upi", "card", "wallet", "netbanking"].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPaymentMethod(m)}
                    className={`py-2 rounded-xl border text-xs font-semibold uppercase transition-colors ${
                      paymentMethod === m
                        ? "bg-blue-600 border-blue-600 text-white"
                        : "border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* Dynamic Pricing Breakdown */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-4 space-y-2 text-sm">
              {quoteLoading ? (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Loader2 className="w-4 h-4 animate-spin" /> Calculating dynamic tariff...
                </div>
              ) : quote ? (
                <>
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>
                      Base Rate (INR {quote.base_hourly_rate}/hr x {quote.duration_hours}h)
                    </span>
                    <span>INR {quote.base_amount}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Dynamic Multiplier ({quote.tier})</span>
                    <span className="font-semibold text-indigo-500">{quote.multiplier}x</span>
                  </div>
                  <div className="text-[11px] text-slate-400">{quote.reasons.join(" • ")}</div>
                  <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
                    <b>Extra Time Charges:</b>{" "}
                    {quote.extra_time_policy ||
                      `${quote.grace_period_minutes ?? 10}-min grace period; overtime billed at INR ${
                        quote.extra_time_hourly_rate ?? Math.round(quote.effective_hourly_rate * 1.5)
                      }/hr (1.5x)`}
                  </div>
                  <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex justify-between font-bold text-base">
                    <span>Total Payable</span>
                    <span className="text-emerald-600 dark:text-emerald-400">INR {quote.total_amount}</span>
                  </div>
                </>
              ) : (
                <div className="text-xs text-amber-500">Select a valid entry and exit time window.</div>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting || !quote}
              className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
              {submitting ? "Processing Payment & QR..." : `Pay INR ${quote?.total_amount ?? "--"} & Generate QR`}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

