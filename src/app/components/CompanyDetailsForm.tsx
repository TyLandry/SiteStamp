"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { EMPLOYER_PROFILE_FIELDS, type EmployerProfile } from "@/utils/payRun";

const PROVINCES = ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"];

type Form = {
  legal_name: string;
  address_line1: string;
  address_line2: string;
  city: string;
  province: string;
  postal_code: string;
  phone: string;
  email: string;
  cra_payroll_account: string;
};

const EMPTY: Form = {
  legal_name: "",
  address_line1: "",
  address_line2: "",
  city: "",
  province: "",
  postal_code: "",
  phone: "",
  email: "",
  cra_payroll_account: "",
};

// "t2p1j9" → "T2P 1J9"; anything else is returned trimmed so validation can reject it
function normalizePostal(v: string) {
  const compact = v.replace(/\s+/g, "").toUpperCase();
  return /^[A-Z][0-9][A-Z][0-9][A-Z][0-9]$/.test(compact) ? `${compact.slice(0, 3)} ${compact.slice(3)}` : v.trim();
}

/** The employer's name, address and CRA account, shown on pay stubs and the T4 summary. */
export default function CompanyDetailsForm() {
  const supabase = createClient();
  const [form, setForm] = useState<Form>(EMPTY);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      const { data: me } = await supabase.from("profiles").select("org_id").eq("id", user.id).single();
      const org = (me?.org_id as string | undefined) ?? null;
      setOrgId(org);
      if (org) {
        const [{ data }, { data: o }] = await Promise.all([
          supabase.from("employer_profiles").select(EMPLOYER_PROFILE_FIELDS).eq("org_id", org).maybeSingle(),
          supabase.from("orgs").select("name").eq("id", org).maybeSingle(),
        ]);
        const p = data as EmployerProfile | null;
        if (p) {
          setForm({
            legal_name: p.legal_name ?? "",
            address_line1: p.address_line1 ?? "",
            address_line2: p.address_line2 ?? "",
            city: p.city ?? "",
            province: p.province ?? "",
            postal_code: p.postal_code ?? "",
            phone: p.phone ?? "",
            email: p.email ?? "",
            cra_payroll_account: p.cra_payroll_account ?? "",
          });
        }
        setOrgName((o as { name?: string | null } | null)?.name ?? null);
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (key: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setError(null);
    if (!orgId) {
      setError("You're not logged in.");
      return;
    }

    const postal = normalizePostal(form.postal_code);
    const account = form.cra_payroll_account.replace(/\s+/g, "").toUpperCase();
    const email = form.email.trim();
    if (postal && !/^[A-Z][0-9][A-Z] [0-9][A-Z][0-9]$/.test(postal)) {
      setError("Enter a Canadian postal code like T2P 1J9.");
      return;
    }
    if (account && !/^[0-9]{9}RP[0-9]{4}$/.test(account)) {
      setError("The CRA payroll account is 15 characters: 9-digit business number, RP, then 4 digits (e.g. 123456789RP0001).");
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Enter a valid email address, or leave it blank.");
      return;
    }

    const clean = (v: string) => (v.trim() === "" ? null : v.trim());
    setSaving(true);
    const { error: saveError } = await supabase.from("employer_profiles").upsert(
      {
        org_id: orgId,
        legal_name: clean(form.legal_name),
        address_line1: clean(form.address_line1),
        address_line2: clean(form.address_line2),
        city: clean(form.city),
        province: form.province || null,
        postal_code: postal || null,
        phone: clean(form.phone),
        email: email || null,
        cra_payroll_account: account || null,
      },
      { onConflict: "org_id" }
    );
    if (saveError) setError(saveError.message);
    else {
      setForm((f) => ({ ...f, postal_code: postal, cra_payroll_account: account }));
      setMessage("Saved. New and recalculated pay stubs will show these details.");
    }
    setSaving(false);
  }

  return (
    <div className="setting border-t-0 pt-0">
      <div>
        <h2>Company details</h2>
        <p className="hint mt-1">
          Shown at the top of pay stubs and on the year-end T4 summary. Stubs keep the details they were made with,
          so finalized stubs don&apos;t change.
        </p>
      </div>
      {loading ? (
        <div className="panel p-4 flex flex-col gap-3" aria-busy="true">
          <span className="skeleton w-48" />
          <span className="skeleton w-full" />
        </div>
      ) : (
        <form className="panel panel-body pt-4 flex flex-col gap-4" onSubmit={save}>
          <div className="field">
            <label htmlFor="co-legal">Legal business name</label>
            <input id="co-legal" className="input" maxLength={120} value={form.legal_name} onChange={set("legal_name")} />
            <span className="hint">
              {orgName ? `Leave blank to use "${orgName}".` : "As registered with the CRA."}
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="field">
              <label htmlFor="co-addr1">Street address</label>
              <input id="co-addr1" className="input" maxLength={120} autoComplete="address-line1" value={form.address_line1} onChange={set("address_line1")} />
            </div>
            <div className="field">
              <label htmlFor="co-addr2">Unit, suite (optional)</label>
              <input id="co-addr2" className="input" maxLength={120} autoComplete="address-line2" value={form.address_line2} onChange={set("address_line2")} />
            </div>
            <div className="field">
              <label htmlFor="co-city">City</label>
              <input id="co-city" className="input" maxLength={80} autoComplete="address-level2" value={form.city} onChange={set("city")} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="field">
                <label htmlFor="co-prov">Province</label>
                <select id="co-prov" className="select" value={form.province} onChange={set("province")}>
                  <option value="">—</option>
                  {PROVINCES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="co-postal">Postal code</label>
                <input id="co-postal" className="input" maxLength={7} autoComplete="postal-code" value={form.postal_code} onChange={set("postal_code")} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="co-phone">Phone</label>
              <input id="co-phone" className="input" type="tel" maxLength={30} autoComplete="tel" value={form.phone} onChange={set("phone")} />
            </div>
            <div className="field">
              <label htmlFor="co-email">Payroll email</label>
              <input id="co-email" className="input" type="email" maxLength={254} autoComplete="email" value={form.email} onChange={set("email")} />
            </div>
          </div>
          <div className="field max-w-sm">
            <label htmlFor="co-ba">CRA payroll account number</label>
            <input
              id="co-ba"
              className="input"
              maxLength={17}
              placeholder="123456789RP0001"
              value={form.cra_payroll_account}
              onChange={set("cra_payroll_account")}
            />
            <span className="hint">For T4 box 54. Only on the T4 summary for your accountant, never on pay stubs.</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Save company details"}
            </button>
            {message ? (
              <p className="msg-ok" role="status">
                {message}
              </p>
            ) : null}
            {error ? (
              <p className="msg-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </form>
      )}
    </div>
  );
}
