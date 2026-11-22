import React, { useEffect, useState } from 'react';
import { Check, Crosshair, MapPin, ShieldCheck } from 'lucide-react';
import { saveTimebookSettings } from '../../school/firestoreService';
import { syncTimebookPolicyToServer } from '../../school/timebookApi';
import {
  buildDefaultTimebookSettings,
  DEFAULT_TIMEBOOK_RADIUS_METERS,
  isValidLatitude,
  isValidLongitude,
} from '../../school/timebookUtils';
import type { School, Teacher, TimebookSettings } from '../../school/types';

interface TimebookConfigCardProps {
  school: School;
  teachers: Teacher[];
  timebookSettings: TimebookSettings | null;
  canManageTimebook: boolean;
  recordedByName: string;
  onOpenFullTimebook?: () => void;
}

export const TimebookConfigCard: React.FC<TimebookConfigCardProps> = ({
  school,
  teachers,
  timebookSettings,
  canManageTimebook,
  recordedByName,
  onOpenFullTimebook,
}) => {
  const basePolicy = timebookSettings || buildDefaultTimebookSettings(school.id, school.ownerId);

  const [latitude, setLatitude] = useState(String(basePolicy.schoolLatitude));
  const [longitude, setLongitude] = useState(String(basePolicy.schoolLongitude));
  const [radiusMeters, setRadiusMeters] = useState(String(basePolicy.radiusMeters));
  const [detectingGps, setDetectingGps] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [gpsStatusMsg, setGpsStatusMsg] = useState('');

  useEffect(() => {
    const src = timebookSettings || buildDefaultTimebookSettings(school.id, school.ownerId);
    setLatitude(String(src.schoolLatitude));
    setLongitude(String(src.schoolLongitude));
    setRadiusMeters(String(src.radiusMeters));
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
        const nextLat = pos.coords.latitude.toFixed(6);
        const nextLng = pos.coords.longitude.toFixed(6);
        setLatitude(nextLat);
        setLongitude(nextLng);
        setDetectingGps(false);
        setGpsStatusMsg(
          `Captured campus coordinates (${nextLat}, ${nextLng}, ±${Math.round(pos.coords.accuracy)}m). Click Save Timebook Configuration to apply.`
        );
      },
      (err) => {
        setDetectingGps(false);
        setErrorMsg(err.message || 'Unable to detect current school GPS coordinates.');
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }
    );
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageTimebook) return;

    setErrorMsg('');
    setGpsStatusMsg('');

    const parsedLat = Number(latitude.trim());
    const parsedLng = Number(longitude.trim());
    const parsedRadius = Math.round(Number(radiusMeters.trim()));

    if (latitude.trim() === '' || !isValidLatitude(parsedLat)) {
      setErrorMsg('Enter a valid school latitude between -90 and 90.');
      return;
    }
    if (longitude.trim() === '' || !isValidLongitude(parsedLng)) {
      setErrorMsg('Enter a valid school longitude between -180 and 180.');
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
        schoolLatitude: Number(parsedLat.toFixed(6)),
        schoolLongitude: Number(parsedLng.toFixed(6)),
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

        <div className="flex items-center gap-2">
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

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Set the school campus GPS coordinates and attendance radius (in meters) used to verify daily staff Time In.
      </p>

      {canManageTimebook && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            disabled={detectingGps}
            onClick={handleUseCurrentGps}
            className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Crosshair className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
            <span>{detectingGps ? 'Detecting GPS...' : 'Use Current School GPS'}</span>
          </button>

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
      )}

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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label
            htmlFor="timebook-school-latitude"
            className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
          >
            Latitude
          </label>
          <input
            id="timebook-school-latitude"
            type="number"
            step="0.000001"
            min={-90}
            max={90}
            required
            disabled={!canManageTimebook}
            value={latitude}
            onChange={(e) => setLatitude(e.target.value)}
            placeholder="-15.786100"
            className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm tabular-nums disabled:opacity-60"
          />
        </div>

        <div>
          <label
            htmlFor="timebook-school-longitude"
            className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
          >
            Longitude
          </label>
          <input
            id="timebook-school-longitude"
            type="number"
            step="0.000001"
            min={-180}
            max={180}
            required
            disabled={!canManageTimebook}
            value={longitude}
            onChange={(e) => setLongitude(e.target.value)}
            placeholder="35.005800"
            className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm tabular-nums disabled:opacity-60"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="timebook-attendance-radius"
          className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
        >
          Attendance Radius (meters)
        </label>
        <input
          id="timebook-attendance-radius"
          type="number"
          min={20}
          max={5000}
          step={1}
          required
          disabled={!canManageTimebook}
          value={radiusMeters}
          onChange={(e) => setRadiusMeters(e.target.value)}
          placeholder="150"
          className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm tabular-nums disabled:opacity-60"
        />
        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
          Permitted distance from campus coordinates (20m – 5000m).
        </p>
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
