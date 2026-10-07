/**
 * The reporting team's Prasang Submission Form (Microsoft Forms). One source
 * for its link and wording: the Home card (src/components/dashboard/PrasangCard.tsx),
 * the /prasang page (which announcements link to, as they can only open in-app
 * pages) and the composer's "Prasang form" template all read these.
 *
 * Client-safe: plain constants only.
 */

export const PRASANG_FORM_URL =
  "https://forms.cloud.microsoft/pages/responsepage.aspx?id=vYPE0EyNF0uHS9KIombwfg92fB3woehDgLw0xhOQ6uRUODczQTJQWlFYM1BBOVlYVFpKR1RLNEw0SS4u&route=shorturl";

export const PRASANG_TITLE = "Prasang Submission Form";

export const PRASANG_SUBTITLE = "Help us capture your stories and prasangs for NAAM";

/**
 * Shown under every button that opens the form (PrasangFormHint in
 * src/components/dashboard/PrasangCard.tsx). The form opens in the same tab
 * (no target="_blank"): in Telegram's in-app browser a new tab leaves the Hub and
 * the guest has to reopen it, whereas Back returns straight here. Never tell
 * browser guests to tap "Done" or close anything: in Safari-view in-app browsers
 * that closes the whole browser and loses the Hub.
 */
export const PRASANG_FORM_HINT = "Opens the Microsoft Form here. Use Back to return to the Hub.";

/**
 * The same hint for a Hub added to the iPhone home screen (manifest display
 * "standalone"): there the off-site form opens in a Safari sheet whose only
 * control is "Done", which returns to the Hub. PrasangFormHint shows it only
 * under `display-mode: standalone`, so browser guests never see it.
 */
export const PRASANG_FORM_HINT_STANDALONE = "Opens the Microsoft Form here. Tap Done to return to the Hub.";
