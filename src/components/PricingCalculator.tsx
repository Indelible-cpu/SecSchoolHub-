import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, BookmarkPlus, RotateCcw } from 'lucide-react';
import { CurrencyCode, SavedCalculation } from '../types';
import { formatCurrency, formatPercent, getCurrencyInfo, parseSafeFloat } from '../utils/format';

type PricingMode = 'cost_margin' | 'cost_markup' | 'cost_price';

interface PricingCalculatorProps {
  currency: CurrencyCode;
  defaultTaxRate: number;
  onSaveCalculation: (calc: Omit<SavedCalculation, 'id' | 'createdAt'>) => void;
}

export const PricingCalculator: React.FC<PricingCalculatorProps> = ({
  currency,
  defaultTaxRate,
  onSaveCalculation,
}) => {
  const currencyInfo = getCurrencyInfo(currency);

  const [mode, setMode] = useState<PricingMode>('cost_margin');
  const [itemLabel, setItemLabel] = useState('');
  const [costStr, setCostStr] = useState('15000');
  const [marginStr, setMarginStr] = useState('30');
  const [markupStr, setMarkupStr] = useState('42.86');
  const [priceStr, setPriceStr] = useState('21500');
  const [quantityStr, setQuantityStr] = useState('1');
  const [discountStr, setDiscountStr] = useState('0');
  const [taxRateStr, setTaxRateStr] = useState(String(defaultTaxRate));
  const [taxInclusive, setTaxInclusive] = useState(false);

  const [copied, setCopied] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    setTaxRateStr(String(defaultTaxRate));
  }, [defaultTaxRate]);

  const calc = useMemo(() => {
    const cost = Math.max(0, parseSafeFloat(costStr));
    const qty = Math.max(1, Math.floor(parseSafeFloat(quantityStr) || 1));
    const discountPct = Math.min(100, Math.max(0, parseSafeFloat(discountStr)));
    const taxPct = Math.max(0, parseSafeFloat(taxRateStr));

    let listUnitPrice = 0;

    if (mode === 'cost_margin') {
      const targetMargin = Math.min(99.9, Math.max(-500, parseSafeFloat(marginStr)));
      listUnitPrice = targetMargin >= 100 ? cost : cost / (1 - targetMargin / 100);
    } else if (mode === 'cost_markup') {
      const targetMarkup = Math.max(-100, parseSafeFloat(markupStr));
      listUnitPrice = cost * (1 + targetMarkup / 100);
    } else {
      listUnitPrice = Math.max(0, parseSafeFloat(priceStr));
    }

    const discountedGrossUnit = listUnitPrice * (1 - discountPct / 100);

    let netUnitRevenue = 0;
    let taxPerUnit = 0;
    let customerUnitTotal = 0;

    if (taxInclusive) {
      customerUnitTotal = discountedGrossUnit;
      netUnitRevenue = taxPct > 0 ? discountedGrossUnit / (1 + taxPct / 100) : discountedGrossUnit;
      taxPerUnit = customerUnitTotal - netUnitRevenue;
    } else {
      netUnitRevenue = discountedGrossUnit;
      taxPerUnit = netUnitRevenue * (taxPct / 100);
      customerUnitTotal = netUnitRevenue + taxPerUnit;
    }

    const unitProfit = netUnitRevenue - cost;
    const effectiveMargin = netUnitRevenue > 0 ? (unitProfit / netUnitRevenue) * 100 : 0;
    const effectiveMarkup = cost > 0 ? (unitProfit / cost) * 100 : 0;

    const totalCost = cost * qty;
    const totalNetRevenue = netUnitRevenue * qty;
    const totalTax = taxPerUnit * qty;
    const totalCustomerDue = customerUnitTotal * qty;
    const totalProfit = unitProfit * qty;
    const totalDiscountGiven = (listUnitPrice - discountedGrossUnit) * qty;

    const base = Math.max(totalCustomerDue, totalCost, 0.01);
    const costShare = Math.min(100, Math.max(0, (totalCost / base) * 100));
    const profitShare = totalProfit > 0 ? Math.min(100 - costShare, (totalProfit / base) * 100) : 0;
    const taxShare = Math.min(100 - costShare - profitShare, Math.max(0, (totalTax / base) * 100));

    return {
      cost,
      qty,
      discountPct,
      taxPct,
      listUnitPrice,
      netUnitRevenue,
      taxPerUnit,
      customerUnitTotal,
      unitProfit,
      effectiveMargin,
      effectiveMarkup,
      totalCost,
      totalNetRevenue,
      totalTax,
      totalCustomerDue,
      totalProfit,
      totalDiscountGiven,
      costShare,
      profitShare,
      taxShare,
    };
  }, [costStr, discountStr, marginStr, markupStr, mode, priceStr, quantityStr, taxInclusive, taxRateStr]);

  const handleReset = () => {
    setItemLabel('');
    setCostStr('0');
    setMarginStr('30');
    setMarkupStr('40');
    setPriceStr('0');
    setQuantityStr('1');
    setDiscountStr('0');
    setTaxRateStr(String(defaultTaxRate));
    setTaxInclusive(false);
  };

  const handleCopy = async () => {
    const title = itemLabel.trim() || 'Price Quote';
    const lines = [
      `${title} (${calc.qty} item${calc.qty > 1 ? 's' : ''})`,
      `Buying Cost / Item: ${formatCurrency(calc.cost, currency)}`,
      `Selling Price (before tax): ${formatCurrency(calc.netUnitRevenue, currency)}`,
      `VAT / Tax (${calc.taxPct}%): ${formatCurrency(calc.totalTax, currency)}`,
      `Customer Pays: ${formatCurrency(calc.totalCustomerDue, currency)}`,
      `Your Profit: ${formatCurrency(calc.totalProfit, currency)} (${formatPercent(calc.effectiveMargin)} margin · ${formatPercent(calc.effectiveMarkup)} markup)`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handleSave = () => {
    onSaveCalculation({
      category: 'pricing',
      title: itemLabel.trim() || `Price Quote (${calc.qty}×)`,
      primaryMetricLabel: 'Profit You Keep',
      primaryMetricValue: formatCurrency(calc.totalProfit, currency),
      details: [
        { label: 'Buying Cost', value: formatCurrency(calc.cost, currency) },
        { label: 'Selling Price / Item', value: formatCurrency(calc.netUnitRevenue, currency) },
        { label: 'Quantity', value: String(calc.qty) },
        { label: 'Margin / Markup', value: `${formatPercent(calc.effectiveMargin)} / ${formatPercent(calc.effectiveMarkup)}` },
        { label: `VAT (${calc.taxPct}%)`, value: formatCurrency(calc.totalTax, currency) },
        { label: 'Customer Pays', value: formatCurrency(calc.totalCustomerDue, currency) },
      ],
    });
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  };

  const marginPresets = [15, 25, 30, 50];
  const discountPresets = [0, 5, 10, 20];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Input Controls Column */}
      <section className="lg:col-span-7 bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Selling Price &amp; Profit
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Enter what you paid for stock to find your best selling price and profit.
            </p>
          </div>
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 min-h-[40px] px-3 py-1.5 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            Clear to 0
          </button>
        </div>

        {/* Mode Segmented Control */}
        <div
          className="mt-5 grid grid-cols-3 gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-xl"
          role="tablist"
          aria-label="How would you like to price?"
        >
          {[
            { id: 'cost_margin', label: 'By Profit %' },
            { id: 'cost_markup', label: 'By Markup %' },
            { id: 'cost_price', label: 'Enter Price' },
          ].map((tab) => {
            const active = mode === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setMode(tab.id as PricingMode)}
                className={`min-h-[42px] px-2.5 py-2 text-xs font-semibold rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-white dark:bg-[#1E2530] text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Primary Fields */}
        <div className="mt-5 space-y-4">
          <div>
            <label
              htmlFor="pricing-label"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Product or Customer Name (optional)
            </label>
            <input
              id="pricing-label"
              type="text"
              value={itemLabel}
              onChange={(e) => setItemLabel(e.target.value)}
              placeholder="e.g. 50kg Maize Bag or Wholesale Order"
              className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="pricing-cost"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Buying Cost per Item ({currencyInfo.symbol})
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-mono font-semibold text-slate-500 dark:text-slate-400">
                  {currencyInfo.symbol}
                </span>
                <input
                  id="pricing-cost"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={costStr}
                  onChange={(e) => setCostStr(e.target.value)}
                  className="w-full min-h-[48px] pl-11 pr-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono tabular-nums text-base font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                />
              </div>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                What 1 item costs you to buy or make.
              </p>
            </div>

            {mode === 'cost_margin' && (
              <div>
                <label
                  htmlFor="pricing-margin"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Target Profit Margin (%)
                </label>
                <div className="relative">
                  <input
                    id="pricing-margin"
                    type="number"
                    inputMode="decimal"
                    max="99.9"
                    step="any"
                    value={marginStr}
                    onChange={(e) => setMarginStr(e.target.value)}
                    className="w-full min-h-[48px] pl-3.5 pr-9 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono tabular-nums text-base font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-sm font-mono text-slate-400">
                    %
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  {marginPresets.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setMarginStr(String(p))}
                      className={`flex-1 min-h-[36px] rounded-lg text-xs font-mono font-medium transition-colors cursor-pointer ${
                        parseSafeFloat(marginStr) === p
                          ? 'bg-emerald-700 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      {p}%
                    </button>
                  ))}
                </div>
              </div>
            )}

            {mode === 'cost_markup' && (
              <div>
                <label
                  htmlFor="pricing-markup"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Markup Added to Cost (%)
                </label>
                <div className="relative">
                  <input
                    id="pricing-markup"
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={markupStr}
                    onChange={(e) => setMarkupStr(e.target.value)}
                    className="w-full min-h-[48px] pl-3.5 pr-9 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono tabular-nums text-base font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-sm font-mono text-slate-400">
                    %
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  {[25, 40, 60, 100].map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setMarkupStr(String(p))}
                      className={`flex-1 min-h-[36px] rounded-lg text-xs font-mono font-medium transition-colors cursor-pointer ${
                        parseSafeFloat(markupStr) === p
                          ? 'bg-emerald-700 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      {p}%
                    </button>
                  ))}
                </div>
              </div>
            )}

            {mode === 'cost_price' && (
              <div>
                <label
                  htmlFor="pricing-sale-price"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Your Selling Price ({currencyInfo.symbol})
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-mono font-semibold text-slate-500 dark:text-slate-400">
                    {currencyInfo.symbol}
                  </span>
                  <input
                    id="pricing-sale-price"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={priceStr}
                    onChange={(e) => setPriceStr(e.target.value)}
                    className="w-full min-h-[48px] pl-11 pr-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono tabular-nums text-base font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                  />
                </div>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  Check how much profit you make at this price.
                </p>
              </div>
            )}
          </div>

          {/* Quantity, Discount & Tax */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800/80 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label
                htmlFor="pricing-qty"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Quantity (Items)
              </label>
              <input
                id="pricing-qty"
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                value={quantityStr}
                onChange={(e) => setQuantityStr(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono tabular-nums text-sm font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
              />
            </div>

            <div>
              <label
                htmlFor="pricing-discount"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Customer Discount (%)
              </label>
              <div className="relative">
                <input
                  id="pricing-discount"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="100"
                  step="any"
                  value={discountStr}
                  onChange={(e) => setDiscountStr(e.target.value)}
                  className="w-full min-h-[44px] pl-3.5 pr-8 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono tabular-nums text-sm font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono text-slate-400">
                  %
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-1">
                {discountPresets.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDiscountStr(String(d))}
                    className={`flex-1 min-h-[32px] rounded-md text-[11px] font-mono transition-colors cursor-pointer ${
                      parseSafeFloat(discountStr) === d
                        ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-semibold'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {d}%
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label
                htmlFor="pricing-tax"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                VAT / Sales Tax (%)
              </label>
              <div className="relative">
                <input
                  id="pricing-tax"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={taxRateStr}
                  onChange={(e) => setTaxRateStr(e.target.value)}
                  className="w-full min-h-[44px] pl-3.5 pr-8 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono tabular-nums text-sm font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono text-slate-400">
                  %
                </span>
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => setTaxInclusive(false)}
                  className={`min-h-[32px] rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                    !taxInclusive
                      ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  + Add VAT
                </button>
                <button
                  type="button"
                  onClick={() => setTaxInclusive(true)}
                  className={`min-h-[32px] rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                    taxInclusive
                      ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  VAT Incl.
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Output Summary Column */}
      <aside className="lg:col-span-5 bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Customer Pays {calc.qty > 1 ? `(${calc.qty} items)` : '(1 item)'}
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {taxInclusive ? 'VAT included' : `+ ${calc.taxPct}% VAT`}
          </span>
        </div>

        <div className="mt-1 text-3xl sm:text-4xl font-bold font-mono tabular-nums tracking-tight text-slate-900 dark:text-white">
          {formatCurrency(calc.totalCustomerDue, currency)}
        </div>

        {/* Key Unit & Margin Summary */}
        <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800/80 grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Profit You Keep</div>
            <div
              className={`mt-0.5 text-xl font-semibold font-mono tabular-nums ${
                calc.totalProfit >= 0
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {formatCurrency(calc.totalProfit, currency)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Profit Margin</div>
            <div className="mt-0.5 text-xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {formatPercent(calc.effectiveMargin)}
            </div>
          </div>
        </div>

        {/* Visual Split Bar */}
        <div className="mt-5">
          <div className="h-2.5 w-full rounded-full overflow-hidden bg-slate-100 dark:bg-slate-800 flex">
            <div
              style={{ width: `${calc.costShare}%` }}
              className="bg-slate-400 dark:bg-slate-500 transition-all duration-200"
              title="Buying Cost"
            />
            <div
              style={{ width: `${calc.profitShare}%` }}
              className="bg-emerald-600 dark:bg-emerald-500 transition-all duration-200"
              title="Profit"
            />
            <div
              style={{ width: `${calc.taxShare}%` }}
              className="bg-amber-500 transition-all duration-200"
              title="VAT"
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600 dark:text-slate-400">
            <span>Cost {formatPercent(calc.costShare, 0)}</span>
            <span aria-hidden="true">·</span>
            <span className="text-emerald-700 dark:text-emerald-400 font-medium">
              Profit {formatPercent(calc.profitShare, 0)}
            </span>
            <span aria-hidden="true">·</span>
            <span>VAT {formatPercent(calc.taxShare, 0)}</span>
          </div>
        </div>

        {/* Line-by-Line Breakdown */}
        <dl className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800/80 space-y-2.5 text-sm">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-slate-600 dark:text-slate-400">Price per Item (before VAT)</dt>
            <dd className="font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
              {formatCurrency(calc.netUnitRevenue, currency)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-slate-600 dark:text-slate-400">Profit per Item</dt>
            <dd className="font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
              {formatCurrency(calc.unitProfit, currency)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-slate-600 dark:text-slate-400">Markup on Cost</dt>
            <dd className="font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
              {formatPercent(calc.effectiveMarkup)}
            </dd>
          </div>
          {calc.totalDiscountGiven > 0 && (
            <div className="flex items-center justify-between gap-2">
              <dt className="text-slate-600 dark:text-slate-400">Discount ({calc.discountPct}%)</dt>
              <dd className="font-mono tabular-nums font-medium text-amber-700 dark:text-amber-400">
                −{formatCurrency(calc.totalDiscountGiven, currency)}
              </dd>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <dt className="text-slate-600 dark:text-slate-400">Total Buying Cost ({calc.qty}×)</dt>
            <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {formatCurrency(calc.totalCost, currency)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-slate-600 dark:text-slate-400">Net Sales (before VAT)</dt>
            <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {formatCurrency(calc.totalNetRevenue, currency)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-slate-600 dark:text-slate-400">VAT Amount ({calc.taxPct}%)</dt>
            <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {formatCurrency(calc.totalTax, currency)}
            </dd>
          </div>
        </dl>

        {/* Actions */}
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center justify-center gap-2 min-h-[46px] px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium text-slate-800 dark:text-slate-200 transition-colors cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" aria-hidden="true" />
                <span>Copy Quote</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="inline-flex items-center justify-center gap-2 min-h-[46px] px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 active:scale-[0.98] text-white text-sm font-semibold transition-all cursor-pointer"
          >
            {savedFlash ? (
              <>
                <Check className="w-4 h-4" aria-hidden="true" />
                <span>Saved</span>
              </>
            ) : (
              <>
                <BookmarkPlus className="w-4 h-4" aria-hidden="true" />
                <span>Save Quote</span>
              </>
            )}
          </button>
        </div>
      </aside>
    </div>
  );
};
