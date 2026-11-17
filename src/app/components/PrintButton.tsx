"use client";

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="bg-gray-800 text-white rounded px-4 py-2 text-sm print:hidden"
    >
      Download / Print PDF
    </button>
  );
}