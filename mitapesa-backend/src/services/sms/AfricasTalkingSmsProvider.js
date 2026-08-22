const AfricasTalking = require("africastalking");
const { SmsProvider } = require("./SmsProvider");

class AfricasTalkingSmsProvider extends SmsProvider {
  constructor({ apiKey, username, senderId }) {
    super();
    this.sms = AfricasTalking({ apiKey, username }).SMS;
    this.senderId = senderId || undefined;
  }

  async sendOtp(phoneE164, code) {
    const options = {
      to: [phoneE164],
      message: `Your MitaPesa verification code is ${code}. It expires in 10 minutes.`,
      ...(this.senderId ? { from: this.senderId } : {}),
    };
    const response = await this.sms.send(options);
    // Africa's Talking returns 200 even on per-recipient failures — the
    // actual delivery status is nested per recipient, so check it explicitly
    // rather than trusting a non-throwing call.
    const recipients = response?.SMSMessageData?.Recipients || [];
    const failed = recipients.find((r) => r.status !== "Success");
    if (failed) throw new Error(`Africa's Talking failed to send: ${failed.status}`);
  }
}

module.exports = { AfricasTalkingSmsProvider };
