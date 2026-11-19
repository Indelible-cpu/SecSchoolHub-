import React, { useMemo, useState } from 'react';
import { BookmarkPlus, Check, Copy } from 'lucide-react';
import { CurrencyCode, SavedCalculation } from '../types';
import {
  formatCurrency,
  formatNumber,
  formatPercent,
  getCurrencyInfo,
  parseSafeFloat,
} from '../utils/format';

type SubTool = 'breakeven' | 'loan' | 'roi';

interface BreakEvenLoanCalculatorProps {
  currency: CurrencyCode;
  onSaveCalculation: (calc: Omit<SavedCalculation, 'id' | 'createdAt'>) => void;
}

export const BreakEvenLoanCalculator: React.FC<BreakEvenLoanCalculatorProps> = ({
  currency,
  onSaveCalculation,
}) => {
  const currencyInfo = getCurrencyInfo(currency);
  const [subTool, setSubTool] = useState<SubTool>('breakeven');
  const [savedFlash, setSavedFlash] = useState(false);
  const [copied, setCopied] = useState(false);

  // Break-Even state
  const [fixedCostsStr, setFixedCostsStr] = useState('450000');
  const [varCostStr, setVarCostStr] = useState('4500');
  const [unitPriceStr, setUnitPriceStr] = useState('8500');
  const [targetProfitStr, setTargetProfitStr] = useState('250000');

  // Loan state
  const [loanPrincipalStr, setLoanPrincipalStr] = useState('2500000');
  const [annualRateStr, setAnnualRateStr] = useState('24');
  const [termValueStr, setTermValueStr] = useState('2');
  const [termUnit, setTermUnit] = useState<'years' | 'months'>('years');

  // ROI state
  const [initialInvestStr, setInitialInvestStr] = useState('1000000');
  const [finalValueStr, setFinalValueStr] = useState('1450000');
  const [roiYearsStr, setRoiYearsStr] = useState('1');

  const breakEven = useMemo(() => {
    const fixed = Math.max(0, parseSafeFloat(fixedCostsStr));
    const varCost = Math.max(0, parseSafeFloat(varCostStr));
    const price = Math.max(0, parseSafeFloat(unitPriceStr));
    const targetProfit = Math.max(0, parseSafeFloat(targetProfitStr));

    const contribMargin = price - varCost;
    const contribRatio = price > 0 ? (contribMargin / price) * 100 : 0;
    const viable = contribMargin > 0;
    const exactUnits = viable ? fixed / contribMargin : Infinity;
    const ceilUnits = viable ? Math.ceil(exactUnits) : Infinity;
    const breakEvenRevenue = viable ? exactUnits * price : Infinity;
    const targetUnits = viable ? Math.ceil((fixed + targetProfit) / contribMargin) : Infinity;
    const targetRevenue = viable ? targetUnits * price : Infinity;

    return {
      fixed,
      varCost,
      price,
      targetProfit,
      contribMargin,
      contribRatio,
      viable,
      exactUnits,
      ceilUnits,
      breakEvenRevenue,
      targetUnits,
      targetRevenue,
    };
  }, [fixedCostsStr, targetProfitStr, unitPriceStr, varCostStr]);

  const loan = useMemo(() => {
    const principal = Math.max(0, parseSafeFloat(loanPrincipalStr));
    const annualRate = Math.max(0, parseSafeFloat(annualRateStr));
    const rawTerm = Math.max(1, Math.round(parseSafeFloat(termValueStr) || 1));
    const months = termUnit === 'years' ? rawTerm * 12 : rawTerm;
    const monthlyRate = annualRate / 100 / 12;

    let monthlyPayment = 0;
    if (principal > 0) {
      if (monthlyRate === 0) {
        monthlyPayment = principal / months;
      } else {
        const factor = Math.pow(1 + monthlyRate, months);
        monthlyPayment = (principal * monthlyRate * factor) / (factor - 1);
      }
    }

    const totalRepayment = monthlyPayment * months;
    const totalInterest = Math.max(0, totalRepayment - principal);
    const interestShare = totalRepayment > 0 ? (totalInterest / totalRepayment) * 100 : 0;

    // Build yearly schedule (or grouped into periods up to 10 rows)
    const yearlySchedule: {
      year: number;
      principalPaid: number;
      interestPaid: number;
      balance: number;
    }[] = [];

    let balance = principal;
    let yearPrincipal = 0;
    let yearInterest = 0;

    for (let m = 1; m <= months; m++) {
      const interestForMonth = balance * monthlyRate;
      const principalForMonth = Math.min(balance, Math.max(0, monthlyPayment - interestForMonth));
      balance = Math.max(0, balance - principalForMonth);
      yearPrincipal += principalForMonth;
      yearInterest += interestForMonth;

      if (m % 12 === 0 || m === months) {
        yearlySchedule.push({
          year: Math.ceil(m / 12),
          principalPaid: yearPrincipal,
          interestPaid: yearInterest,
          balance,
        });
        yearPrincipal = 0;
        yearInterest = 0;
      }
    }

    return {
      principal,
      annualRate,
      months,
      monthlyPayment,
      totalRepayment,
      totalInterest,
      interestShare,
      yearlySchedule,
    };
  }, [annualRateStr, loanPrincipalStr, termUnit, termValueStr]);

  const roi = useMemo(() => {
    const initial = Math.max(0, parseSafeFloat(initialInvestStr));
    const finalVal = Math.max(0, parseSafeFloat(finalValueStr));
    const years = Math.max(0.01, parseSafeFloat(roiYearsStr) || 1);

    const netProfit = finalVal - initial;
    const totalRoiPct = initial > 0 ? (netProfit / initial) * 100 : 0;
    const annualizedPct =
      initial > 0 && finalVal > 0
        ? (Math.pow(finalVal / initial, 1 / years) - 1) * 100
        : totalRoiPct / years;

    return {
      initial,
      finalVal,
      years,
      netProfit,
      totalRoiPct,
      annualizedPct,
    };
  }, [finalValueStr, initialInvestStr, roiYearsStr]);

  const triggerFlash = (setter: React.Dispatch<React.SetStateAction<boolean>>) => {
    setter(true);
    setTimeout(() => setter(false), 1800);
  };

  const handleSave = () => {
    if (subTool === 'breakeven') {
      onSaveCalculation({
        category: 'breakeven',
        title: `Break-Even @ ${formatCurrency(breakEven.price, currency)}/unit`,
        primaryMetricLabel: 'Break-Even Units',
        primaryMetricValue: breakEven.viable ? `${formatNumber(breakEven.ceilUnits, 0)} units` : 'Not viable',
        details: [
          { label: 'Fixed Costs', value: formatCurrency(breakEven.fixed, currency) },
          { label: 'Variable Cost / Unit', value: formatCurrency(breakEven.varCost, currency) },
          { label: 'Contribution Margin', value: `${formatCurrency(breakEven.contribMargin, currency)} (${formatPercent(breakEven.contribRatio)})` },
          { label: 'Break-Even Revenue', value: breakEven.viable ? formatCurrency(breakEven.breakEvenRevenue, currency) : '—' },
        ],
      });
    } else if (subTool === 'loan') {
      onSaveCalculation({
        category: 'loan',
        title: `Loan ${formatCurrency(loan.principal, currency)} @ ${loan.annualRate}%`,
        primaryMetricLabel: 'Monthly Payment',
        primaryMetricValue: formatCurrency(loan.monthlyPayment, currency),
        details: [
          { label: 'Term', value: `${loan.months} months` },
          { label: 'Total Interest', value: formatCurrency(loan.totalInterest, currency) },
          { label: 'Total Repayment', value: formatCurrency(loan.totalRepayment, currency) },
        ],
      });
    } else {
      onSaveCalculation({
        category: 'roi',
        title: `ROI on ${formatCurrency(roi.initial, currency)}`,
        primaryMetricLabel: 'Total ROI',
        primaryMetricValue: formatPercent(roi.totalRoiPct),
        details: [
          { label: 'Initial Investment', value: formatCurrency(roi.initial, currency) },
          { label: 'Final Return', value: formatCurrency(roi.finalVal, currency) },
          { label: 'Net Gain', value: formatCurrency(roi.netProfit, currency) },
          { label: 'Annualized ROI', value: formatPercent(roi.annualizedPct) },
        ],
      });
    }
    triggerFlash(setSavedFlash);
  };

  const handleCopy = async () => {
    let text = '';
    if (subTool === 'breakeven') {
      text = `Break-Even Analysis\nFixed Costs: ${formatCurrency(breakEven.fixed, currency)}\nSelling Price: ${formatCurrency(breakEven.price, currency)}\nVariable Cost: ${formatCurrency(breakEven.varCost, currency)}\nBreak-Even Point: ${breakEven.viable ? `${formatNumber(breakEven.ceilUnits, 0)} units (${formatCurrency(breakEven.breakEvenRevenue, currency)})` : 'Not viable'}`;
    } else if (subTool === 'loan') {
      text = `Business Loan Estimate\nPrincipal: ${formatCurrency(loan.principal, currency)}\nRate: ${loan.annualRate}% APR · ${loan.months} months\nMonthly Payment: ${formatCurrency(loan.monthlyPayment, currency)}\nTotal Interest: ${formatCurrency(loan.totalInterest, currency)}\nTotal Repayment: ${formatCurrency(loan.totalRepayment, currency)}`;
    } else {
      text = `ROI Analysis\nInvestment: ${formatCurrency(roi.initial, currency)}\nFinal Value: ${formatCurrency(roi.finalVal, currency)}\nNet Gain: ${formatCurrency(roi.netProfit, currency)}\nTotal ROI: ${formatPercent(roi.totalRoiPct)} (${formatPercent(roi.annualizedPct)} annualized)`;
    }
    try {
      await navigator.clipboard.writeText(text);
      triggerFlash(setCopied);
    } catch {
      // Ignore clipboard failure
    }
  };

  // SVG Break-Even Chart Coordinates
  const chartData = useMemo(() => {
    const maxUnits = breakEven.viable && breakEven.exactUnits > 0 ? Math.max(10, Math.ceil(breakEven.exactUnits * 2)) : 100;
    const maxRevenue = maxUnits * breakEven.price;
    const maxCost = breakEven.fixed + maxUnits * breakEven.varCost;
    const maxY = Math.max(maxRevenue, maxCost, breakEven.fixed, 1);

    const w = 360;
    const h = 180;
    const padL = 12;
    const padR = 12;
    const padT = 14;
    const padB = 18;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const toX = (units: number) => padL + (units / maxUnits) * plotW;
    const toY = (val: number) => padT + plotH - (val / maxY) * plotH;

    const fixedY = toY(breakEven.fixed);
    const revEnd = toY(maxRevenue);
    const costEnd = toY(maxCost);

    const beX = breakEven.viable ? toX(breakEven.exactUnits) : null;
    const beY = breakEven.viable ? toY(breakEven.breakEvenRevenue) : null;

    return { w, h, padL, padR, padT, padB, plotH, fixedY, revEnd, costEnd, beX, beY, toX, toY, maxUnits };
  }, [breakEven]);

  return (
    <div className="space-y-6">
      {/* Sub-tool Switcher */}
      <div className="bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-2 sm:inline-flex grid grid-cols-3 gap-1">
        {[
          { id: 'breakeven', label: 'Break-Even' },
          { id: 'loan', label: 'Loan / EMI' },
          { id: 'roi', label: 'ROI & Payback' },
        ].map((item) => {
          const active = subTool === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setSubTool(item.id as SubTool)}
              className={`min-h-[42px] px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap cursor-pointer ${
                active
                  ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {subTool === 'breakeven' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <section className="lg:col-span-6 bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
            <div>
              <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Break-Even Point
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Find how many units you need to sell to cover fixed and variable costs.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="be-fixed" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Fixed Costs ({currencyInfo.code})
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-mono text-slate-400">
                    {currencyInfo.symbol}
                  </span>
                  <input
                    id="be-fixed"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={fixedCostsStr}
                    onChange={(e) => setFixedCostsStr(e.target.value)}
                    className="w-full min-h-[46px] pl-9 pr-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono tabular-nums text-sm font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="be-target" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Target Profit Goal ({currencyInfo.code})
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-mono text-slate-400">
                    {currencyInfo.symbol}
                  </span>
                  <input
                    id="be-target"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={targetProfitStr}
                    onChange={(e) => setTargetProfitStr(e.target.value)}
                    className="w-full min-h-[46px] pl-9 pr-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono tabular-nums text-sm font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="be-var" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Variable Cost / Unit
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-mono text-slate-400">
                    {currencyInfo.symbol}
                  </span>
                  <input
                    id="be-var"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={varCostStr}
                    onChange={(e) => setVarCostStr(e.target.value)}
                    className="w-full min-h-[46px] pl-9 pr-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono tabular-nums text-sm font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="be-price" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Selling Price / Unit
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-mono text-slate-400">
                    {currencyInfo.symbol}
                  </span>
                  <input
                    id="be-price"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={unitPriceStr}
                    onChange={(e) => setUnitPriceStr(e.target.value)}
                    className="w-full min-h-[46px] pl-9 pr-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono tabular-nums text-sm font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                  />
                </div>
              </div>
            </div>

            {!breakEven.viable && (
              <div className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 px-4 py-3 text-xs text-rose-800 dark:text-rose-200">
                Selling price must exceed variable cost per unit to reach break-even.
              </div>
            )}

            <div className="pt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={handleCopy}
                className="flex-1 inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="flex-1 inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold transition-colors cursor-pointer"
              >
                {savedFlash ? <Check className="w-4 h-4" /> : <BookmarkPlus className="w-4 h-4" />}
                <span>{savedFlash ? 'Saved' : 'Save'}</span>
              </button>
            </div>
          </section>

          <aside className="lg:col-span-6 bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Break-Even Volume</div>
                <div className="mt-1 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                  {breakEven.viable ? `${formatNumber(breakEven.ceilUnits, 0)} units` : '—'}
                </div>
                {breakEven.viable && (
                  <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
                    Exact: {formatNumber(breakEven.exactUnits, 1)} units
                  </div>
                )}
              </div>
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Break-Even Revenue</div>
                <div className="mt-1 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                  {breakEven.viable ? formatCurrency(breakEven.breakEvenRevenue, currency) : '—'}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
                  Margin: {formatCurrency(breakEven.contribMargin, currency)} / unit
                </div>
              </div>
            </div>

            {/* Clean SVG Break-Even Chart */}
            <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800/80">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
                <span>Cost vs. Revenue Trajectory</span>
                <span className="font-mono">0 to {formatNumber(chartData.maxUnits, 0)} units</span>
              </div>
              <svg
                viewBox={`0 0 ${chartData.w} ${chartData.h}`}
                className="w-full h-44 bg-slate-50 dark:bg-slate-900/70 rounded-xl border border-slate-100 dark:border-slate-800"
                role="img"
                aria-label="Break-even revenue and total cost chart"
              >
                {/* Fixed Cost dashed horizontal line */}
                <line
                  x1={chartData.padL}
                  y1={chartData.fixedY}
                  x2={chartData.w - chartData.padR}
                  y2={chartData.fixedY}
                  stroke="#94A3B8"
                  strokeWidth="1.5"
                  strokeDasharray="4 4"
                />
                {/* Total Cost line */}
                <line
                  x1={chartData.padL}
                  y1={chartData.fixedY}
                  x2={chartData.w - chartData.padR}
                  y2={chartData.costEnd}
                  stroke="#F59E0B"
                  strokeWidth="2.5"
                />
                {/* Revenue line */}
                <line
                  x1={chartData.padL}
                  y1={chartData.padT + chartData.plotH}
                  x2={chartData.w - chartData.padR}
                  y2={chartData.revEnd}
                  stroke="#10B981"
                  strokeWidth="2.5"
                />
                {/* Break-even point marker */}
                {chartData.beX !== null && chartData.beY !== null && (
                  <>
                    <line
                      x1={chartData.beX}
                      y1={chartData.beY}
                      x2={chartData.beX}
                      y2={chartData.padT + chartData.plotH}
                      stroke="#64748B"
                      strokeWidth="1"
                      strokeDasharray="3 3"
                    />
                    <circle
                      cx={chartData.beX}
                      cy={chartData.beY}
                      r="5"
                      fill="#047857"
                      stroke="#FFFFFF"
                      strokeWidth="2"
                    />
                  </>
                )}
              </svg>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600 dark:text-slate-400">
                <span className="text-emerald-700 dark:text-emerald-400 font-medium">Revenue</span>
                <span aria-hidden="true">·</span>
                <span className="text-amber-700 dark:text-amber-400 font-medium">Total Cost</span>
                <span aria-hidden="true">·</span>
                <span>Dashed: Fixed Costs</span>
              </div>
            </div>

            <dl className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800/80 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-600 dark:text-slate-400">Contribution Margin Ratio</dt>
                <dd className="font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
                  {formatPercent(breakEven.contribRatio)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-600 dark:text-slate-400">
                  Units for {formatCurrency(breakEven.targetProfit, currency)} Profit
                </dt>
                <dd className="font-mono tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">
                  {breakEven.viable ? `${formatNumber(breakEven.targetUnits, 0)} units` : '—'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-600 dark:text-slate-400">Target Profit Revenue</dt>
                <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {breakEven.viable ? formatCurrency(breakEven.targetRevenue, currency) : '—'}
                </dd>
              </div>
            </dl>
          </aside>
        </div>
      )}

      {subTool === 'loan' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <section className="lg:col-span-5 bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
            <div>
              <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Business Loan &amp; EMI
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Estimate monthly repayments, total interest cost, and yearly payoff schedule.
              </p>
            </div>

            <div>
              <label htmlFor="loan-amount" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Loan Principal ({currencyInfo.code})
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-mono text-slate-400">
                  {currencyInfo.symbol}
                </span>
                <input
                  id="loan-amount"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={loanPrincipalStr}
                  onChange={(e) => setLoanPrincipalStr(e.target.value)}
                  className="w-full min-h-[46px] pl-9 pr-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono tabular-nums text-sm font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="loan-rate" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Interest Rate (APR %)
                </label>
                <div className="relative">
                  <input
                    id="loan-rate"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={annualRateStr}
                    onChange={(e) => setAnnualRateStr(e.target.value)}
                    className="w-full min-h-[46px] pl-3.5 pr-8 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono tabular-nums text-sm font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono text-slate-400">
                    %
                  </span>
                </div>
              </div>

              <div>
                <label htmlFor="loan-term" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Loan Term
                </label>
                <div className="flex gap-1.5">
                  <input
                    id="loan-term"
                    type="number"
                    inputMode="numeric"
                    min="1"
                    step="1"
                    value={termValueStr}
                    onChange={(e) => setTermValueStr(e.target.value)}
                    className="w-full min-h-[46px] px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono tabular-nums text-sm font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                  />
                  <button
                    type="button"
                    onClick={() => setTermUnit((u) => (u === 'years' ? 'months' : 'years'))}
                    className="min-h-[46px] px-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {termUnit === 'years' ? 'Yrs' : 'Mos'}
                  </button>
                </div>
              </div>
            </div>

            <div className="pt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={handleCopy}
                className="flex-1 inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="flex-1 inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold transition-colors cursor-pointer"
              >
                {savedFlash ? <Check className="w-4 h-4" /> : <BookmarkPlus className="w-4 h-4" />}
                <span>{savedFlash ? 'Saved' : 'Save'}</span>
              </button>
            </div>
          </section>

          <aside className="lg:col-span-7 bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Monthly Payment</div>
                <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                  {formatCurrency(loan.monthlyPayment, currency)}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Total Interest</div>
                <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-amber-700 dark:text-amber-400">
                  {formatCurrency(loan.totalInterest, currency)}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Total Repayment</div>
                <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                  {formatCurrency(loan.totalRepayment, currency)}
                </div>
              </div>
            </div>

            <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800/80">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-3">
                <span className="font-medium text-slate-700 dark:text-slate-300">Annual Amortization Summary</span>
                <span className="font-mono">{loan.months} monthly payments</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                      <th className="py-2 pr-3 font-medium">Year</th>
                      <th className="py-2 px-3 font-medium text-right">Principal</th>
                      <th className="py-2 px-3 font-medium text-right">Interest</th>
                      <th className="py-2 pl-3 font-medium text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 font-mono tabular-nums">
                    {loan.yearlySchedule.slice(0, 10).map((row) => (
                      <tr key={row.year} className="text-slate-800 dark:text-slate-200">
                        <td className="py-2.5 pr-3 font-sans font-medium">Year {row.year}</td>
                        <td className="py-2.5 px-3 text-right">{formatCurrency(row.principalPaid, currency)}</td>
                        <td className="py-2.5 px-3 text-right text-amber-700 dark:text-amber-400">
                          {formatCurrency(row.interestPaid, currency)}
                        </td>
                        <td className="py-2.5 pl-3 text-right font-semibold">{formatCurrency(row.balance, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </aside>
        </div>
      )}

      {subTool === 'roi' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <section className="lg:col-span-6 bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
            <div>
              <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Return on Investment (ROI)
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Measure campaign, inventory, or equipment return over time.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="roi-initial" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Amount Invested ({currencyInfo.code})
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-mono text-slate-400">
                    {currencyInfo.symbol}
                  </span>
                  <input
                    id="roi-initial"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={initialInvestStr}
                    onChange={(e) => setInitialInvestStr(e.target.value)}
                    className="w-full min-h-[46px] pl-9 pr-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono tabular-nums text-sm font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="roi-final" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Amount Returned ({currencyInfo.code})
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-mono text-slate-400">
                    {currencyInfo.symbol}
                  </span>
                  <input
                    id="roi-final"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={finalValueStr}
                    onChange={(e) => setFinalValueStr(e.target.value)}
                    className="w-full min-h-[46px] pl-9 pr-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono tabular-nums text-sm font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                  />
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="roi-years" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Time Period (Years, e.g. 0.5 for 6 months)
              </label>
              <input
                id="roi-years"
                type="number"
                inputMode="decimal"
                min="0.05"
                step="any"
                value={roiYearsStr}
                onChange={(e) => setRoiYearsStr(e.target.value)}
                className="w-full min-h-[46px] px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono tabular-nums text-sm font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
              />
            </div>

            <div className="pt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={handleCopy}
                className="flex-1 inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="flex-1 inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold transition-colors cursor-pointer"
              >
                {savedFlash ? <Check className="w-4 h-4" /> : <BookmarkPlus className="w-4 h-4" />}
                <span>{savedFlash ? 'Saved' : 'Save'}</span>
              </button>
            </div>
          </section>

          <aside className="lg:col-span-6 bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6">
            <div className="text-xs text-slate-500 dark:text-slate-400">Total Return on Investment</div>
            <div
              className={`mt-1 text-3xl sm:text-4xl font-bold font-mono tabular-nums ${
                roi.totalRoiPct >= 0
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {formatPercent(roi.totalRoiPct)}
            </div>

            <dl className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800/80 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-600 dark:text-slate-400">Net Gain / Loss</dt>
                <dd
                  className={`font-mono tabular-nums font-semibold ${
                    roi.netProfit >= 0
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {formatCurrency(roi.netProfit, currency)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-600 dark:text-slate-400">Annualized ROI (CAGR)</dt>
                <dd className="font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
                  {formatPercent(roi.annualizedPct)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-600 dark:text-slate-400">Return Multiple</dt>
                <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {roi.initial > 0 ? `${(roi.finalVal / roi.initial).toFixed(2)}×` : '—'}
                </dd>
              </div>
            </dl>
          </aside>
        </div>
      )}
    </div>
  );
};
