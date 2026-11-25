import type {
  AdminAnalyticsResponse,
  AppNotification,
  Booking,
  OccupancyForecastPoint,
  ParkingLocation,
  ParkingSlot,
  PeakHourPoint,
  PricingQuote,
  UserProfile,
} from "@/types";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export const WS_BASE = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000";

function resolveApiBase(): string {
  if (typeof window !== "undefined" && !process.env.NEXT_PUBLIC_API_URL) {
    return `${window.location.protocol}//${window.location.hostname}:8000`;
  }
  return API_BASE;
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("smartpark_token");
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const base = resolveApiBase();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...options,
      headers,
      cache: "no-store",
    });
  } catch {
    throw new Error(
      `Cannot connect to backend API at ${base}. Please start MongoDB and the FastAPI server (uvicorn backend.app.main:app --port 8000).`
    );
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof data?.detail === "string" ? data.detail : JSON.stringify(data?.detail || "Request failed");
    throw new Error(detail);
  }
  return data as T;
}

export const api = {
  // Auth
  register: (payload: {
    name: string;
    email: string;
    phone: string;
    password: string;
    vehicle_number: string;
    vehicle_type: string;
  }) =>
    request<{ access_token: string; user: UserProfile }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  login: (payload: { email: string; password: string }) =>
    request<{ access_token: string; user: UserProfile }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  adminLogin: (payload: { email: string; password: string }) =>
    request<{ access_token: string; user: UserProfile }>("/api/auth/admin/login", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getProfile: () => request<{ user: UserProfile }>("/api/auth/me"),

  updateProfile: (payload: { name?: string; phone?: string; vehicle_number?: string; vehicle_type?: string }) =>
    request<{ user: UserProfile }>("/api/auth/me", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  // Locations & Slots
  getLocations: (params?: { search?: string; city?: string; max_rate?: number }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.city) q.set("city", params.city);
    if (params?.max_rate) q.set("max_rate", String(params.max_rate));
    const qs = q.toString();
    return request<{
      locations: ParkingLocation[];
      summary: {
        total_locations: number;
        total_slots: number;
        available_slots: number;
        occupied_slots: number;
        reserved_slots: number;
      };
    }>(`/api/locations${qs ? `?${qs}` : ""}`);
  },

  getLocationDetail: (locationId: string) =>
    request<{ location: ParkingLocation; slots: ParkingSlot[] }>(`/api/locations/${locationId}`),

  getAllSlots: (locationId?: string) =>
    request<{ slots: ParkingSlot[] }>(`/api/slots${locationId ? `?location_id=${locationId}` : ""}`),

  // Bookings & QR
  getBookingQuote: (payload: { location_id: string; start_time: string; end_time: string; slot_type?: string }) =>
    request<{ pricing: PricingQuote; recommended_slot: ParkingSlot | null }>("/api/bookings/quote", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  createBooking: (payload: {
    location_id: string;
    slot_id?: string;
    auto_allocate: boolean;
    preferred_slot_type?: string;
    vehicle_number: string;
    start_time: string;
    end_time: string;
    payment_method: string;
    payment_confirmed: boolean;
  }) =>
    request<{ booking: Booking }>("/api/bookings", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getMyBookings: (status?: string) =>
    request<{ bookings: Booking[] }>(`/api/bookings/my${status ? `?status=${status}` : ""}`),

  getAllBookings: (status?: string, search?: string) => {
    const q = new URLSearchParams();
    if (status) q.set("status", status);
    if (search) q.set("search", search);
    const qs = q.toString();
    return request<{ bookings: Booking[] }>(`/api/bookings/all${qs ? `?${qs}` : ""}`);
  },

  cancelBooking: (bookingId: string) =>
    request<{ booking: Booking }>(`/api/bookings/${bookingId}/cancel`, { method: "POST" }),

  verifyQRGate: (payload: { qr_payload?: string; booking_code?: string; action: "entry" | "exit" | "auto" }) =>
    request<{ action: string; message: string; booking: Booking; slot: ParkingSlot }>("/api/bookings/qr-verify", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  // Notifications
  getNotifications: () => request<{ notifications: AppNotification[]; unread_count: number }>("/api/notifications"),
  markNotificationRead: (id: string) => request<{ status: string }>(`/api/notifications/${id}/read`, { method: "POST" }),
  markAllNotificationsRead: () => request<{ status: string }>("/api/notifications/read-all", { method: "POST" }),

  // Admin Locations & Slots CRUD
  createLocation: (payload: Partial<ParkingLocation> & { initial_slot_count?: number }) =>
    request<{ location: ParkingLocation }>("/api/admin/locations", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateLocation: (id: string, payload: Partial<ParkingLocation>) =>
    request<{ location: ParkingLocation }>(`/api/admin/locations/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  deleteLocation: (id: string) => request<{ message: string }>(`/api/admin/locations/${id}`, { method: "DELETE" }),

  createSlot: (payload: {
    location_id: string;
    slot_code: string;
    floor: string;
    zone: string;
    slot_type: string;
    status: string;
  }) =>
    request<{ slot: ParkingSlot }>("/api/admin/slots", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateSlot: (id: string, payload: Partial<ParkingSlot>) =>
    request<{ slot: ParkingSlot }>(`/api/admin/slots/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  deleteSlot: (id: string) => request<{ message: string }>(`/api/admin/slots/${id}`, { method: "DELETE" }),

  // IoT Simulator
  simulateSlotToggle: (slotId: string) =>
    request<{ slot: ParkingSlot; previous_status: string; new_status: string }>(`/api/iot/simulate/toggle/${slotId}`, {
      method: "POST",
    }),

  simulateBurst: (count = 3, locationId?: string) => {
    const q = new URLSearchParams({ count: String(count) });
    if (locationId) q.set("location_id", locationId);
    return request<{ simulated_events: Array<Record<string, unknown>>; count: number }>(`/api/iot/simulate/burst?${q}`, {
      method: "POST",
    });
  },

  getSensorLogs: (limit = 40) => request<{ logs: Array<Record<string, unknown>> }>(`/api/iot/logs?limit=${limit}`),

  // Analytics & ML
  getAdminAnalytics: (period: "daily" | "weekly" | "monthly" = "daily") =>
    request<AdminAnalyticsResponse>(`/api/admin/analytics?period=${period}`),

  getOccupancyForecast: (locationId?: string) =>
    request<{
      location_id: string;
      location_name: string;
      total_slots: number;
      forecast: OccupancyForecastPoint[];
      best_time_to_park: string;
      peak_time: string;
      peak_occupancy_pct: number;
      model_metrics: Record<string, number | string>;
    }>(`/api/ml/occupancy-forecast${locationId ? `?location_id=${locationId}` : ""}`),

  getPeakHours: (locationId?: string) =>
    request<{
      location_name: string;
      hourly_profile: PeakHourPoint[];
      top_peak_hours: string[];
      off_peak_hours: string[];
    }>(`/api/ml/peak-hours${locationId ? `?location_id=${locationId}` : ""}`),

  getRevenueForecast: (days = 7) =>
    request<{
      days: number;
      projected_total_revenue: number;
      projected_daily_average: number;
      daily_forecast: Array<{
        date: string;
        day_name: string;
        predicted_total_revenue: number;
        avg_occupancy_pct: number;
      }>;
      model_metrics: Record<string, number | string>;
    }>(`/api/ml/revenue-forecast?days=${days}`),

  retrainML: () => request<{ message: string; metrics: Record<string, number | string> }>("/api/ml/retrain", { method: "POST" }),
};

