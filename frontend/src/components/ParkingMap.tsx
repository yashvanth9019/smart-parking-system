"use client";

import React, { useEffect, useRef } from "react";
import type { ParkingLocation } from "@/types";

interface ParkingMapProps {
  locations: ParkingLocation[];
  selectedLocationId?: string;
  onSelectLocation: (loc: ParkingLocation) => void;
}

export function ParkingMap({ locations, selectedLocationId, onSelectLocation }: ParkingMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const layerRef = useRef<import("leaflet").LayerGroup | null>(null);

  useEffect(() => {
    let mounted = true;

    async function initMap() {
      if (!containerRef.current || mapRef.current) return;
      const L = (await import("leaflet")).default;

      if (!mounted || !containerRef.current) return;
      const center: [number, number] = locations.length
        ? [locations[0].latitude, locations[0].longitude]
        : [12.9716, 77.5946];

      const map = L.map(containerRef.current, {
        center,
        zoom: 12,
        scrollWheelZoom: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);

      const group = L.layerGroup().addTo(map);
      mapRef.current = map;
      layerRef.current = group;
    }

    initMap();

    return () => {
      mounted = false;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        layerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function renderMarkers() {
      if (!mapRef.current || !layerRef.current) return;
      const L = (await import("leaflet")).default;
      if (cancelled || !layerRef.current || !mapRef.current) return;

      layerRef.current.clearLayers();
      const bounds: [number, number][] = [];

      locations.forEach((loc) => {
        const isSelected = loc.id === selectedLocationId;
        const color =
          loc.available_slots > 3 ? "#10b981" : loc.available_slots > 0 ? "#f59e0b" : "#ef4444";

        const icon = L.divIcon({
          className: "smartpark-map-pin",
          html: `<div style="
            background:${color};
            color:#fff;
            border:3px solid ${isSelected ? "#2563eb" : "#ffffff"};
            border-radius:9999px;
            width:${isSelected ? "42px" : "34px"};
            height:${isSelected ? "42px" : "34px"};
            display:flex;
            align-items:center;
            justify-content:center;
            font-weight:700;
            font-size:12px;
            box-shadow:0 4px 12px rgba(0,0,0,0.3);
          ">${loc.available_slots}</div>`,
          iconSize: isSelected ? [42, 42] : [34, 34],
          iconAnchor: isSelected ? [21, 21] : [17, 17],
        });

        const marker = L.marker([loc.latitude, loc.longitude], { icon });
        marker.bindPopup(`
          <div style="min-width:200px;font-family:sans-serif;color:#0f172a">
            <div style="font-weight:700;font-size:14px;margin-bottom:4px;">${loc.name}</div>
            <div style="font-size:12px;color:#475569;margin-bottom:6px;">${loc.address}</div>
            <div style="display:flex;gap:8px;font-size:12px;margin-bottom:6px;">
              <span style="color:#059669;font-weight:600;">Avail: ${loc.available_slots}</span>
              <span style="color:#dc2626;font-weight:600;">Occ: ${loc.occupied_slots}</span>
              <span style="color:#d97706;font-weight:600;">Res: ${loc.reserved_slots}</span>
            </div>
            <div style="font-size:12px;">Rate: <b>INR ${loc.current_hourly_rate}/hr</b> • ${loc.operating_hours}</div>
          </div>
        `);
        marker.on("click", () => onSelectLocation(loc));
        marker.addTo(layerRef.current!);
        bounds.push([loc.latitude, loc.longitude]);
      });

      if (bounds.length > 0 && !selectedLocationId) {
        mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
      } else if (selectedLocationId) {
        const selected = locations.find((l) => l.id === selectedLocationId);
        if (selected) {
          mapRef.current.panTo([selected.latitude, selected.longitude]);
        }
      }
    }

    const timer = setTimeout(renderMarkers, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [locations, selectedLocationId, onSelectLocation]);

  return (
    <div className="relative w-full h-[340px] sm:h-[380px] rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900">
      <div ref={containerRef} className="w-full h-full z-10" />
    </div>
  );
}

