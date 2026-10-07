import type { OtpProvider } from "@/lib/otp/providers";

/** Development provider: prints the code to the server console. */
export const consoleProvider: OtpProvider = {
  async sendEmail({ to, code, name }) {
    console.log(`\n[OTP] Email to ${to} (${name}): your code is ${code}\n`);
  },
  async sendSms({ to, code }) {
    console.log(`\n[OTP] SMS to ${to}: your code is ${code}\n`);
  },
};
