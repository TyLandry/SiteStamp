// Canadian payroll deductions — CRA T4127 "Option 1" formulas.
// Rates come from the tax_rates table, never hard-coded here.
// Alberta is the only province wired up so far.

export type FederalRates = {
  federal: {
    thresholds: number[];
    rates: number[];
    constants: number[];
    lowest_rate: number;
    bpa_max: number;
    bpa_min: number;
    bpa_phase_start: number;
    bpa_phase_end: number;
    canada_employment_amount: number;
  };
  cpp: {
    rate: number;
    base_rate: number;
    first_additional_rate: number;
    basic_exemption: number;
    ympe: number;
    max_contribution: number;
    max_base_contribution: number;
    cpp2_rate: number;
    yampe: number;
    cpp2_max_contribution: number;
  };
  ei: {
    rate: number;
    max_insurable: number;
    max_premium: number;
    employer_multiplier: number;
  };
};

export type ProvincialRates = {
  thresholds: number[];
  rates: number[];
  constants: number[];
  lowest_rate: number;
  bpa: number;
  supplemental_credit_threshold?: number; // Alberta K5P
  supplemental_credit_rate?: number;
};

export type PayrollInput = {
  gross: number; // gross pay this period (regular + overtime)
  periodsPerYear: number; // P: 52, 26, 24, 12
  federalClaim: number | null; // TC from TD1; null = basic personal amount
  provincialClaim: number | null; // TCP from TD1AB; null = provincial basic amount
  taxDeductibleDeductions?: number; // U1: union dues etc. this period
  extraTax?: number; // L: extra tax requested on TD1
  ytd: {
    cpp: number; // D
    cpp2: number; // D2
    ei: number; // D1
    pensionableEarnings: number; // PI YTD
  };
};

export type PayrollResult = {
  gross: number;
  cpp: number;
  cpp2: number;
  ei: number;
  federalTax: number;
  provincialTax: number;
  incomeTax: number;
  employerCpp: number;
  employerCpp2: number;
  employerEi: number;
  annualTaxableIncome: number;
  annualFederalTax: number;
  annualProvincialTax: number;
};

// CRA rounding: nearest cent, a third decimal of 5 or more rounds up
export function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// CRA: CPP exemption per period drops the third decimal (truncates)
function truncate2(n: number) {
  return Math.floor(n * 100 + 1e-9) / 100;
}

function bracket(income: number, thresholds: number[]) {
  let i = 0;
  for (let k = 0; k < thresholds.length; k++) {
    if (income >= thresholds[k]) i = k;
  }
  return i;
}

export function calculatePayroll(
  input: PayrollInput,
  fed: FederalRates,
  prov: ProvincialRates
): PayrollResult {
  const P = input.periodsPerYear;
  const gross = round2(input.gross);
  const U1 = input.taxDeductibleDeductions ?? 0;
  const L = input.extraTax ?? 0;
  const { cpp: c, ei: e, federal: f } = fed;

  // ---------- CPP (C) ----------
  const exemption = truncate2(c.basic_exemption / P);
  const cpp = Math.max(
    0,
    round2(Math.min(c.max_contribution - input.ytd.cpp, c.rate * (gross - exemption)))
  );

  // ---------- CPP2 (C2) ----------
  const W = Math.max(input.ytd.pensionableEarnings, c.ympe);
  const cpp2 = Math.max(
    0,
    round2(
      Math.min(
        c.cpp2_max_contribution - input.ytd.cpp2,
        (input.ytd.pensionableEarnings + gross - W) * c.cpp2_rate
      )
    )
  );

  // ---------- EI ----------
  const ei = Math.max(0, round2(Math.min(e.max_premium - input.ytd.ei, e.rate * gross)));

  // ---------- F5: enhanced CPP deducted from income ----------
  const F5 = round2(cpp * (c.first_additional_rate / c.rate) + cpp2);

  // ---------- A: annual taxable income ----------
  const A = Math.max(0, round2(P * (gross - F5 - U1)));

  // Annualized base CPP and EI for the K2 credits.
  // Once the yearly max is reached, use the max for the rest of the year.
  const baseRatio = c.base_rate / c.rate;
  const cppMaxed = input.ytd.cpp + cpp >= c.max_contribution;
  const cppBaseAnnual = cppMaxed
    ? c.max_base_contribution
    : Math.min(round2(P * cpp * baseRatio), c.max_base_contribution);
  const eiMaxed = input.ytd.ei + ei >= e.max_premium;
  const eiAnnual = eiMaxed ? e.max_premium : Math.min(round2(P * ei), e.max_premium);

  // ---------- Federal (T3) ----------
  let bpaf = f.bpa_max;
  if (A > f.bpa_phase_start && A < f.bpa_phase_end) {
    bpaf = round2(
      f.bpa_max -
        (A - f.bpa_phase_start) *
          ((f.bpa_max - f.bpa_min) / (f.bpa_phase_end - f.bpa_phase_start))
    );
  } else if (A >= f.bpa_phase_end) {
    bpaf = f.bpa_min;
  }
  const TC = input.federalClaim ?? bpaf;

  const fi = bracket(A, f.thresholds);
  const K1 = round2(f.lowest_rate * TC);
  const K2 = round2(f.lowest_rate * cppBaseAnnual) + round2(f.lowest_rate * eiAnnual);
  const K4 = round2(Math.min(f.lowest_rate * A, f.lowest_rate * f.canada_employment_amount));
  const T3 = Math.max(0, round2(round2(f.rates[fi] * A) - f.constants[fi] - K1 - K2 - K4));

  // ---------- Provincial (T4) ----------
  const TCP = input.provincialClaim ?? prov.bpa;
  const pi = bracket(A, prov.thresholds);
  const K1P = round2(prov.lowest_rate * TCP);
  const K2P = round2(prov.lowest_rate * cppBaseAnnual) + round2(prov.lowest_rate * eiAnnual);
  let K5P = 0;
  if (prov.supplemental_credit_threshold != null && prov.supplemental_credit_rate != null) {
    K5P = Math.max(
      0,
      round2((K1P + K2P - prov.supplemental_credit_threshold) * prov.supplemental_credit_rate)
    );
  }
  const T4 = Math.max(
    0,
    round2(round2(prov.rates[pi] * A) - prov.constants[pi] - K1P - K2P - K5P)
  );

  // ---------- Tax this period ----------
  const federalTax = round2(T3 / P);
  const provincialTax = round2(T4 / P);
  const incomeTax = round2((T3 + T4) / P + L);

  return {
    gross,
    cpp,
    cpp2,
    ei,
    federalTax,
    provincialTax,
    incomeTax,
    employerCpp: cpp,
    employerCpp2: cpp2,
    employerEi: round2(ei * e.employer_multiplier),
    annualTaxableIncome: A,
    annualFederalTax: T3,
    annualProvincialTax: T4,
  };
}

// Periods per year for a company's pay frequency
export function periodsPerYear(frequency: string) {
  switch (frequency) {
    case "weekly":
      return 52;
    case "biweekly":
      return 26;
    case "semi_monthly":
      return 24;
    case "monthly":
      return 12;
    default:
      return 26;
  }
}