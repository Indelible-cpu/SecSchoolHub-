import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  AlertTriangle,
  CheckCircle2,
  Crosshair,
  Layers,
  LocateFixed,
  MapPin,
  Search,
} from 'lucide-react';
import {
  isValidLatitude,
  isValidLongitude,
  MALAWI_DEFAULT_COORDS,
  validateMalawiCoordinates,
} from '../../school/timebookUtils';

interface TimebookLocationMapPickerProps {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  disabled?: boolean;
  schoolDistrict?: string;
  onChange: (lat: number, lng: number) => void;
  onUseCurrentGps?: () => void;
  detectingGps?: boolean;
  heightClassName?: string;
}

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

const STREET_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const STREET_ATTRIBUTION = '&copy; OpenStreetMap contributors';
const SATELLITE_TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SATELLITE_ATTRIBUTION = 'Tiles &copy; Esri';

function createCampusPinIcon(inMalawi: boolean): L.DivIcon {
  const fillColor = inMalawi ? '#047857' : '#d97706';
  return L.divIcon({
    className: 'sec-school-map-pin',
    html: `<div style="position:relative;width:32px;height:40px;display:flex;align-items:center;justify-content:center;">
      <svg width="32" height="40" viewBox="0 0 32 40" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 3px 6px rgba(15,23,42,0.38));">
        <path d="M16 1C7.716 1 1 7.716 1 16C1 26.5 16 39 16 39C16 39 31 26.5 31 16C31 7.716 24.284 1 16 1Z" fill="${fillColor}" stroke="#ffffff" stroke-width="2"/>
        <circle cx="16" cy="15.5" r="5.5" fill="#ffffff"/>
      </svg>
    </div>`,
    iconSize: [32, 40],
    iconAnchor: [16, 38],
  });
}

export const TimebookLocationMapPicker: React.FC<TimebookLocationMapPickerProps> = ({
  latitude,
  longitude,
  radiusMeters,
  disabled = false,
  schoolDistrict,
  onChange,
  onUseCurrentGps,
  detectingGps = false,
  heightClassName = 'h-64 sm:h-72',
}) => {
  const safeLat = isValidLatitude(latitude) ? latitude : MALAWI_DEFAULT_COORDS.latitude;
  const safeLng = isValidLongitude(longitude) ? longitude : MALAWI_DEFAULT_COORDS.longitude;
  const safeRadius = Math.min(5000, Math.max(20, Number(radiusMeters) || 150));
  const malawiCheck = validateMalawiCoordinates(safeLat, safeLng);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const onChangeRef = useRef(onChange);
  const disabledRef = useRef(disabled);

  onChangeRef.current = onChange;
  disabledRef.current = disabled;

  const [tileMode, setTileMode] = useState<'street' | 'satellite'>('street');
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<NominatimResult[]>([]);
  const [searchError, setSearchError] = useState('');

  // Initialize Leaflet map once
  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    const map = L.map(el, {
      center: [safeLat, safeLng],
      zoom: 16,
      zoomControl: true,
      scrollWheelZoom: true,
    });

    const tiles = L.tileLayer(STREET_TILE_URL, {
      attribution: STREET_ATTRIBUTION,
      maxZoom: 19,
    }).addTo(map);

    const circle = L.circle([safeLat, safeLng], {
      radius: safeRadius,
      color: malawiCheck.inMalawi ? '#047857' : '#d97706',
      weight: 2,
      fillColor: malawiCheck.inMalawi ? '#10b981' : '#f59e0b',
      fillOpacity: 0.16,
    }).addTo(map);

    const marker = L.marker([safeLat, safeLng], {
      icon: createCampusPinIcon(malawiCheck.inMalawi),
      draggable: !disabledRef.current,
    }).addTo(map);

    marker.on('dragend', () => {
      if (disabledRef.current) return;
      const pos = marker.getLatLng();
      const nextLat = Number(pos.lat.toFixed(6));
      const nextLng = Number(pos.lng.toFixed(6));
      circle.setLatLng([nextLat, nextLng]);
      onChangeRef.current(nextLat, nextLng);
    });

    map.on('click', (evt: L.LeafletMouseEvent) => {
      if (disabledRef.current) return;
      const nextLat = Number(evt.latlng.lat.toFixed(6));
      const nextLng = Number(evt.latlng.lng.toFixed(6));
      marker.setLatLng([nextLat, nextLng]);
      circle.setLatLng([nextLat, nextLng]);
      onChangeRef.current(nextLat, nextLng);
    });

    mapRef.current = map;
    tileLayerRef.current = tiles;
    markerRef.current = marker;
    circleRef.current = circle;

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            map.invalidateSize({ animate: false });
          })
        : null;
    resizeObserver?.observe(el);

    setTimeout(() => {
      map.invalidateSize({ animate: false });
    }, 80);

    return () => {
      resizeObserver?.disconnect();
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync marker drag capability when disabled toggles
  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) return;
    if (disabled) {
      marker.dragging?.disable();
    } else {
      marker.dragging?.enable();
    }
  }, [disabled]);

  // Sync coordinates and radius circle when props change externally (GPS capture, search, school switch)
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    const circle = circleRef.current;
    if (!map || !marker || !circle) return;

    const current = marker.getLatLng();
    const movedSignificantly =
      Math.abs(current.lat - safeLat) > 0.000001 || Math.abs(current.lng - safeLng) > 0.000001;

    if (movedSignificantly) {
      marker.setLatLng([safeLat, safeLng]);
      circle.setLatLng([safeLat, safeLng]);
      map.panTo([safeLat, safeLng], { animate: true });
    }
    circle.setRadius(safeRadius);
    circle.setStyle({
      color: malawiCheck.inMalawi ? '#047857' : '#d97706',
      fillColor: malawiCheck.inMalawi ? '#10b981' : '#f59e0b',
    });
    marker.setIcon(createCampusPinIcon(malawiCheck.inMalawi));
  }, [safeLat, safeLng, safeRadius, malawiCheck.inMalawi]);

  // Switch between Street and Satellite base layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }
    const nextUrl = tileMode === 'satellite' ? SATELLITE_TILE_URL : STREET_TILE_URL;
    const nextAttribution =
      tileMode === 'satellite' ? SATELLITE_ATTRIBUTION : STREET_ATTRIBUTION;

    tileLayerRef.current = L.tileLayer(nextUrl, {
      attribution: nextAttribution,
      maxZoom: 19,
    }).addTo(map);
  }, [tileMode]);

  const handleRecenterOnPin = () => {
    const map = mapRef.current;
    if (!map) return;
    map.setView([safeLat, safeLng], Math.max(map.getZoom(), 16), { animate: true });
  };

  const handlePlaceSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const raw = searchQuery.trim();
    if (!raw || disabled) return;

    setSearching(true);
    setSearchError('');
    setSearchResults([]);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=mw&q=${encodeURIComponent(
        raw
      )}`;
      let res = await fetch(url, {
        headers: { Accept: 'application/json' },
      });
      let items: NominatimResult[] = res.ok ? await res.json() : [];

      if (items.length === 0) {
        const fallbackUrl = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(
          schoolDistrict ? `${raw}, ${schoolDistrict}, Malawi` : raw
        )}`;
        res = await fetch(fallbackUrl, { headers: { Accept: 'application/json' } });
        items = res.ok ? await res.json() : [];
      }

      if (items.length === 0) {
        setSearchError('No matching location found. Drag the pin or click directly on the map.');
      } else {
        setSearchResults(items);
      }
    } catch {
      setSearchError('Location search unavailable offline. Click or drag the pin on the map.');
    } finally {
      setSearching(false);
    }
  };

  const handleSelectSearchResult = (item: NominatimResult) => {
    const nextLat = Number(Number(item.lat).toFixed(6));
    const nextLng = Number(Number(item.lon).toFixed(6));
    if (!isValidLatitude(nextLat) || !isValidLongitude(nextLng)) return;

    setSearchResults([]);
    setSearchError('');
    markerRef.current?.setLatLng([nextLat, nextLng]);
    circleRef.current?.setLatLng([nextLat, nextLng]);
    mapRef.current?.setView([nextLat, nextLng], 16, { animate: true });
    onChange(nextLat, nextLng);
  };

  return (
    <div className="space-y-2.5">
      {!disabled && (
        <div className="relative">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search
                className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handlePlaceSearch();
                  }
                }}
                placeholder={
                  schoolDistrict
                    ? `Search school or area in ${schoolDistrict}...`
                    : 'Search school, town, or district...'
                }
                aria-label="Search school location on map"
                className="w-full min-h-[38px] pl-8 pr-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs"
              />
            </div>
            <button
              type="button"
              disabled={searching || !searchQuery.trim()}
              onClick={() => handlePlaceSearch()}
              className="min-h-[38px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {searching ? 'Searching...' : 'Find'}
            </button>
          </div>

          {searchResults.length > 0 && (
            <div className="mt-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F141B] divide-y divide-slate-100 dark:divide-slate-800 shadow-lg max-h-44 overflow-y-auto">
              {searchResults.map((item) => (
                <button
                  key={item.place_id}
                  type="button"
                  onClick={() => handleSelectSearchResult(item)}
                  className="w-full px-3 py-2 text-left text-xs text-slate-700 dark:text-slate-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 flex items-start gap-2 cursor-pointer"
                >
                  <MapPin className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <span className="line-clamp-2">{item.display_name}</span>
                </button>
              ))}
            </div>
          )}

          {searchError && (
            <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">{searchError}</p>
          )}
        </div>
      )}

      <div className="relative isolate rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900">
        <div ref={containerRef} className={`w-full ${heightClassName} z-0`} />

        {/* Map Controls Overlay */}
        <div className="absolute top-2.5 right-2.5 z-[400] flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => setTileMode((prev) => (prev === 'street' ? 'satellite' : 'street'))}
            title={tileMode === 'street' ? 'Switch to Satellite imagery' : 'Switch to Street map'}
            className="inline-flex items-center gap-1 min-h-[32px] px-2.5 rounded-lg bg-white/95 dark:bg-[#161B22]/95 border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-800 dark:text-slate-100 shadow-sm hover:bg-white dark:hover:bg-slate-800 whitespace-nowrap cursor-pointer"
          >
            <Layers className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
            <span>{tileMode === 'street' ? 'Satellite' : 'Street'}</span>
          </button>

          <button
            type="button"
            onClick={handleRecenterOnPin}
            title="Center map on campus pin"
            className="inline-flex items-center gap-1 min-h-[32px] px-2.5 rounded-lg bg-white/95 dark:bg-[#161B22]/95 border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-800 dark:text-slate-100 shadow-sm hover:bg-white dark:hover:bg-slate-800 whitespace-nowrap cursor-pointer"
          >
            <LocateFixed className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
            <span>Center Pin</span>
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1.5 font-mono tabular-nums text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 rounded-lg">
            <MapPin
              className={`w-3.5 h-3.5 shrink-0 ${
                malawiCheck.inMalawi
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-amber-600 dark:text-amber-400'
              }`}
              aria-hidden="true"
            />
            <span>
              {safeLat.toFixed(6)}, {safeLng.toFixed(6)}
            </span>
          </div>

          <span
            role="status"
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg font-semibold ${
              malawiCheck.inMalawi
                ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900'
                : 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
            }`}
          >
            {malawiCheck.inMalawi ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Within Malawi</span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Outside Malawi</span>
              </>
            )}
          </span>
        </div>

        {!disabled && onUseCurrentGps && (
          <button
            type="button"
            disabled={detectingGps}
            onClick={onUseCurrentGps}
            className="inline-flex items-center gap-1.5 min-h-[34px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Crosshair className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
            <span>{detectingGps ? 'Detecting GPS...' : 'Use Current GPS'}</span>
          </button>
        )}
      </div>

      {!malawiCheck.inMalawi && (
        <div
          role="alert"
          className="rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 px-3 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900 dark:text-amber-200"
        >
          <div className="flex items-start gap-2 min-w-0 flex-1">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{malawiCheck.reason}</span>
          </div>
          {!disabled && (
            <button
              type="button"
              onClick={() => {
                markerRef.current?.setLatLng([
                  MALAWI_DEFAULT_COORDS.latitude,
                  MALAWI_DEFAULT_COORDS.longitude,
                ]);
                circleRef.current?.setLatLng([
                  MALAWI_DEFAULT_COORDS.latitude,
                  MALAWI_DEFAULT_COORDS.longitude,
                ]);
                mapRef.current?.setView(
                  [MALAWI_DEFAULT_COORDS.latitude, MALAWI_DEFAULT_COORDS.longitude],
                  15,
                  { animate: true }
                );
                onChange(MALAWI_DEFAULT_COORDS.latitude, MALAWI_DEFAULT_COORDS.longitude);
              }}
              className="min-h-[30px] px-2.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-[11px] font-semibold whitespace-nowrap shrink-0 cursor-pointer"
            >
              Center on Malawi
            </button>
          )}
        </div>
      )}

      {!disabled && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Click anywhere on the map or drag the campus pin to set your school location. The shaded ring shows the {safeRadius}m attendance geofence.
        </p>
      )}
    </div>
  );
};
