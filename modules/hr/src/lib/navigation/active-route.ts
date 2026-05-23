export function isNavigationItemActive(pathname: string, href: string) {
  if (href === "/dashboard") {
    return pathname === href;
  }

  if (href === "/requests") {
    return pathname === "/requests";
  }

  if (href === "/requests/new") {
    return pathname === "/requests/new" || pathname.startsWith("/requests/new/");
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}
