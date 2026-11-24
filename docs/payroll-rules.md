# Payroll rules used by SiteStamp

How SiteStamp calculates vacation pay, general holiday pay, custom deductions
and the year-end T4 summary, with the source for each rule. Code that applies a
rule names the section it comes from (`src/utils/leave.ts`,
`src/utils/payRun.ts`, `src/utils/payroll.ts`, `src/utils/deductions.ts`,
`src/utils/t4.ts`).

All sources were accessed on **2026-11-22**. Re-check them when rates or
legislation change; the legislation is the authority when a summary differs.

## Sources

| Source | Version |
| --- | --- |
| Alberta Employment Standards Code, RSA 2000 c E-9 (King's Printer office consolidation), <https://kings-printer.alberta.ca/documents/Acts/E09.pdf> | Current as of November 26, 2025 |
| Alberta Employment Standards Regulation, Alta Reg 14/1997 (office consolidation), <https://kings-printer.alberta.ca/documents/Regs/1997_014.pdf> | Amendments up to AR 281/2025, current as of January 1, 2026 |
| Alberta, "Construction – Employment standards exceptions", <https://www.alberta.ca/es-exceptions-construction> | No date shown |
| Alberta, "Vacation pay", <https://www.alberta.ca/vacation-pay> | No date shown |
| Alberta, "Deductions from earnings", <https://www.alberta.ca/deductions-from-earnings> | No date shown |
| CRA, "Vacation pay and public holidays", <https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/special-payments/vacation-pay-public-holidays.html> | Page date 2026-04-29 |
| CRA, T4127 Payroll Deductions Formulas, <https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas.html> | 124th edition (effective 2027-01-01, updated 2026-11-19); the bonus formulas are the same structure as earlier editions |
| CRA, RC4120 Employers' Guide – Filing the T4 Slip and Summary, <https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/rc4120/employers-guide-filing-t4-slip-summary.html> | Rev. 25 |
| CRA, "Filling out the T4 slip", <https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/completing-filing-information-returns/t4-information-employers/t4-slip/filling-t4-slip.html> | — |
| OpenStreetMap tile usage policy, <https://operations.osmfoundation.org/policies/tiles/>; Nominatim usage policy, <https://operations.osmfoundation.org/policies/nominatim/>; <https://www.openstreetmap.org/copyright> | — |

Tax rates (CPP, EI, brackets, YMPE/YAMPE, EI maximum insurable earnings) are
not in the code. They come from the `tax_rates` table, by pay date.

## Who gets which rules

Alberta has two sets of rules, so each employee is either a **construction
employee** or **other employee**. The employer sets a company default and can
override it per person (Payroll → Employee pay setup). If neither is set,
SiteStamp does **not** calculate vacation or holiday pay for that person and
warns on every pay run.

- **Construction employee**, Regulation s.44(a): employed at the site of and in
  the construction, erection, repair, remodelling, alteration, painting,
  interior decoration or demolition of a building or structure, road, highway,
  railway, airfield, sidewalk, curb, gutter, pipeline, irrigation or drainage
  system, earth and rock fill dam, sewage system, power line or gas
  distribution system (or brush clearing). Not ongoing site maintenance or
  office staff. For them, Regulation Part 4 replaces Code ss.26–33 and the
  vacation pay division (s.45).
- **Other employee**: the Employment Standards Code rules below.

Subcontractors are not employees and get none of this (as before).

## "Wages"

Code s.1(1)(x): wages exclude overtime pay, vacation pay, general holiday pay
and termination pay. SiteStamp's base for vacation pay, construction holiday
pay and the average daily wage is therefore **regular hours × wage rate**.
Overtime hours (and holiday hours paid at 1.5×) are left out.

## Vacation pay

**Construction employees** (Reg. ss.48–50): at least **6%** of wages from the
start of employment. Paid on or before December 31 each year, or the day before
a vacation starts, whichever is first; on termination within Code s.8(2).
SiteStamp warns on December pay runs and for terminated employees with a balance.

**Other employees** (Code ss.34–43):

- 4% of wages while entitled to 2 weeks' vacation, 6% once entitled to 3 weeks
  (s.34.2). The 3-week entitlement starts after 5 consecutive years of
  employment (s.34(1)(b)); s.42(2)(b) applies 6% to wages "from the date the
  employee last became entitled" to the vacation. SiteStamp applies **6% to
  wages earned on or after the 5th anniversary** of the employment start date,
  day by day, so a pay period that crosses the anniversary is split.
- Breaks of less than 90 days don't restart the count (s.36); the employer
  enters the start of continuous employment.
- No start date entered → 4%, with a warning on every pay run.
- s.43: vacation pay paid in one year of employment is wages for the next
  year's vacation pay. alberta.ca/vacation-pay says employers who pay vacation
  pay frequently (every pay period) don't need to do this. SiteStamp adds
  vacation pay on lump payouts (from a saved balance) at the rate that applies
  from the next employment anniversary, and not on pay-every-cheque amounts.
- Timing (s.41): may be paid at any time, but no later than the next regular
  payday after the vacation starts.

**Each cheque or when taken.** Per employee: "pay on every cheque" adds this
period's vacation pay to the stub. "Save it up" records it as owed; the
employer pays it from a draft pay run. The balance is always
`sum(earned) − sum(paid)` over **finalized** stubs, so an amount paid on a
cheque is never also owed later. Payouts are capped at what's owed.

## General holidays

**Construction employees** (Reg. ss.46–47): at least **3.6%** of wages as
general holiday pay, instead of the nine-holiday rules. No day off is owed and
work on a holiday is a regular day. Paid each pay period or saved and paid by
December 31 (or on termination). Same balance tracking as vacation pay.

**Other employees** (Code ss.24.1–33). The nine general holidays (s.25):
New Year's Day, Alberta Family Day (3rd Monday of February), Good Friday,
Victoria Day (Monday before May 25), Canada Day (July 2 when July 1 is a
Sunday), Labour Day, Thanksgiving Day, Remembrance Day, Christmas Day. Optional
days an employer may designate (s.25(k)), such as Boxing Day, are not included.

| Rule | Section | How SiteStamp decides |
| --- | --- | --- |
| Eligible after 30 work days in the 12 months before the holiday | 26(1) | Distinct days with a completed shift in clock records. Employer can override. |
| Not entitled if they skipped scheduled work on the holiday, or were absent without consent on the last regular work day before / first after | 26(2) | **Not in clock data.** Every run with a holiday asks the employer to confirm; a "not entitled" checkbox per person. |
| Normal work day if they worked that weekday in at least 5 of the 9 weeks before the work week of the holiday | 27 | From clock records. Employer can override. |
| Normal work day, didn't work: average daily wage | 28 | |
| Normal work day, worked: average daily wage **plus** 1.5× wage for hours worked | 29(1)(a) | The alternative, s.29(1)(b) (regular pay plus a substitute day off), is not supported. |
| Not a normal work day, worked: 1.5× wage for hours worked | 30 | |
| Not a normal work day, didn't work: nothing | — | |
| Hours paid at 1.5× don't count toward overtime that week | 33 | Those shifts are left out of the overtime split. |
| Average daily wage = total wages ÷ days worked, over the 4 weeks before the holiday **or** the 4 weeks ending on the last day of the previous pay period | 24.1 | Employer chooses the period (Payroll → Employee pay setup). Wages exclude overtime and earlier holiday hours paid at 1.5×. |

The old "5% of 4 weeks' wages" method in older Alberta guides was replaced by
s.24.1 and is not used.

## Minimum wage

Employment Standards Regulation s.9 (current as of January 1, 2026; accessed
2026-11-23; also <https://www.alberta.ca/minimum-wage>). Employees only;
subcontractors aren't employees.

- **$15.00/hour** for employees (s.9(1)(a)(iii)).
- **$13.00/hour** for an employee **under 18 who is enrolled in school**, for
  work during a school break and for the **first 28 hours of a work week**
  outside a school break (s.9(1)(a.1)). School-break hours don't count toward
  the 28 (s.9(3)). Every other hour is at least $15.00.

How SiteStamp applies it:

- An employee's wage can't be saved below $15.00, or $13.00 while their
  "student rate ends on" date is in the future (Crew & wages, invites, and a
  database trigger for any other writer). The date is their 18th birthday or
  when they leave school; their date of birth isn't stored.
- Pay runs: student hours past the 28th in a work week (counted from the start
  of the work week, including days in the previous pay period) are topped up to
  $15.00; overtime hours are topped up at the overtime multiplier. The employer
  can mark a whole pay period as a school break for a student, which allows
  $13.00 on every hour. A period that's only partly a break should be left
  unmarked: that pays more than required, which is always allowed.
- A wage saved before this rule that's below the minimum is topped up on every
  hour, with a warning to fix it.
- The top-up on regular hours is wages, so vacation pay and construction
  holiday pay are earned on it.
- General holiday pay (average daily wage and the 1.5× premium) never uses a
  rate below $15.00. For a student paid less this can be slightly more than
  required, never less.
- **Not handled:** the 3-hour minimum for a shift shorter than 3 consecutive
  hours (s.11), and weekly or monthly minimums for salespeople and live-in
  domestic employees (s.9(1)(b), (c)).

## Custom deductions

Code s.12: besides deductions required by law, an employer may only deduct
amounts authorized by a collective agreement or **personally authorized in
writing** by the employee, and never for faulty work, damage, or cash/property
losses others had access to. Changing or stopping an ongoing deduction needs a
new authorization. SiteStamp records whether authorization is on file and
warns on every pay run if it isn't; it doesn't block the deduction.

| Kind | Tax treatment | T4 |
| --- | --- | --- |
| Union dues | Reduces annual taxable income for withholding (T4127 factor U1); CPP and EI unchanged | Box 44, only if the union won't issue receipts (RC4120); employer can turn it off |
| Health or dental premium (employee-paid, private health services plan) | After tax | Other information code 85, optional (RC4120); not in box 14 |
| Other benefit premium | After tax | Not reported; flagged in the T4 summary |
| Tool loan repayment | After tax | Not reported; flagged in the T4 summary |
| Other | After tax | Not reported; flagged in the T4 summary |

The database only accepts those combinations. Pre-tax RPP/RRSP contributions,
employer-paid taxable benefits and charitable donations are **not** supported,
so nothing silently changes taxable income.

Tool loans may have a total lent; repayments stop at the balance (total minus
what finalized stubs already took). Deductions never take net pay below $0:
anything that doesn't fit is reduced and a warning names it. Union dues are
taken first, and tax is recalculated on the dues actually taken.

## Tax on vacation and holiday pay

CRA "Vacation pay and public holidays":

- Holiday pay in a pay period with a public holiday: regular salary for tax,
  CPP and EI.
- Vacation pay paid while on vacation: regular.
- Vacation pay paid on a continuous basis (every cheque) or paid without
  taking vacation: **income tax by the bonus method**, EI as regular salary,
  CPP by the bonus method. CRA's CPP page says a payment made with regular pay
  uses the regular CPP method, which is what SiteStamp does (it is always paid
  with the regular cheque).

Bonus method (T4127, "Tax calculation formulas for bonuses…"): tax on the
payment = annual tax on `P × (I − F5A − U1) + (B − F5B) + (B1 − F5BYTD)` minus
annual tax without the current `B`; flat 15% if the annual amount with the
payment is $5,000 or less. `B1`/`F5BYTD` are bonus-method amounts already paid
this year from finalized stubs (saved in `details.tax`).

**Assumption:** construction 3.6% holiday pay paid every period is taxed as
regular salary (it's paid in normal pay periods; CRA has no specific rule for
it). A lump payout of saved-up holiday pay uses the bonus method as a
non-periodic payment. Confirm with your accountant.

## Year-end T4 summary

An accountant-preparation aid, not a CRA filing and not official slips.

- Finalized pay runs only, by **pay date** (RC4120: income is reported in the
  year it's paid). Finalized stubs can't be edited, deleted or regenerated
  (database triggers), and each stub is counted once. Overlapping finalized
  periods and draft runs in the year are flagged.
- Box 14 = gross (includes vacation and holiday pay paid); 16 CPP; 16A CPP2;
  18 EI; 22 income tax; 24 = gross capped at the year's maximum insurable
  earnings; 26 = gross capped at the year's YAMPE (RC4120 Rev. 25: boxes 24 and
  26 must not be blank); 44 union dues; code 85.
- Not available in SiteStamp, flagged for the accountant: SIN (box 12),
  employee home address, box 45 dental code, CPP age exemptions, box 54 if the
  employer hasn't entered it. SINs and home addresses are deliberately not
  stored.
- Subcontractor payments are excluded and totalled separately.

## Known limits

- Wage history isn't stored, so the average daily wage uses the wage on the
  employee's profile when the pay run is calculated.
- Schedules, absences and vacation days aren't in SiteStamp, so s.26(2), s.27
  edge cases and s.31 (holiday during vacation) depend on the employer's
  review.
- Monthly-salaried employees (Code s.34.1) aren't supported; SiteStamp pays
  hourly.
- Times are grouped into days by the browser's local time zone, as the rest of
  the app does.
