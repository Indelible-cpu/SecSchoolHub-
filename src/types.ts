export type TabId = 'pricing' | 'keypad' | 'breakeven' | 'ledger';

export type CurrencyCode =
  | 'MWK'
  | 'ZMW'
  | 'ZAR'
  | 'TZS'
  | 'MZN'
  | 'KES'
  | 'NGN'
  | 'USD'
  | 'GBP'
  | 'EUR'
  | 'INR'
  | 'CAD'
  | 'AUD'
  | 'JPY';

export interface CurrencyInfo {
  code: CurrencyCode;
  country: string;
  symbol: string;
  label: string;
  decimals: number;
  defaultTaxRate: number;
}

export const CURRENCIES: CurrencyInfo[] = [
  { code: 'MWK', country: 'Malawi', symbol: 'MK', label: 'Malawi — Kwacha (MK)', decimals: 2, defaultTaxRate: 16.5 },
  { code: 'ZMW', country: 'Zambia', symbol: 'ZK', label: 'Zambia — Kwacha (ZMW)', decimals: 2, defaultTaxRate: 16 },
  { code: 'ZAR', country: 'South Africa', symbol: 'R', label: 'South Africa — Rand (ZAR)', decimals: 2, defaultTaxRate: 15 },
  { code: 'TZS', country: 'Tanzania', symbol: 'TSh', label: 'Tanzania — Shilling (TZS)', decimals: 0, defaultTaxRate: 18 },
  { code: 'MZN', country: 'Mozambique', symbol: 'MT', label: 'Mozambique — Metical (MZN)', decimals: 2, defaultTaxRate: 16 },
  { code: 'KES', country: 'Kenya', symbol: 'KSh', label: 'Kenya — Shilling (KES)', decimals: 2, defaultTaxRate: 16 },
  { code: 'NGN', country: 'Nigeria', symbol: '₦', label: 'Nigeria — Naira (NGN)', decimals: 2, defaultTaxRate: 7.5 },
  { code: 'USD', country: 'United States', symbol: '$', label: 'United States — Dollar (USD)', decimals: 2, defaultTaxRate: 8.25 },
  { code: 'GBP', country: 'United Kingdom', symbol: '£', label: 'United Kingdom — Pound (GBP)', decimals: 2, defaultTaxRate: 20 },
  { code: 'EUR', country: 'Eurozone', symbol: '€', label: 'Eurozone — Euro (EUR)', decimals: 2, defaultTaxRate: 20 },
  { code: 'INR', country: 'India', symbol: '₹', label: 'India — Rupee (INR)', decimals: 2, defaultTaxRate: 18 },
  { code: 'CAD', country: 'Canada', symbol: 'C$', label: 'Canada — Dollar (CAD)', decimals: 2, defaultTaxRate: 13 },
  { code: 'AUD', country: 'Australia', symbol: 'A$', label: 'Australia — Dollar (AUD)', decimals: 2, defaultTaxRate: 10 },
  { code: 'JPY', country: 'Japan', symbol: '¥', label: 'Japan — Yen (JPY)', decimals: 0, defaultTaxRate: 10 },
];

export interface AppSettings {
  currency: CurrencyCode;
  defaultTaxRate: number;
  theme: 'light' | 'dark';
}

export type CalculationCategory = 'pricing' | 'keypad' | 'breakeven' | 'loan' | 'roi';

export interface SavedCalculation {
  id: string;
  category: CalculationCategory;
  title: string;
  primaryMetricLabel: string;
  primaryMetricValue: string;
  details: { label: string; value: string }[];
  createdAt: number;
}

export interface TapeEntry {
  id: string;
  expression: string;
  result: string;
  numericResult: number;
  note?: string;
}
