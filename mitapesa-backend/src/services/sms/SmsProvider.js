/**
 * Contract every SMS provider must satisfy. One method, same reasoning as
 * the email provider — this exists to send exactly one thing (a phone
 * verification code), not as a general-purpose messaging abstraction.
 */
class SmsProvider {
  /** @param {string} phoneE164 e.g. "+255712345678" @param {string} code */
  async sendOtp(phoneE164, code) {
    throw new Error("sendOtp not implemented");
  }
}

module.exports = { SmsProvider };
