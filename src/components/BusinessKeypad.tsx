import React, { useCallback, useEffect, useState } from 'react';
import { Delete, Trash2, BookmarkPlus, Check } from 'lucide-react';
import { CurrencyCode, SavedCalculation, TapeEntry } from '../types';
import { formatCurrency, formatNumber } from '../utils/format';

interface BusinessKeypadProps {
  currency: CurrencyCode;
  defaultTaxRate: number;
  tape: TapeEntry[];
  setTape: React.Dispatch<React.SetStateAction<TapeEntry[]>>;
  onSaveCalculation: (calc: Omit<SavedCalculation, 'id' | 'createdAt'>) => void;
}

type Operator = '+' | '−' | '×' | '÷' | null;

export const BusinessKeypad: React.FC<BusinessKeypadProps> = ({
  currency,
  defaultTaxRate,
  tape,
  setTape,
  onSaveCalculation,
}) => {
  const [display, setDisplay] = useState('0');
  const [prevValue, setPrevValue] = useState<number | null>(null);
  const [operator, setOperator] = useState<Operator>(null);
  const [waitingForOperand, setWaitingForOperand] = useState(false);
  const [memory, setMemory] = useState<number>(0);
  const [savedFlash, setSavedFlash] = useState(false);

  const pushTape = useCallback((expression: string, numericResult: number, note?: string) => {
    const formatted = formatNumber(numericResult, 4);
    setTape((prev) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        expression,
        result: formatted,
        numericResult,
        note,
      },
      ...prev.slice(0, 49),
    ]);
  }, [setTape]);

  const compute = (a: number, b: number, op: Operator): number => {
    switch (op) {
      case '+':
        return a + b;
      case '−':
        return a - b;
      case '×':
        return a * b;
      case '÷':
        return b === 0 ? NaN : a / b;
      default:
        return b;
    }
  };

  const inputDigit = useCallback((digit: string) => {
    setDisplay((curr) => {
      if (waitingForOperand) {
        setWaitingForOperand(false);
        return digit === '00' ? '0' : digit;
      }
      if (curr === '0' || curr === 'Error') {
        return digit === '00' ? '0' : digit;
      }
      if (curr.length >= 14) return curr;
      return curr + digit;
    });
  }, [waitingForOperand]);

  const inputDecimal = useCallback(() => {
    if (waitingForOperand) {
      setDisplay('0.');
      setWaitingForOperand(false);
      return;
    }
    setDisplay((curr) => (curr.includes('.') ? curr : curr + '.'));
  }, [waitingForOperand]);

  const clearAll = useCallback(() => {
    setDisplay('0');
    setPrevValue(null);
    setOperator(null);
    setWaitingForOperand(false);
  }, []);

  const backspace = useCallback(() => {
    if (waitingForOperand) return;
    setDisplay((curr) => {
      if (curr.length <= 1 || curr === 'Error') return '0';
      return curr.slice(0, -1);
    });
  }, [waitingForOperand]);

  const handleOperator = useCallback((nextOp: Operator) => {
    const inputValue = parseFloat(display);
    if (Number.isNaN(inputValue)) return;

    if (prevValue === null) {
      setPrevValue(inputValue);
    } else if (operator && !waitingForOperand) {
      const result = compute(prevValue, inputValue, operator);
      if (Number.isNaN(result)) {
        setDisplay('Error');
        setPrevValue(null);
        setOperator(null);
        setWaitingForOperand(true);
        return;
      }
      pushTape(`${formatNumber(prevValue, 4)} ${operator} ${formatNumber(inputValue, 4)}`, result);
      setPrevValue(result);
      setDisplay(String(Number(result.toFixed(8))));
    }

    setWaitingForOperand(true);
    setOperator(nextOp);
  }, [display, operator, prevValue, pushTape, waitingForOperand]);

  const handleEquals = useCallback(() => {
    const inputValue = parseFloat(display);
    if (operator && prevValue !== null && !Number.isNaN(inputValue)) {
      const result = compute(prevValue, inputValue, operator);
      if (Number.isNaN(result)) {
        setDisplay('Error');
        setPrevValue(null);
        setOperator(null);
        setWaitingForOperand(true);
        return;
      }
      pushTape(`${formatNumber(prevValue, 4)} ${operator} ${formatNumber(inputValue, 4)}`, result);
      setDisplay(String(Number(result.toFixed(8))));
      setPrevValue(null);
      setOperator(null);
      setWaitingForOperand(true);
    }
  }, [display, operator, prevValue, pushTape]);

  const handlePercent = useCallback(() => {
    const current = parseFloat(display);
    if (Number.isNaN(current)) return;

    if (prevValue !== null && (operator === '+' || operator === '−')) {
      const pctAmount = (prevValue * current) / 100;
      setDisplay(String(Number(pctAmount.toFixed(8))));
      setWaitingForOperand(false);
    } else {
      const pct = current / 100;
      setDisplay(String(Number(pct.toFixed(8))));
      setWaitingForOperand(true);
    }
  }, [display, operator, prevValue]);

  const handleAddTax = () => {
    const val = parseFloat(display);
    if (Number.isNaN(val)) return;
    const result = val * (1 + defaultTaxRate / 100);
    pushTape(`${formatNumber(val, 4)} + ${defaultTaxRate}% Tax`, result, '+TAX');
    setDisplay(String(Number(result.toFixed(6))));
    setWaitingForOperand(true);
  };

  const handleRemoveTax = () => {
    const val = parseFloat(display);
    if (Number.isNaN(val)) return;
    const result = val / (1 + defaultTaxRate / 100);
    pushTape(`${formatNumber(val, 4)} ex. ${defaultTaxRate}% Tax`, result, '-TAX');
    setDisplay(String(Number(result.toFixed(6))));
    setWaitingForOperand(true);
  };

  const handleGrossMarginPrice = () => {
    // If user typed cost and pressed +, -, etc., or direct: apply 30% margin or if operator active use second number as margin%
    const current = parseFloat(display);
    if (Number.isNaN(current)) return;
    if (prevValue !== null && current < 100 && current > -500) {
      // Price = Cost / (1 - Margin%)
      const sellPrice = prevValue / (1 - current / 100);
      pushTape(`Cost ${formatNumber(prevValue, 2)} @ ${current}% margin`, sellPrice, 'MU');
      setDisplay(String(Number(sellPrice.toFixed(6))));
      setPrevValue(null);
      setOperator(null);
      setWaitingForOperand(true);
    } else {
      // Quick 25% markup on current value
      const markedUp = current * 1.25;
      pushTape(`${formatNumber(current, 2)} + 25% markup`, markedUp, 'MU');
      setDisplay(String(Number(markedUp.toFixed(6))));
      setWaitingForOperand(true);
    }
  };

  const handleSaveTapeSnapshot = () => {
    const numeric = parseFloat(display);
    if (Number.isNaN(numeric)) return;
    onSaveCalculation({
      category: 'keypad',
      title: tape[0]?.expression ? `Calc: ${tape[0].expression}` : 'Keypad Calculation',
      primaryMetricLabel: 'Result',
      primaryMetricValue: formatCurrency(numeric, currency),
      details: tape.slice(0, 5).map((t) => ({
        label: t.expression,
        value: t.result,
      })),
    });
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  };

  // Physical keyboard support for desktop
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }
      if (e.key >= '0' && e.key <= '9') {
        inputDigit(e.key);
      } else if (e.key === '.') {
        inputDecimal();
      } else if (e.key === '+') {
        handleOperator('+');
      } else if (e.key === '-') {
        handleOperator('−');
      } else if (e.key === '*') {
        handleOperator('×');
      } else if (e.key === '/') {
        e.preventDefault();
        handleOperator('÷');
      } else if (e.key === 'Enter' || e.key === '=') {
        e.preventDefault();
        handleEquals();
      } else if (e.key === 'Backspace') {
        backspace();
      } else if (e.key === 'Escape') {
        clearAll();
      } else if (e.key === '%') {
        handlePercent();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [backspace, clearAll, handleEquals, handleOperator, handlePercent, inputDecimal, inputDigit]);

  const numericDisplay = parseFloat(display);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Main Keypad Card */}
      <section className="lg:col-span-6 bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6">
        {/* Readout Screen */}
        <div className="rounded-xl bg-slate-950 dark:bg-[#0B0F14] p-4 sm:p-5 text-right border border-slate-800">
          <div className="flex items-center justify-between text-xs font-mono text-slate-400 min-h-[20px]">
            <span>
              {memory !== 0 ? `M: ${formatNumber(memory, 2)}` : `Tax ${defaultTaxRate}%`}
            </span>
            <span className="truncate max-w-[65%]">
              {prevValue !== null && operator ? `${formatNumber(prevValue, 4)} ${operator}` : ''}
            </span>
          </div>
          <div
            className="mt-2 text-3xl sm:text-4xl font-bold font-mono tabular-nums text-white tracking-tight overflow-x-auto whitespace-nowrap"
            aria-live="polite"
          >
            {display}
          </div>
          <div className="mt-1 flex items-center justify-between text-xs font-mono text-emerald-400">
            <button
              type="button"
              onClick={handleSaveTapeSnapshot}
              className="inline-flex items-center gap-1.5 text-slate-300 hover:text-white transition-colors py-1 cursor-pointer"
            >
              {savedFlash ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                  <span className="text-emerald-400">Saved to Ledger</span>
                </>
              ) : (
                <>
                  <BookmarkPlus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Save Result</span>
                </>
              )}
            </button>
            <span className="tabular-nums">
              {!Number.isNaN(numericDisplay) ? formatCurrency(numericDisplay, currency) : '—'}
            </span>
          </div>
        </div>

        {/* Business Function Row */}
        <div className="mt-3 grid grid-cols-5 gap-2">
          <button
            type="button"
            onClick={() => setMemory(0)}
            className="min-h-[44px] rounded-xl bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-mono font-semibold text-slate-700 dark:text-slate-300 active:scale-[0.97] transition-all cursor-pointer"
          >
            MC
          </button>
          <button
            type="button"
            onClick={() => {
              setDisplay(String(memory));
              setWaitingForOperand(true);
            }}
            className="min-h-[44px] rounded-xl bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-mono font-semibold text-slate-700 dark:text-slate-300 active:scale-[0.97] transition-all cursor-pointer"
          >
            MR
          </button>
          <button
            type="button"
            onClick={() => {
              if (!Number.isNaN(numericDisplay)) setMemory((m) => m + numericDisplay);
            }}
            className="min-h-[44px] rounded-xl bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-mono font-semibold text-slate-700 dark:text-slate-300 active:scale-[0.97] transition-all cursor-pointer"
          >
            M+
          </button>
          <button
            type="button"
            onClick={handleAddTax}
            title={`Add ${defaultTaxRate}% Tax`}
            className="min-h-[44px] rounded-xl bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-xs font-mono font-semibold text-emerald-800 dark:text-emerald-300 active:scale-[0.97] transition-all cursor-pointer"
          >
            +TAX
          </button>
          <button
            type="button"
            onClick={handleRemoveTax}
            title={`Remove ${defaultTaxRate}% Tax`}
            className="min-h-[44px] rounded-xl bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-xs font-mono font-semibold text-emerald-800 dark:text-emerald-300 active:scale-[0.97] transition-all cursor-pointer"
          >
            −TAX
          </button>
        </div>

        {/* Main Numeric & Operator Grid */}
        <div className="mt-2.5 grid grid-cols-4 gap-2">
          <button
            type="button"
            onClick={clearAll}
            className="min-h-[54px] rounded-xl bg-slate-200/80 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-sm font-semibold text-rose-700 dark:text-rose-400 active:scale-[0.97] transition-all cursor-pointer"
          >
            AC
          </button>
          <button
            type="button"
            onClick={backspace}
            aria-label="Backspace"
            className="min-h-[54px] rounded-xl bg-slate-200/80 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 active:scale-[0.97] transition-all cursor-pointer"
          >
            <Delete className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={handlePercent}
            className="min-h-[54px] rounded-xl bg-slate-200/80 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-base font-mono font-semibold text-slate-800 dark:text-slate-100 active:scale-[0.97] transition-all cursor-pointer"
          >
            %
          </button>
          <button
            type="button"
            onClick={() => handleOperator('÷')}
            className={`min-h-[54px] rounded-xl text-xl font-mono font-semibold active:scale-[0.97] transition-all cursor-pointer ${
              operator === '÷' && waitingForOperand
                ? 'bg-emerald-700 text-white'
                : 'bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 text-white'
            }`}
          >
            ÷
          </button>

          {['7', '8', '9'].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => inputDigit(d)}
              className="min-h-[56px] rounded-xl bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800 text-xl font-mono font-semibold text-slate-900 dark:text-slate-100 active:scale-[0.97] transition-all cursor-pointer"
            >
              {d}
            </button>
          ))}
          <button
            type="button"
            onClick={() => handleOperator('×')}
            className={`min-h-[56px] rounded-xl text-xl font-mono font-semibold active:scale-[0.97] transition-all cursor-pointer ${
              operator === '×' && waitingForOperand
                ? 'bg-emerald-700 text-white'
                : 'bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 text-white'
            }`}
          >
            ×
          </button>

          {['4', '5', '6'].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => inputDigit(d)}
              className="min-h-[56px] rounded-xl bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800 text-xl font-mono font-semibold text-slate-900 dark:text-slate-100 active:scale-[0.97] transition-all cursor-pointer"
            >
              {d}
            </button>
          ))}
          <button
            type="button"
            onClick={() => handleOperator('−')}
            className={`min-h-[56px] rounded-xl text-xl font-mono font-semibold active:scale-[0.97] transition-all cursor-pointer ${
              operator === '−' && waitingForOperand
                ? 'bg-emerald-700 text-white'
                : 'bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 text-white'
            }`}
          >
            −
          </button>

          {['1', '2', '3'].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => inputDigit(d)}
              className="min-h-[56px] rounded-xl bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800 text-xl font-mono font-semibold text-slate-900 dark:text-slate-100 active:scale-[0.97] transition-all cursor-pointer"
            >
              {d}
            </button>
          ))}
          <button
            type="button"
            onClick={() => handleOperator('+')}
            className={`min-h-[56px] rounded-xl text-xl font-mono font-semibold active:scale-[0.97] transition-all cursor-pointer ${
              operator === '+' && waitingForOperand
                ? 'bg-emerald-700 text-white'
                : 'bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 text-white'
            }`}
          >
            +
          </button>

          <button
            type="button"
            onClick={() => inputDigit('00')}
            className="min-h-[56px] rounded-xl bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800 text-lg font-mono font-semibold text-slate-900 dark:text-slate-100 active:scale-[0.97] transition-all cursor-pointer"
          >
            00
          </button>
          <button
            type="button"
            onClick={() => inputDigit('0')}
            className="min-h-[56px] rounded-xl bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800 text-xl font-mono font-semibold text-slate-900 dark:text-slate-100 active:scale-[0.97] transition-all cursor-pointer"
          >
            0
          </button>
          <button
            type="button"
            onClick={inputDecimal}
            className="min-h-[56px] rounded-xl bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800 text-xl font-mono font-semibold text-slate-900 dark:text-slate-100 active:scale-[0.97] transition-all cursor-pointer"
          >
            .
          </button>
          <button
            type="button"
            onClick={handleEquals}
            className="min-h-[56px] rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-2xl font-mono font-semibold active:scale-[0.97] transition-all cursor-pointer"
          >
            =
          </button>
        </div>

        {/* Quick Margin/Markup Helper Bar */}
        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Quick MU: type cost + margin %, then tap MU (or direct +25%).
          </span>
          <button
            type="button"
            onClick={handleGrossMarginPrice}
            className="min-h-[40px] px-4 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-mono font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
          >
            MU
          </button>
        </div>
      </section>

      {/* Running Paper Tape Panel */}
      <aside className="lg:col-span-6 bg-white dark:bg-[#161B22] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Paper Tape
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Tap any result to load it back onto the display.
            </p>
          </div>
          {tape.length > 0 && (
            <button
              type="button"
              onClick={() => setTape([])}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3 py-1.5 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              Clear Tape
            </button>
          )}
        </div>

        <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800/80 max-h-[380px] overflow-y-auto">
          {tape.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
              Calculations appear here as you press =, +TAX, −TAX, or MU.
            </div>
          ) : (
            tape.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => {
                  setDisplay(String(Number(entry.numericResult.toFixed(8))));
                  setWaitingForOperand(true);
                }}
                className="w-full min-h-[52px] py-3 px-2 flex items-center justify-between gap-4 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg transition-colors cursor-pointer"
              >
                <div className="min-w-0">
                  <div className="text-xs font-mono text-slate-500 dark:text-slate-400 truncate">
                    {entry.expression}
                    {entry.note ? ` · ${entry.note}` : ''}
                  </div>
                </div>
                <div className="text-base font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 shrink-0">
                  = {entry.result}
                </div>
              </button>
            ))
          )}
        </div>
      </aside>
    </div>
  );
};
