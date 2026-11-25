"use client";

import React, { useEffect, useRef, useState } from "react";
import { Crosshair, Loader2, MapPin, Search } from "lucide-react";
import type { ParkingLocation } from "@/types";

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  name?: string;
  address?: {
    road?: string;
    suburb?: string;
    neighbourhood?: string;
    city?: string;
    town?: string;
    village?: string;
    state_district?: string;
    state?: string;
  };
}

interface AdminLocationMapPickerProps {
  latitude: number;
  longitude: number;
  existingLocations: ParkingLocation[];
  onPickLocation: (picked: {
    latitude: number;
    longitude: number;
    suggestedName?: string;
    suggestedAddress?: string;
    suggestedCity?: string;
  }) => void;
}

export function AdminLocationMapPicker({
  latitude,
  longitude,
  existingLocations,
  onPickLocation,
}: AdminLocationMapPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const pickerMarkerRef = useRef<import("leaflet").Marker | null>(null);
  const existingLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const onPickRef = useRef(onPickLocation);
  onPickRef.current = onPickLocation;

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<NominatimResult[]>([]);

  const reverseGeocode = async (lat: number, lon: number) => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&lat=${lat}&lon=${lon}`
      );
      if (!res.ok) return {};
      const data = (await res.json()) as NominatimResult;
      const addr = data.address || {};
      const city = addr.city || addr.town || addr.village || addr.state_district || "";
      const parts = [addr.road, addr.neighbourhood || addr.suburb].filter(Boolean);
      return {
        suggestedAddress: parts.length ? parts.join(", ") : data.display_name?.split(",").slice(0, 2).join(", "),
        suggestedCity: city,
      };
    } catch {
      return {};
    }
  };

  useEffect(() => {
    let mounted = true;

    async function initMap() {
      if (!containerRef.current || mapRef.current) return;
      const L = (await import("leaflet")).default;
      if (!mounted || !containerRef.current) return;

      const map = L.map(containerRef.current, {
        center: [latitude, longitude],
        zoom: 13,
        scrollWheelZoom: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);

      const existingGroup = L.layerGroup().addTo(map);
      existingLayerRef.current = existingGroup;

      const pinIcon = L.divIcon({
        className: "smartpark-picker-pin",
        html: `<div style="
          background:#4f46e5;
          color:#fff;
          border:3px solid #ffffff;
          border-radius:9999px;
          width:34px;
          height:34px;
          display:flex;
          align-items:center;
          justify-content:center;
          font-weight:700;
          font-size:14px;
          box-shadow:0 4px 14px rgba(79,70,229,0.5);
        ">+</div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      });

      const marker = L.marker([latitude, longitude], { icon: pinIcon, draggable: true }).addTo(map);
      marker.bindPopup("New Parking Hub Pin (drag or click map)");

      const handleNewCoords = async (lat: number, lng: number) => {
        const roundedLat = Number(lat.toFixed(6));
        const roundedLng = Number(lng.toFixed(6));
        onPickRef.current({ latitude: roundedLat, longitude: roundedLng });
        const geo = await reverseGeocode(roundedLat, roundedLng);
        if (geo.suggestedAddress || geo.suggestedCity) {
          onPickRef.current({
            latitude: roundedLat,
            longitude: roundedLng,
            suggestedAddress: geo.suggestedAddress,
            suggestedCity: geo.suggestedCity,
          });
        }
      };

      map.on("click", (evt: import("leaflet").LeafletMouseEvent) => {
        marker.setLatLng(evt.latlng);
        handleNewCoords(evt.latlng.lat, evt.latlng.lng);
      });

      marker.on("dragend", () => {
        const pos = marker.getLatLng();
        handleNewCoords(pos.lat, pos.lng);
      });

      mapRef.current = map;
      pickerMarkerRef.current = marker;
    }

    initMap();
    return () => {
      mounted = false;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        pickerMarkerRef.current = null;
        existingLayerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep pin synced when coordinates are edited or selected from search
  useEffect(() => {
    if (pickerMarkerRef.current && mapRef.current) {
      pickerMarkerRef.current.setLatLng([latitude, longitude]);
      mapRef.current.panTo([latitude, longitude]);
    }
  }, [latitude, longitude]);

  // Render existing hubs on map for reference
  useEffect(() => {
    let cancelled = false;
    async function renderExisting() {
      if (!existingLayerRef.current) return;
      const L = (await import("leaflet")).default;
      if (cancelled || !existingLayerRef.current) return;

      existingLayerRef.current.clearLayers();
      existingLocations.forEach((loc) => {
        const icon = L.divIcon({
          className: "smartpark-existing-pin",
          html: `<div style="
            background:#10b981;
            color:#fff;
            border:2px solid #ffffff;
            border-radius:9999px;
            width:28px;
            height:28px;
            display:flex;
            align-items:center;
            justify-content:center;
            font-weight:700;
            font-size:11px;
            box-shadow:0 2px 8px rgba(0,0,0,0.25);
          ">${loc.total_slots}</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });
        L.marker([loc.latitude, loc.longitude], { icon })
          .bindPopup(`<b>${loc.name}</b><br/>${loc.available_slots}/${loc.total_slots} slots available`)
          .addTo(existingLayerRef.current!);
      });
    }
    const timer = setTimeout(renderExisting, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [existingLocations]);

  const handleSearch = async () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&q=${encodeURIComponent(trimmed)}`
      );
      if (!res.ok) throw new Error("Map search service unavailable");
      const data = (await res.json()) as NominatimResult[];
      setResults(data);
      if (data.length === 0) {
        setSearchError("No places found. Try a broader area or click directly on the map.");
      }
    } catch {
      setSearchError("Could not reach map search service. You can still click directly on the map.");
    } finally {
      setSearching(false);
    }
  };

  const handleSelectResult = (item: NominatimResult) => {
    const lat = Number(parseFloat(item.lat).toFixed(6));
    const lon = Number(parseFloat(item.lon).toFixed(6));
    const addr = item.address || {};
    const city = addr.city || addr.town || addr.village || addr.state_district || "";
    const shortName = item.name || item.display_name.split(",")[0].trim();
    const streetParts = [addr.road, addr.neighbourhood || addr.suburb].filter(Boolean);
    const shortAddress = streetParts.length
      ? streetParts.join(", ")
      : item.display_name.split(",").slice(0, 3).join(", ").trim();

    onPickLocation({
      latitude: lat,
      longitude: lon,
      suggestedName: shortName ? `${shortName} Parking Hub` : undefined,
      suggestedAddress: shortAddress,
      suggestedCity: city,
    });
    if (mapRef.current) {
      mapRef.current.setView([lat, lon], 15);
    }
    setResults([]);
  };

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const lat = Number(pos.coords.latitude.toFixed(6));
      const lon = Number(pos.coords.longitude.toFixed(6));
      const geo = await reverseGeocode(lat, lon);
      onPickLocation({ latitude: lat, longitude: lon, ...geo });
      if (mapRef.current) mapRef.current.setView([lat, lon], 15);
    });
  };

  return (
    <div className="space-y-3">
      {/* Search Bar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSearch();
              }
            }}
            placeholder="Search map location (e.g., MG Road Bengaluru, Airport, Tech Park)..."
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={handleSearch}
          disabled={searching}
          className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shrink-0"
        >
          {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          Search Map
        </button>
        <button
          type="button"
          onClick={handleUseMyLocation}
          title="Center on my current location"
          className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold flex items-center justify-center gap-1.5 shrink-0"
        >
          <Crosshair className="w-3.5 h-3.5 text-blue-500" /> My Location
        </button>
      </div>

      {searchError && <div className="text-xs text-amber-500">{searchError}</div>}

      {/* Search Results Dropdown */}
      {results.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 divide-y divide-slate-100 dark:divide-slate-700 max-h-48 overflow-y-auto shadow-lg">
          {results.map((item) => (
            <button
              key={item.place_id}
              type="button"
              onClick={() => handleSelectResult(item)}
              className="w-full text-left px-3.5 py-2.5 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 flex items-start gap-2 text-xs transition-colors"
            >
              <MapPin className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
              <span className="line-clamp-2">{item.display_name}</span>
            </button>
          ))}
        </div>
      )}

      {/* Interactive Map */}
      <div className="relative w-full h-72 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
        <div ref={containerRef} className="w-full h-full z-10" />
      </div>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        Search an address above, or click/drag the purple <b>+</b> pin anywhere on the map to set the parking hub coordinates and auto-fill address details. Green markers show existing hubs.
      </p>
    </div>
  );
}

