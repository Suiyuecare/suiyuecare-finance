import { LoginForm } from "@/features/auth/login-form";
import { SuiyueLogo } from "@/components/brand/suiyue-logo";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen bg-[#eee7de] p-0 sm:p-4">
      <section className="finance-shell-card mx-auto grid min-h-screen w-full max-w-[1200px] overflow-hidden sm:min-h-[calc(100vh-2rem)] sm:rounded-[18px] md:grid-cols-[0.92fr_1.08fr]">
        <div className="relative flex min-h-[250px] flex-col justify-between overflow-hidden bg-[linear-gradient(145deg,#9a4f05_0%,#d97706_48%,#f1a234_100%)] p-5 text-white sm:min-h-[440px] sm:p-10 lg:p-11">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.18),rgba(255,255,255,0)_34%),radial-gradient(circle_at_25%_20%,rgba(255,255,255,0.25),transparent_28%)]" />
          <div className="relative">
            <div className="mb-5 flex items-center gap-3 sm:mb-9 sm:gap-4">
              <SuiyueLogo className="h-14 w-14 rounded-[16px] border-white/75 bg-white/95 p-1 shadow-[0_18px_44px_rgba(92,46,0,0.24)] sm:h-[74px] sm:w-[74px] sm:rounded-[18px]" />
              <div>
                <div className="text-lg font-black">歲悅長照集團</div>
                <div className="mt-1 text-xs tracking-[0.22em] text-white/70">
                  SUIYUE CARE GROUP
                </div>
              </div>
            </div>
            <h1 className="max-w-sm text-2xl font-black leading-tight tracking-normal sm:text-3xl">
              集團營運系統入口
            </h1>
            <div className="mt-4 grid gap-2 text-sm leading-6 text-white/85 sm:mt-6 sm:gap-3 sm:leading-7">
              {[
                "同一組帳號登入後，依照權限選擇模組。",
                "業務、人資、會計系統共用帳號、法人與部門主檔。",
                "人資模組延續 Finance OS V3 的簽核、資料與權限邏輯。",
              ].map((item) => (
                <p key={item} className="flex gap-3 before:mt-[10px] before:h-1.5 before:w-1.5 before:shrink-0 before:rounded-full before:bg-white">
                  {item}
                </p>
              ))}
            </div>
          </div>
          <div className="relative mt-5 text-xs tracking-[0.18em] text-white/65">
            SUIYUE CARE GROUP · HR OS V3
          </div>
        </div>
        <div className="flex items-center justify-center bg-[#fbfaf8] p-4 sm:p-8">
          <LoginForm />
        </div>
      </section>
    </main>
  );
}
