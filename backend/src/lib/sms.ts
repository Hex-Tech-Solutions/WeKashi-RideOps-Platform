import { logger } from './logger';

/**
 * Interface for SMS senders — injectable so Twilio or any other
 * provider can be dropped in by implementing this interface.
 */
export interface SmsSender {
  send(phone: string, message: string): Promise<void>;
}

/**
 * Console-based SMS sender for development / testing.
 * Logs the message instead of making a real API call.
 */
export class ConsoleSmssSender implements SmsSender {
  async send(phone: string, message: string): Promise<void> {
    logger.info({ phone, message }, 'SMS');
  }
}

/**
 * MSG91 sender (India). Uses the v5 Flow API with a DLT-approved OTP template.
 *
 * Because Indian DLT rules require pre-approved templates, we don't send free
 * text — we extract the numeric OTP from the message and pass it to the template
 * as a variable. Configure via .env.prod:
 *   SMS_PROVIDER=msg91
 *   MSG91_AUTHKEY=<authkey from MSG91 dashboard>
 *   MSG91_TEMPLATE_ID=<DLT/flow template id>
 *   MSG91_SENDER_ID=<6-char approved sender id>   (optional, if template needs it)
 *   MSG91_OTP_VAR=OTP                             (template variable name, default "OTP")
 */
export class Msg91SmsSender implements SmsSender {
  constructor(
    private authkey: string,
    private templateId: string,
    private senderId?: string,
    private otpVar: string = 'OTP',
  ) {}

  async send(phone: string, message: string): Promise<void> {
    // MSG91 expects the mobile with country code and no '+'.
    const mobiles = phone.replace(/[^\d]/g, '');
    const otpMatch = message.match(/\d{4,8}/);
    const otp = otpMatch ? otpMatch[0] : message;

    const body: Record<string, unknown> = {
      template_id: this.templateId,
      recipients: [{ mobiles, [this.otpVar]: otp }],
    };
    if (this.senderId) body.sender = this.senderId;

    const res = await fetch('https://control.msg91.com/api/v5/flow/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authkey: this.authkey },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.error({ phone, status: res.status, text }, 'MSG91 send failed');
      throw new Error('Failed to send OTP SMS');
    }
    logger.info({ phone }, 'OTP SMS sent via MSG91');
  }
}

/**
 * Factory — returns the MSG91 sender when its credentials are set,
 * otherwise falls back to the console sender (logs the OTP server-side).
 */
export function createSmsSender(): SmsSender {
  if (
    process.env.SMS_PROVIDER === 'msg91' &&
    process.env.MSG91_AUTHKEY &&
    process.env.MSG91_TEMPLATE_ID
  ) {
    logger.info('SMS provider: MSG91');
    return new Msg91SmsSender(
      process.env.MSG91_AUTHKEY,
      process.env.MSG91_TEMPLATE_ID,
      process.env.MSG91_SENDER_ID,
      process.env.MSG91_OTP_VAR || 'OTP',
    );
  }
  logger.info('SMS provider: console (no real SMS — OTP is logged server-side)');
  return new ConsoleSmssSender();
}

export const smsSender: SmsSender = createSmsSender();
