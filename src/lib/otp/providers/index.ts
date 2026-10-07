import { consoleProvider } from "@/lib/otp/providers/console";
import { awsProvider } from "@/lib/otp/providers/aws";

export interface OtpProvider {
  sendEmail(input: { to: string; code: string; name: string }): Promise<void>;
  sendSms(input: { to: string; code: string }): Promise<void>;
}

/**
 * Selects the delivery provider from OTP_PROVIDER:
 *   console -> logs the code to the server terminal (local development)
 *   aws     -> Amazon SES for email, Amazon SNS for SMS
 */
export function getOtpProvider(): OtpProvider {
  const name = (process.env.OTP_PROVIDER ?? "console").toLowerCase();
  switch (name) {
    case "aws":
      return awsProvider;
    case "console":
      return consoleProvider;
    default:
      throw new Error(`Unknown OTP_PROVIDER "${name}". Use "console" or "aws".`);
  }
}
