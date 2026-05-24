import { redirect } from "next/navigation";
import { CENTRAL_AUTH_URL } from "@/lib/config/central-auth";

export default function HomePage() {
  redirect(CENTRAL_AUTH_URL);
}
