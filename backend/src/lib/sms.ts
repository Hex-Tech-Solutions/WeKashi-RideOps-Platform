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
 * Variable names are whatever you named them in the MSG91 template
 * (##var1##, ##OTP##, ...) — the JSON keys sent here must match exactly, or
 * MSG91 sends the SMS with that placeholder blank. Defaults:
 *   Login template:  var1 = OTP
 *   Ride template:   var1 = vehicle, var2 = boarding OTP, var3 = de-boarding OTP
 * Override with MSG91_LOGIN_VARS="OTP" / MSG91_RIDE_VARS="vehicle,board,dboard"
 * (comma-separated, in the order listed above).
 */
export class Msg91SmsSender implements SmsSender {
  constructor(
    private authkey: string,
    private loginTemplateId: string,
    private rideTemplateId: string,
    private senderId?: string,
    private loginVars: string[] = ['var1'],
    private rideVars: string[] = ['var1', 'var2', 'var3'],
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
    // MSG91 can report a rejected request in the body ({"type":"error"}) even
    // with HTTP 200, so check both. {"type":"success"} carries a request id.
    // Note: success only means MSG91 accepted it — DLT/operator delivery
    // failures show up later in the MSG91 delivery report, not here.
    const text = await res.text().catch(() => '');
    let parsed: { type?: string; message?: string } = {};
    try { parsed = JSON.parse(text); } catch { /* non-JSON body */ }
    if (!res.ok || parsed.type === 'error') {
      logger.error({ mobiles, templateId, status: res.status, text }, 'MSG91 send failed');
      throw new Error('Failed to send SMS');
    }
    logger.info({ mobiles, templateId, requestId: parsed.message }, 'SMS sent via MSG91');
  }

  /** Pair configured variable names with values, in order. */
  private vars(names: string[], values: string[]): Record<string, string> {
    return Object.fromEntries(values.map((v, i) => [names[i] ?? `var${i + 1}`, v]));
  }

  async sendLoginOtp(phone: string, otp: string): Promise<void> {
    await this.post(this.loginTemplateId, normalizeMobile(phone), this.vars(this.loginVars, [otp]));
  }

  async sendRideOtp(
    phone: string,
    data: { vehicle: string; boardingOtp: string; deboardingOtp: string },
  ): Promise<void> {
    await this.post(
      this.rideTemplateId,
      normalizeMobile(phone),
      this.vars(this.rideVars, [data.vehicle, data.boardingOtp, data.deboardingOtp]),
    );
  }
}

/** Parse a comma-separated env list ("OTP" / "vehicle,board,dboard"). */
function envList(value: string | undefined): string[] | undefined {
  const list = value?.split(',').map((s) => s.trim()).filter(Boolean);
  return list && list.length > 0 ? list : undefined;
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
      envList(process.env.MSG91_LOGIN_VARS),
      envList(process.env.MSG91_RIDE_VARS),
    );
  }
  logger.info('SMS provider: console (no real SMS — OTPs are logged server-side)');
  return new ConsoleSmssSender();
}

export const smsSender: SmsSender = createSmsSender();
