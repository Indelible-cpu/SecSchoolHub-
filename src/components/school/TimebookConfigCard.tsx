import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, MapPin, ShieldCheck } from 'lucide-react';
import { saveTimebookSettings } from '../../school/firestoreService';
import { syncTimebookPolicyToServer } from '../../school/timebookApi';
import {
  buildDefaultTimebookSettings,
  DEFAULT_TIMEBOOK_RADIUS_METERS,
  isValidLatitude,
  isValidLongitude,
  validateMalawiCoordinates,
} from '../../school/timebookUtils';
import type { School, Teacher, TimebookSettings } from '../../school/types';
import { TimebookLocationMapPicker } from './TimebookLocationMapPicker';

interface TimebookConfigCardProps {
  school: School;
  teachers: Teacher[];
  timebookSettings: TimebookSettings | null;
  canManageTimebook: boolean;
  recordedByName: string;
  onOpenFullTimebook?: () => void;
}

const RADIUS_PRESETS = [75, 150, 300, 500];

export const TimebookConfigCard: React.FC<TimebookConfigCardProps> = ({
  school,
  teachers,
  timebookSettings,
  canManageTimebook,
  recordedByName,
  onOpenFullTimebook,
}) => {
  const basePolicy = timebookSettings || buildDefaultTimebookSettings(school.id, school.ownerId);

  const [latitude, setLatitude] = useState<number>(basePolicy.schoolLatitude);
  const [longitude, setLongitude] = useState<number>(basePolicy.schoolLongitude);
  const [radiusMeters, setRadiusMeters] = useState<number>(basePolicy.radiusMeters);
  const [detectingGps, setDetectingGps] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [gpsStatusMsg, setGpsStatusMsg] = useState('');
  const malawiCheck = validateMalawiCoordinates(latitude, longitude);

  useEffect(() => {
    const src = timebookSettings || buildDefaultTimebookSettings(school.id, school.ownerId);
    setLatitude(src.schoolLatitude);
    setLongitude(src.schoolLongitude);
    setRadiusMeters(src.radiusMeters);
    setErrorMsg('');
    setGpsStatusMsg('');
  }, [school.id, school.ownerId, timebookSettings]);

  const handleUseCurrentGps = () => {
    if (!canManageTimebook) return;
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setErrorMsg('GPS geolocation is not supported on this device/browser.');
      return;
    }

    setDetectingGps(true);
    setErrorMsg('');
    setGpsStatusMsg('');

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const nextLat = Number(pos.coords.latitude.toFixed(6));
        const nextLng = Number(pos.coords.longitude.toFixed(6));
        setLatitude(nextLat);
        setLongitude(nextLng);
        setDetectingGps(false);
        setGpsStatusMsg(
          `Pin snapped to current GPS (±${Math.round(pos.coords.accuracy)}m). Save configuration to apply.`
        );
      },
      (err) => {
        setDetectingGps(false);
        setErrorMsg(err.message || 'Unable to detect current school GPS coordinates.');
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }
    );
  };

  const handleMapSelect = (nextLat: number, nextLng: number) => {
    setLatitude(nextLat);
    setLongitude(nextLng);
    setErrorMsg('');
    setGpsStatusMsg('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageTimebook) return;

    setErrorMsg('');
    setGpsStatusMsg('');

    const parsedRadius = Math.round(Number(radiusMeters));

    if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) {
      setErrorMsg('Select a valid school location on the map.');
      return;
    }
    if (!Number.isFinite(parsedRadius) || parsedRadius < 20 || parsedRadius > 5000) {
      setErrorMsg('Attendance radius must be between 20 and 5000 meters.');
      return;
    }

    setSaving(true);
    try {
      const current = timebookSettings || buildDefaultTimebookSettings(school.id, school.ownerId);
      const nextSettings: Omit<
        TimebookSettings,
        'id' | 'ownerId' | 'schoolId' | 'createdAt' | 'updatedAt'
      > = {
        enabled: current.enabled,
        locationConfigured: true,
        locationLabel: current.locationLabel || school.name || 'School Main Campus',
        schoolLatitude: Number(latitude.toFixed(6)),
        schoolLongitude: Number(longitude.toFixed(6)),
        radiusMeters: parsedRadius || DEFAULT_TIMEBOOK_RADIUS_METERS,
        maxAccuracyMeters: current.maxAccuracyMeters,
        timezone: current.timezone,
        windowStartHHMM: current.windowStartHHMM,
        defaultDeadlineHHMM: current.defaultDeadlineHHMM,
        categoryDeadlines: current.categoryDeadlines || {},
        workdays: current.workdays,
        holidays: current.holidays || [],
        reminderSlots: current.reminderSlots,
        remindersEnabled: current.remindersEnabled,
        updatedBy: recordedByName || 'School Admin',
      };

      await saveTimebookSettings({
        schoolId: school.id,
        ownerId: school.ownerId,
        settings: nextSettings,
      });

      await syncTimebookPolicyToServer({
        schoolId: school.id,
        schoolName: school.name,
        ownerId: school.ownerId,
        settings: nextSettings,
        teachers,
      }).catch(() => undefined);

      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (err) {
      let friendly = 'Unable to save Timebook configuration.';
      if (err instanceof Error) {
        try {
          const parsed = JSON.parse(err.message) as { error?: string };
          friendly = parsed.error || err.message;
        } catch {
          friendly = err.message;
        }
      }
      setErrorMsg(friendly);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={handleSave}
      className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Timebook Configuration
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!malawiCheck.inMalawi && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 text-[11px] font-semibold">
              <AlertTriangle className="w-3 h-3" aria-hidden="true" />
              <span>Outside Malawi</span>
            </span>
          )}
          {basePolicy.locationConfigured ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 text-[11px] font-semibold">
              <ShieldCheck className="w-3 h-3" aria-hidden="true" />
              <span>{basePolicy.radiusMeters}m Active</span>
            </span>
          ) : (
            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 text-[11px] font-semibold">
              Location Not Set
            </span>
          )}
          {!canManageTimebook && (
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Owner Only
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Pin your school campus on the map and set the permitted Time In radius.
        </p>
        {onOpenFullTimebook && (
          <button
            type="button"
            onClick={onOpenFullTimebook}
            className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
          >
            Deadlines &amp; Logs →
          </button>
        )}
      </div>

      {gpsStatusMsg && (
        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 px-3 py-2 text-xs text-emerald-900 dark:text-emerald-200">
          {gpsStatusMsg}
        </div>
      )}

      {errorMsg && (
        <div className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">
          {errorMsg}
        </div>
      )}

      <TimebookLocationMapPicker
        latitude={latitude}
        longitude={longitude}
        radiusMeters={radiusMeters}
        disabled={!canManageTimebook}
        schoolDistrict={school.district}
        onChange={handleMapSelect}
        onUseCurrentGps={handleUseCurrentGps}
        detectingGps={detectingGps}
        heightClassName="h-60 sm:h-64"
      />

      <div className="space-y-2 pt-1">
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor="timebook-attendance-radius"
            className="text-xs font-medium text-slate-700 dark:text-slate-300"
          >
            Attendance Radius (meters)
          </label>
          <span className="text-xs font-mono font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
            {radiusMeters}m
          </span>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="range"
            min={20}
            max={1000}
            step={10}
            disabled={!canManageTimebook}
            value={Math.min(1000, Math.max(20, radiusMeters))}
            onChange={(e) => setRadiusMeters(Number(e.target.value))}
            aria-label="Attendance radius slider"
            className="flex-1 accent-emerald-700 cursor-pointer disabled:opacity-50"
          />
          <input
            id="timebook-attendance-radius"
            type="number"
            min={20}
            max={5000}
            step={1}
            required
            disabled={!canManageTimebook}
            value={radiusMeters}
            onChange={(e) => setRadiusMeters(Number(e.target.value) || 20)}
            className="w-24 min-h-[38px] px-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-xs tabular-nums disabled:opacity-60"
          />
        </div>

        {canManageTimebook && (
          <div className="flex flex-wrap items-center gap-1.5">
            {RADIUS_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setRadiusMeters(preset)}
                className={`min-h-[28px] px-2.5 rounded-lg text-[11px] font-mono font-semibold cursor-pointer transition-colors ${
                  radiusMeters === preset
                    ? 'bg-emerald-700 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {preset}m
              </button>
            ))}
          </div>
        )}
      </div>

      {canManageTimebook && (
        <button
          type="submit"
          disabled={saving}
          className="w-full inline-flex items-center justify-center gap-2 min-h-[44px] rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
        >
          {savedFlash ? (
            <>
              <Check className="w-4 h-4" aria-hidden="true" />
              <span>Timebook Configuration Saved</span>
            </>
          ) : (
            <span>{saving ? 'Saving Configuration...' : 'Save Timebook Configuration'}</span>
          )}
        </button>
      )}
    </form>
  );
};
