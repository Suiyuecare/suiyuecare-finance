import Image from "next/image";
import { cn } from "@/lib/utils";

type SuiyueLogoProps = {
  className?: string;
  imageClassName?: string;
  label?: string;
};

export function SuiyueLogo({ className, imageClassName, label = "歲悅長照" }: SuiyueLogoProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-center overflow-hidden rounded-xl border border-[#f0c987] bg-[#fff3de] shadow-[0_8px_24px_rgba(92,46,0,0.12)]",
        className,
      )}
      aria-label={label}
    >
      <Image
        src="/suiyue-care-logo.png"
        alt={label}
        width={160}
        height={160}
        priority
        className={cn("h-full w-full object-contain", imageClassName)}
      />
    </div>
  );
}
