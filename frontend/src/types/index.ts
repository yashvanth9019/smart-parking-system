export type SlotStatus = "available" | "occupied" | "reserved" | "maintenance";
export type SlotType = "standard" | "ev" | "handicapped" | "compact";

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  phone?: string;
  vehicle_number?: string;
  vehicle_type?: "car" | "suv" | "ev" | "bike";
  role: "user" | "admin" | "superadmin";
  is_active: boolean;
  created_at: string;
}

export interface ParkingLocation {
  id: string;
  name: string;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
  total_slots: number;
  available_slots: number;
  occupied_slots: number;
  reserved_slots: number;
  maintenance_slots?: number;
  occupancy_pct: number;
  base_hourly_rate: number;
  current_hourly_rate: number;
  current_multiplier: number;
  pricing_tier: string;
  dynamic_pricing_enabled: boolean;
  operating_hours: string;
  amenities: string[];
  status: "active" | "maintenance" | "closed";
}

export interface ParkingSlot {
  id: string;
  location_id: string;
  location_name?: string;
  slot_code: string;
  floor: string;
  zone: string;
  slot_type: SlotType;
  status: SlotStatus;
  current_booking_id?: string | null;
  sensor_id: string;
  last_sensor_distance_cm?: number;
  last_updated: string;
}

export interface Booking {
  id: string;
  booking_code: string;
  user_id: string;
  user_name?: string;
  user_email?: string;
  location_id: string;
  location_name: string;
  location_address?: string;
  slot_id: string;
  slot_code: string;
  slot_floor?: string;
  slot_type?: SlotType;
  vehicle_number: string;
  start_time: string;
  end_time: string;
  actual_entry_time?: string | null;
  actual_exit_time?: string | null;
  duration_hours: number;
  base_amount: number;
  dynamic_multiplier: number;
  total_amount: number;
  grace_period_minutes?: number;
  extra_time_hourly_rate?: number;
  overtime_minutes?: number;
  extra_charges?: number;
  final_amount?: number;
  status: "confirmed" | "active" | "completed" | "cancelled" | "expired";
  qr_token: string;
  qr_image_base64: string;
  created_at: string;
}

export interface AppNotification {
  id: string;
  user_id?: string | null;
  type: "booking_confirmed" | "booking_cancelled" | "slot_available" | "expiry_alert" | "sensor_alert" | "entry_exit";
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

export interface PricingQuote {
  base_hourly_rate: number;
  effective_hourly_rate: number;
  duration_hours: number;
  base_amount: number;
  multiplier: number;
  total_amount: number;
  tier: string;
  reasons: string[];
  grace_period_minutes?: number;
  extra_time_hourly_rate?: number;
  extra_time_policy?: string;
}

export interface OccupancyForecastPoint {
  timestamp: string;
  hour_label: string;
  predicted_occupancy_pct: number;
  predicted_occupied_slots: number;
  predicted_available_slots: number;
  congestion_level: string;
  suggested_multiplier: number;
  estimated_rate: number;
}

export interface PeakHourPoint {
  hour: number;
  hour_label: string;
  weekday_occupancy_pct: number;
  weekend_occupancy_pct: number;
  overall_avg_pct: number;
  estimated_occupied_slots: number;
}

export interface AdminAnalyticsResponse {
  kpis: {
    total_users: number;
    total_locations: number;
    total_slots: number;
    available_slots: number;
    occupied_slots: number;
    reserved_slots: number;
    occupancy_pct: number;
    active_bookings: number;
    total_bookings: number;
    total_revenue: number;
    today_revenue: number;
  };
  period: "daily" | "weekly" | "monthly";
  trend_series: { label: string; revenue: number; bookings: number }[];
  revenue_by_location: { location_id: string; location_name: string; revenue: number; bookings: number }[];
  activity_feed: {
    id: string;
    type: string;
    slot_code: string;
    location_name: string;
    previous_status: string;
    new_status: string;
    distance_cm: number;
    recorded_at: string;
  }[];
}

