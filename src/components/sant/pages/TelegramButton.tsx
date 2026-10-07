import { TelegramLogo } from "@/components/icons/TelegramLogo";

/**
 * "Message on Telegram" beside a Santo contact's Call button (user, 2026-10-06): opens the chat
 * at `href` (https://t.me/<username>, src/lib/telegram.ts). Same tab, like every external link
 * in the Hub: Telegram's in-app browser hands a t.me link straight to the chat, and elsewhere
 * the Telegram app (or the t.me page) takes over.
 *
 * `tone`: "light" on a white card, "dark" on an ink one. `size` matches the Call button beside it
 * (text-sm or text-base). `who` names the contact for screen readers, after the visible label
 * ("Message on Telegram, <who>", so the spoken name starts with what is on screen); `iconOnly`
 * for a tight spot (the home tile), where "Message <who> on Telegram" is its only name.
 */
export function TelegramButton({
  href,
  who,
  tone = "light",
  size = "sm",
  label = "Telegram",
  iconOnly = false,
  className = "",
}: {
  href: string;
  who: string;
  tone?: "light" | "dark";
  size?: "sm" | "base";
  label?: string;
  iconOnly?: boolean;
  className?: string;
}) {
  const colours =
    tone === "dark"
      ? "bg-white/10 text-white ring-1 ring-inset ring-white/20 hover:bg-white/15 focus-visible:outline-coral-300"
      : "bg-ink-800 text-white hover:bg-ink-900 focus-visible:outline-ink-800";
  return (
    <a
      href={href}
      aria-label={iconOnly ? `Message ${who} on Telegram` : undefined}
      className={`flex shrink-0 items-center justify-center gap-1.5 rounded-2xl font-bold transition active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 ${
        size === "base" ? "text-base" : "text-sm"
      } ${colours} ${iconOnly ? "w-11" : "px-4"} ${className}`}
    >
      <TelegramLogo className={iconOnly ? "h-5 w-5" : size === "base" ? "h-[18px] w-[18px]" : "h-4 w-4"} />
      {!iconOnly && (
        <>
          {label}
          <span className="sr-only">, {who}</span>
        </>
      )}
    </a>
  );
}
