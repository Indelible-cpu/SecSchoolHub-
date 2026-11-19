import { CURRENCIES, CurrencyCode, SavedCalculation } from '../types';

export function getCurrencyInfo(code: CurrencyCode) {
  return CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0];
}

export function formatCurrency(value: number, currencyCode: CurrencyCode): string {
  if (!Number.isFinite(value)) return '—';
  const info = getCurrencyInfo(currencyCode);

  const isNegative = value < 0;
  const abs = Math.abs(value);
  const hasFraction = Math.abs(abs - Math.round(abs)) >= 0.005;

  // Format MWK and African regional symbols cleanly (e.g. MK 15,000 or MK 15,000.50)
  if (
    currencyCode === 'MWK' ||
    currencyCode === 'ZMW' ||
    currencyCode === 'KES' ||
    currencyCode === 'TZS' ||
    currencyCode === 'MZN' ||
    currencyCode === 'ZAR'
  ) {
    const decimals = info.decimals === 0 ? 0 : hasFraction ? 2 : 0;
    const formattedNum = new Intl.NumberFormat(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(abs);
    return `${isNegative ? '-' : ''}${info.symbol} ${formattedNum}`;
  }

  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: info.code,
      minimumFractionDigits: info.decimals === 0 ? 0 : hasFraction ? 2 : info.decimals,
      maximumFractionDigits: info.decimals,
    }).format(value);
  } catch {
    return `${isNegative ? '-' : ''}${info.symbol}${abs.toFixed(info.decimals)}`;
  }
}

export function formatNumber(value: number, maxDecimals = 2): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  }).format(value);
}

export function formatPercent(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(decimals)}%`;
}

export function parseSafeFloat(raw: string): number {
  const cleaned = raw.replace(/,/g, '').trim();
  if (!cleaned) return 0;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

export function exportLedgerToCSV(items: SavedCalculation[]): string {
  const escape = (str: string) => `"${str.replace(/"/g, '""')}"`;
  const headers = ['Date', 'Category', 'Title', 'Primary Metric', 'Value', 'Breakdown'];
  const rows = items.map((item) => {
    const dateStr = new Date(item.createdAt).toLocaleString();
    const breakdown = item.details.map((d) => `${d.label}: ${d.value}`).join(' | ');
    return [
      escape(dateStr),
      escape(item.category.toUpperCase()),
      escape(item.title),
      escape(item.primaryMetricLabel),
      escape(item.primaryMetricValue),
      escape(breakdown),
    ].join(',');
  });
  return [headers.join(','), ...rows].join('\n');
}
