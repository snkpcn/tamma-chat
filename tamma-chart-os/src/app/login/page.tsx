import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-cream-100 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-forest-500">ตำมา-ชาติ OS</h1>
          <p className="mt-1 text-sm text-ink-light">
            ระบบหลังบ้านร้านอาหาร — เข้าสู่ระบบเพื่อดำเนินการต่อ
          </p>
        </div>
        <div className="card p-6">
          <LoginForm next={params.next ?? "/dashboard"} />
        </div>
      </div>
    </main>
  );
}
