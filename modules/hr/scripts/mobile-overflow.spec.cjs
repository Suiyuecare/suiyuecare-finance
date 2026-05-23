const { test, expect, chromium } = require("@playwright/test");

const base = process.env.BASE_URL || "https://hr.suiyuecare.com";
const user = {
  id: "d9bf99ad-842c-40a9-83b1-a8828495a3a8",
  email: "3@suiyuecare.com",
  role: "hr",
  roleLabel: "人資",
  name: "陳羽俊",
  companyId: "48f39a3e-7bb4-4293-ac4a-0da6e326fe0a",
  primaryBranchId: "f5902e69-e686-4b22-96b5-2e8942759016",
  departmentCode: "HR",
  departmentId: "1009854c-8862-40a1-b62d-c969f2adc46c",
};

const pages = [
  "/dashboard",
  "/employee-portal",
  "/clock",
  "/requests/new",
  "/requests",
  "/approvals",
  "/employees",
  "/hr-admin",
  "/notifications",
  "/operations",
  "/payroll",
  "/payroll/closing",
  "/payroll/roster",
  "/settings",
  "/analytics",
  "/security",
  "/alerts",
];

test("mobile pages do not overflow viewport", async () => {
  test.setTimeout(180000);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.addInitScript(({ user }) => {
    localStorage.setItem("suiyue-hris-quick-login-user", JSON.stringify(user));
    document.cookie = `suiyue_hris_quick_login_user=${encodeURIComponent(JSON.stringify(user))}; path=/; max-age=604800; SameSite=Lax`;
  }, { user });

  const failures = [];
  for (const path of pages) {
    const page = await context.newPage();
    await page.goto(base + path, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(500);
    const data = await page.evaluate(() => {
      const viewportWidth = document.documentElement.clientWidth;
      const offenders = [];
      function hasHorizontalScrollContainer(el) {
        let current = el.parentElement;
        while (current && current !== document.body) {
          const style = getComputedStyle(current);
          const canScroll = ["auto", "scroll"].includes(style.overflowX) && current.scrollWidth > current.clientWidth + 1;
          if (canScroll) return true;
          current = current.parentElement;
        }
        return false;
      }
      for (const el of Array.from(document.querySelectorAll("body *"))) {
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || style.position === "fixed") continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) continue;
        if (hasHorizontalScrollContainer(el)) continue;
        if (rect.right > viewportWidth + 1 || rect.left < -1) {
          offenders.push({
            tag: el.tagName.toLowerCase(),
            className: String(el.className || "").slice(0, 120),
            text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
          });
        }
        if (offenders.length >= 5) break;
      }
      return {
        viewportWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        offenders,
      };
    });
    const hasOverflow =
      data.documentScrollWidth > data.viewportWidth + 1 ||
      data.bodyScrollWidth > data.viewportWidth + 1 ||
      data.offenders.length > 0;
    console.log(`${hasOverflow ? "WARN" : "PASS"} ${path} doc=${data.documentScrollWidth} body=${data.bodyScrollWidth} vw=${data.viewportWidth} offenders=${data.offenders.length}`);
    if (hasOverflow) {
      console.log(JSON.stringify(data.offenders, null, 2));
      failures.push({ path, ...data });
    }
    await page.close();
  }
  await browser.close();

  expect(failures).toEqual([]);
});
