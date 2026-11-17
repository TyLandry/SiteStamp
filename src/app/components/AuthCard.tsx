import { BrandMark } from "./ui/Marks";

/** Centered sign-in card used by the login and set-password screens. */
export default function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="brand mb-8 justify-center">
          <BrandMark size={26} />
          <span className="text-lg">SiteStamp</span>
        </div>
        <section className="panel p-6 sm:p-8">
          <h1>{title}</h1>
          <p className="finding mb-6">{subtitle}</p>
          {children}
        </section>
      </div>
    </main>
  );
}
