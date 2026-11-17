"use client";

import { PrintIcon } from "./ui/Icons";

export default function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="btn btn-primary print:hidden">
      <PrintIcon />
      Download / print PDF
    </button>
  );
}
