const { EmailProvider } = require("./EmailProvider");

class MockEmailProvider extends EmailProvider {
  async sendPasswordReset(toEmail, code) {
    console.log(`[email:mock] To: ${toEmail} | Subject: Your MitaPesa password reset code | Code: ${code} (expires in 30 min)`); // eslint-disable-line no-console
  }

  async sendAdminLoginCode(toEmail, code) {
    console.log(`[email:mock] To: ${toEmail} | Subject: Your MitaPesa admin login code | Code: ${code} (expires in 10 min)`); // eslint-disable-line no-console
  }

  async sendVerificationCode(toEmail, code) {
    console.log(`[email:mock] To: ${toEmail} | Subject: Your MitaPesa verification code | Code: ${code} (expires in 30 min)`); // eslint-disable-line no-console
  }
}

module.exports = { MockEmailProvider };
