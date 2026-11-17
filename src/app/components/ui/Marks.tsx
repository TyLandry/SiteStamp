import { initials, personTint } from "@/utils/format";

/** The SiteStamp mark: a sheet with its title block and a red stamp. */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden="true" focusable="false">
      <rect x="1.5" y="1.5" width="19" height="19" rx="2" fill="none" stroke="#1c2830" strokeWidth="1.6" />
      <path d="M1.5 15h19M15 15v5.5" stroke="#1c2830" strokeWidth="1.6" />
      <path d="M5 11.5 11 4.5l6 7z" fill="#d23a2a" />
    </svg>
  );
}

/** A numbered revision delta: marks an item that needs a decision. */
export function Delta({ n }: { n: number }) {
  return (
    <span className="delta" aria-label={`Item ${n}`}>
      <svg viewBox="0 0 24 22" aria-hidden="true" focusable="false">
        <path d="M12 1.5 22.5 20.5h-21z" />
      </svg>
      <span>{n}</span>
    </span>
  );
}

/** A small filled delta, used on a time bar that needs a look. */
export function DeltaFlag({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 14 13" aria-hidden="true" focusable="false">
      <path d="M7 1 13 12H1z" fill="#d23a2a" />
    </svg>
  );
}

/** A person's initials on their stable identity tint. */
export function Avatar({ id, name }: { id: string; name: string | null | undefined }) {
  const tint = personTint(id);
  return (
    <span className="av" style={{ background: tint.bg, color: tint.fg }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
