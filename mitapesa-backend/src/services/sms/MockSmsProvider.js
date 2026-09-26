const { SmsProvider } = require("./SmsProvider");

class MockSmsProvider extends SmsProvider {
  async sendOtp(phoneE164, code) {
    console.log(`[sms:mock] To: ${phoneE164} | Your MitaPesa verification code is ${code} (expires in 10 min)`); // eslint-disable-line no-console
  }
}

module.exports = { MockSmsProvider };
