import { signOut } from "@/app/login/actions";

export function Topbar({ email }: { email: string | null }) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-white px-6">
      <div />
      <div className="flex items-center gap-4">
        {email && <span className="text-sm text-ink-light">{email}</span>}
        <form action={signOut}>
          <button type="submit" className="text-sm font-medium text-ink-light hover:text-ink">
            ออกจากระบบ
          </button>
        </form>
      </div>
    </header>
  );
}
