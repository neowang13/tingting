"use client";

export const CREDIT_REPORT_VOLUNTARY_TEXT = "I confirm that I voluntarily provide this credit score report for assessment of my rental application.";

export function CreditReportConsent({ checked, disabled, hasReport, onChange }: {
  checked: boolean; disabled: boolean; hasReport: boolean; onChange: (value: boolean) => void;
}) {
  return <div className="credit-report-consent">
    <label className="application-consent"><input type="checkbox" checked={checked} disabled={disabled || !hasReport}
      required={hasReport} onChange={(event) => onChange(event.target.checked)} /><span>{CREDIT_REPORT_VOLUNTARY_TEXT}</span></label>
    <small className="field-hint">Confirm this yourself after uploading your report. We do not request a credit check from a credit agency.</small>
  </div>;
}
