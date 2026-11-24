// Custom deductions an employer sets up per employee, and how each kind is
// treated for tax and the T4. The database enforces the same combinations
// (employee_deductions_treatment_chk). Sources: docs/payroll-rules.md.

export type DeductionKind =
  | "union_dues"
  | "health_dental_premium"
  | "other_benefit_premium"
  | "tool_loan"
  | "other";

export type TaxTreatment = "union_dues_u1" | "after_tax";
export type T4Box = "44" | "85";

export type Deduction = {
  id: string;
  org_id: string;
  profile_id: string;
  kind: DeductionKind;
  name: string;
  amount_per_pay: number;
  loan_total: number | null;
  tax_treatment: TaxTreatment;
  t4_box: T4Box | null;
  authorization_on_file: boolean;
  starts_on: string | null;
  ends_on: string | null;
  active: boolean;
  deactivated_at: string | null;
  created_at: string;
};

/** One deduction as taken on a stub (pay_stubs.other_deductions). */
export type StubDeduction = {
  deduction_id: string;
  kind: DeductionKind;
  name: string;
  amount: number;
  tax_treatment: TaxTreatment;
  t4_box: T4Box | null;
  loan_total?: number | null;
  loan_remaining_after?: number | null;
};

type KindInfo = {
  label: string;
  treatment: TaxTreatment;
  /** The box this kind may be reported in, if any (the employer opts in). */
  t4Box: T4Box | null;
  t4BoxDefault: boolean;
  /** What the employer sees when choosing the kind. */
  explain: string;
  t4Question?: string;
};

export const DEDUCTION_KINDS: Record<DeductionKind, KindInfo> = {
  union_dues: {
    label: "Union dues",
    treatment: "union_dues_u1",
    t4Box: "44",
    t4BoxDefault: true,
    explain:
      "Lowers the income tax withheld (CRA factor U1). CPP and EI are not affected.",
    t4Question:
      "Report in T4 box 44. Leave on only if you and the union agreed the union won't issue its own receipts.",
  },
  health_dental_premium: {
    label: "Health or dental premium",
    treatment: "after_tax",
    t4Box: "85",
    t4BoxDefault: true,
    explain: "The employee's share of a private health or dental plan. Taken after tax.",
    t4Question: "Report in T4 'Other information' code 85 (optional; lets the employee claim it as a medical expense).",
  },
  other_benefit_premium: {
    label: "Other benefit premium",
    treatment: "after_tax",
    t4Box: null,
    t4BoxDefault: false,
    explain:
      "For example group life or disability. Taken after tax and not reported on the T4. Ask your accountant if the plan needs other reporting.",
  },
  tool_loan: {
    label: "Tool loan repayment",
    treatment: "after_tax",
    t4Box: null,
    t4BoxDefault: false,
    explain: "Repays money the company lent. Taken after tax, stops when the balance reaches $0.",
  },
  other: {
    label: "Other",
    treatment: "after_tax",
    t4Box: null,
    t4BoxDefault: false,
    explain: "Taken after tax and not reported on the T4.",
  },
};

export const TAX_TREATMENT_LABELS: Record<TaxTreatment, string> = {
  union_dues_u1: "Before tax (union dues)",
  after_tax: "After tax",
};
