import { SPLASH_DARK_QUERY, SPLASH_WALLPAPER, SPLASH_WALLPAPER_SIZE } from "@/lib/splash";
import styles from "./splash.module.css";

/**
 * The sign-in splash's artwork: the organisers' Sāchu wallpaper, full screen, light or dark to
 * follow the system appearance (the <picture> picks, so no JS and no hydration difference).
 * Static; the animated reveal is <SplashReveal> (via <LoginSplash> in the signed-in layouts).
 * LoginForm also shows it, portalled to <body>, to cover the login page while home loads.
 *
 * The wallpaper is shown whole-image and unaltered: sized like object-fit: cover on portrait
 * screens, capped so the Sāchu lock-up inside it is never cut, and fitted to the height on
 * landscape ones rather than blown up (splash.module.css), never recoloured. Decorative:
 * hidden from assistive tech, nothing focusable, the page underneath stays fully usable.
 */
export function SplashArt() {
  return (
    <div aria-hidden="true" className={styles.art}>
      <picture>
        <source media={SPLASH_DARK_QUERY} srcSet={SPLASH_WALLPAPER.dark} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={SPLASH_WALLPAPER.light}
          width={SPLASH_WALLPAPER_SIZE.w}
          height={SPLASH_WALLPAPER_SIZE.h}
          alt=""
          loading="eager"
          decoding="sync"
          fetchPriority="high"
          draggable={false}
          className={styles.img}
        />
      </picture>
    </div>
  );
}
