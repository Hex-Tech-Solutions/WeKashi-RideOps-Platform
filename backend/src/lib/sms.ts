import { logger } from './logger';

/**
 * SMS sender interface. Two message types exist in RideOps, each backed by its
 * own DLT-approved MSG91 Flow template:
 *   1. Login OTP   — single variable {otp}
 *   2. Ride OTP    — {vehicle} + {board_otp} + {dboard_otp}
 *
 * The Flow variable names below MUST match the variable names configured in the
 * MSG91 Flow for each template.
 */
export interface SmsSender {
  /** Driver / vendor sign-in OTP (Template 2 — single variable). */
  sendLoginOtp(phone: string, otp: string): Promise<void>;
  /** Employee ride-confirmation OTP (Template 1 — vehicle + two OTPs). */
  sendRideOtp(
    phone: string,
    data: { vehicle: string; boardingOtp: string; deboardingOtp: string },
  ): Promise<void>;
}

/** Console sender for dev/testing — logs instead of calling MSG91. */
export class ConsoleSmssSender implements SmsSender {
  async sendLoginOtp(phone: string, otp: string): Promise<void> {
    logger.info({ phone, otp }, 'SMS (login OTP)');
  }
  async sendRideOtp(
    phone: string,
    data: { vehicle: string; boardingOtp: string; deboardingOtp: string },
  ): Promise<void> {
    logger.info({ phone, ...data }, 'SMS (ride OTP)');
  }
}

/**
 * MSG91 v5 Flow sender (India, DLT). One Flow template per message type.
 *
 * .env.prod:
 *   SMS_PROVIDER=msg91
 *   MSG91_AUTHKEY=<authkey>
 *   MSG91_LOGIN_TEMPLATE_ID=<Template 2 — login OTP>
 *   MSG91_RIDE_TEMPLATE_ID=<Template 1 — ride confirmation>
 *   MSG91_SENDER_ID=<approved sender id>            (optional)
 *
 * Flow variable names expected:
 *   Login template:  otp
 *   Ride template:   vehicle, board_otp, dboard_otp
 */
export class Msg91SmsSender implements SmsSender {
  constructor(
    private authkey: string,
    private loginTemplateId: string,
    private rideTemplateId: string,
    private senderId?: string,
  ) {}

  private async post(templateId: string, mobiles: string, vars: Record<string, string>): Promise<void> {
    const body: Record<string, unknown> = {
      template_id: templateId,
      recipients: [{ mobiles, ...vars }],
    };
    if (this.senderId) body.sender = this.senderId;

    const res = await fetch('https://control.msg91.com/api/v5/flow/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authkey: this.authkey },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.error({ mobiles, templateId, status: res.status, text }, 'MSG91 send failed');
      throw new Error('Failed to send SMS');
    }
    logger.info({ mobiles, templateId }, 'SMS sent via MSG91');
  }

  async sendLoginOtp(phone: string, otp: string): Promise<void> {
    await this.post(this.loginTemplateId, normalizeMobile(phone), { otp });
  }

  async sendRideOtp(
    phone: string,
    data: { vehicle: string; boardingOtp: string; deboardingOtp: string },
  ): Promise<void> {
    await this.post(this.rideTemplateId, normalizeMobile(phone), {
      vehicle: data.vehicle,
      board_otp: data.boardingOtp,
      dboard_otp: data.deboardingOtp,
    });
  }
}

/** MSG91 wants the mobile with country code and no '+'. Defaults to 91 (India). */
function normalizeMobile(phone: string): string {
  const digits = phone.replace(/[^\d]/g, '');
  return digits.length === 10 ? `91${digits}` : digits;
}

/**
 * Factory — MSG91 when both template IDs + authkey are set, else console.
 */
export function createSmsSender(): SmsSender {
  if (
    process.env.SMS_PROVIDER === 'msg91' &&
    process.env.MSG91_AUTHKEY &&
    process.env.MSG91_LOGIN_TEMPLATE_ID &&
    process.env.MSG91_RIDE_TEMPLATE_ID
  ) {
    logger.info('SMS provider: MSG91');
    return new Msg91SmsSender(
      process.env.MSG91_AUTHKEY,
      process.env.MSG91_LOGIN_TEMPLATE_ID,
      process.env.MSG91_RIDE_TEMPLATE_ID,
      process.env.MSG91_SENDER_ID,
    );
  }
  logger.info('SMS provider: console (no real SMS — OTPs are logged server-side)');
  return new ConsoleSmssSender();
}

export const smsSender: SmsSender = createSmsSender();
