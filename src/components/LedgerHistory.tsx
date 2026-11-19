import React, { useMemo, useState } from 'react';
import { Check, Copy, Download, Search, Sun, Moon, Trash2 } from 'lucide-react';
import { AppSettings, CURRENCIES, CalculationCategory, CurrencyCode, SavedCalculation } from '../types';
import { exportLedgerToCSV } from '../utils/format';
import { PWAInstallButton } from './PWAInstallButton';

interface LedgerHistoryProps {
  items: SavedCalculation[];
  onDeleteItem: (id: string) => void;
  onClearAll: () => void;
  settings: AppSettings;
  onUpdateSettings: (next: Partial<AppSettings>) => void;
}

const CATEGORY_LABELS: Record<CalculationCategory, string> = {
  pricing: 'Pricing',
  keypad: 'Keypad',
  breakeven: 'Break-Even',
  loan: 'Loan',
  roi: 'ROI',
};

export const LedgerHistory: React.FC<LedgerHistoryProps> = ({
  items,
  onDeleteItem,
  onClearAll,
  settings,
  onUpdateSettings,
}) => {
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState<'all' | CalculationCategory>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (filterCat !== 'all' && item.category !== filterCat) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.primaryMetricValue.toLowerCase().includes(q) ||
        item.details.some(
          (d) => d.label.toLowerCase().includes(q) || d.value.toLowerCase().includes(q)
        )
      );
    });
  }, [filterCat, items, search]);

  const handleCopyItem = async (item: SavedCalculation) => {
    const text = [
      item.title,
      `${item.primaryMetricLabel}: ${item.primaryMetricValue}`,
      ...item.details.map((d) => `${d.label}: ${d.value}`),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 1600);
    } catch {
      // Ignore clipboard failures
    }
  };

  const handleDownloadCSV = () => {
    if (items.length === 0) return;
    const csv = exportLedgerToCSV(items);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ledgercalc-export-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Saved Calculations Ledger */}
      <section className="lg:col-span-7 bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Saved Ledger
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Stored locally on your device for instant offline access.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadCSV}
              disabled={items.length === 0}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Export CSV</span>
            </button>
            {items.length > 0 && (
              <button
                type="button"
                onClick={onClearAll}
                className="inline-flex items-center gap-1.5 min-h-[40px] px-3 py-2 rounded-xl text-xs font-medium text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Clear</span>
              </button>
            )}
          </div>
        </div>

        {/* Search and Category Filter */}
        <div className="mt-4 space-y-3">
          <div className="relative">
            <Search
              className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search saved quotes, loans, or totals..."
              aria-label="Search saved calculations"
              className="w-full min-h-[44px] pl-10 pr-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {(['all', 'pricing', 'keypad', 'breakeven', 'loan', 'roi'] as const).map((cat) => {
              const active = filterCat === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setFilterCat(cat)}
                  className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    active
                      ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {cat === 'all' ? 'All' : CATEGORY_LABELS[cat]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Items List */}
        <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800/80">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
              {items.length === 0
                ? 'No saved calculations yet. Tap "Save Quote" or "Save Result" in any calculator.'
                : 'No saved calculations match your filter.'}
            </div>
          ) : (
            filtered.map((item) => (
              <article key={item.id} className="py-4 first:pt-2 last:pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span>{CATEGORY_LABELS[item.category]}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {new Date(item.createdAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <h3 className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {item.title}
                    </h3>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {item.primaryMetricLabel}
                    </div>
                    <div className="text-base font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                      {item.primaryMetricValue}
                    </div>
                  </div>
                </div>

                {item.details.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
                    {item.details.map((d, idx) => (
                      <span key={idx} className="font-mono tabular-nums">
                        <span className="font-sans text-slate-500 dark:text-slate-400">{d.label}: </span>
                        <span className="text-slate-800 dark:text-slate-200">{d.value}</span>
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopyItem(item)}
                    className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
                  >
                    {copiedId === item.id ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteItem(item.id)}
                    aria-label={`Delete ${item.title}`}
                    className="inline-flex items-center gap-1 min-h-[36px] px-3 rounded-lg text-xs font-medium text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Remove</span>
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      {/* Preferences & Mobile Install Panel */}
      <aside className="lg:col-span-5 space-y-6">
        <section className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6">
          <PWAInstallButton variant="card" />
        </section>

        <section className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Calculator Preferences
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Defaults apply across Pricing, Keypad (+TAX / −TAX), and Break-Even.
            </p>
          </div>

          <div>
            <label
              htmlFor="pref-currency"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Country &amp; Currency
            </label>
            <select
              id="pref-currency"
              value={settings.currency}
              onChange={(e) => {
                const nextCode = e.target.value as CurrencyCode;
                const found = CURRENCIES.find((c) => c.code === nextCode);
                onUpdateSettings({
                  currency: nextCode,
                  defaultTaxRate: found ? found.defaultTaxRate : settings.defaultTaxRate,
                });
              }}
              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Automatically applies the country&apos;s standard VAT rate, which you can customize below.
            </p>
          </div>

          <div>
            <label
              htmlFor="pref-tax"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Default Sales Tax / VAT (%)
            </label>
            <div className="relative">
              <input
                id="pref-tax"
                type="number"
                inputMode="decimal"
                min="0"
                max="100"
                step="any"
                value={settings.defaultTaxRate}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  onUpdateSettings({ defaultTaxRate: Number.isFinite(v) ? Math.max(0, v) : 0 });
                }}
                className="w-full min-h-[44px] pl-3.5 pr-8 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono tabular-nums text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-mono text-slate-400">
                %
              </span>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-slate-900 dark:text-slate-100">Theme</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Switch between light ledger and dark slate.
              </div>
            </div>
            <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => onUpdateSettings({ theme: 'light' })}
                className={`inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  settings.theme === 'light'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400'
                }`}
              >
                <Sun className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Light</span>
              </button>
              <button
                type="button"
                onClick={() => onUpdateSettings({ theme: 'dark' })}
                className={`inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  settings.theme === 'dark'
                    ? 'bg-[#1E2530] text-white shadow-xs'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400'
                }`}
              >
                <Moon className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Dark</span>
              </button>
            </div>
          </div>
        </section>
      </aside>
    </div>
  );
};
