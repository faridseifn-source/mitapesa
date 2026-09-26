/**
 * Contract every email provider must satisfy. Kept deliberately narrow —
 * one method per email this app actually sends — rather than a generic
 * "send anything" interface, so each email's content lives in one place.
 */
class EmailProvider {
  /** @param {string} toEmail @param {string} code — the reset code, already formatted for display */
  async sendPasswordReset(toEmail, code) {
    throw new Error("sendPasswordReset not implemented");
  }

  /** @param {string} toEmail @param {string} code — admin login second-factor code */
  async sendAdminLoginCode(toEmail, code) {
    throw new Error("sendAdminLoginCode not implemented");
  }

  /** @param {string} toEmail @param {string} code — new-customer email onboarding verification code */
  async sendVerificationCode(toEmail, code) {
    throw new Error("sendVerificationCode not implemented");
  }
}

module.exports = { EmailProvider };
