const { Resend } = require("resend");
const { EmailProvider } = require("./EmailProvider");

class ResendEmailProvider extends EmailProvider {
  constructor({ apiKey, fromAddress }) {
    super();
    this.client = new Resend(apiKey);
    this.fromAddress = fromAddress;
  }

  async sendPasswordReset(toEmail, code) {
    const { error } = await this.client.emails.send({
      from: this.fromAddress,
      to: toEmail,
      subject: "Your MitaPesa password reset code",
      html: `
        <div style="font-family: sans-serif; max-width: 420px; margin: 0 auto;">
          <p>Someone requested a password reset for your MitaPesa account.</p>
          <p style="font-size: 28px; font-weight: 700; letter-spacing: 2px; background: #f3f2ee; padding: 16px; border-radius: 12px; text-align: center;">${code}</p>
          <p style="color: #666; font-size: 13px;">This code expires in 30 minutes. If you didn't request this, you can safely ignore this email — your password hasn't changed.</p>
        </div>
      `,
    });
    if (error) {
      // Surface the failure rather than silently swallowing it — a broken
      // email integration should be loud, not invisible.
      throw new Error(`Resend failed to send: ${error.message || JSON.stringify(error)}`);
    }
  }

  async sendAdminLoginCode(toEmail, code) {
    const { error } = await this.client.emails.send({
      from: this.fromAddress,
      to: toEmail,
      subject: "Your MitaPesa admin login code",
      html: `
        <div style="font-family: sans-serif; max-width: 420px; margin: 0 auto;">
          <p>Someone is signing in to the MitaPesa Admin Portal with your account.</p>
          <p style="font-size: 28px; font-weight: 700; letter-spacing: 2px; background: #f3f2ee; padding: 16px; border-radius: 12px; text-align: center;">${code}</p>
          <p style="color: #666; font-size: 13px;">This code expires in 10 minutes. If this wasn't you, change your password immediately — someone has your admin credentials.</p>
        </div>
      `,
    });
    if (error) {
      throw new Error(`Resend failed to send: ${error.message || JSON.stringify(error)}`);
    }
  }

  async sendVerificationCode(toEmail, code) {
    const { error } = await this.client.emails.send({
      from: this.fromAddress,
      to: toEmail,
      subject: "Your MitaPesa verification code",
      html: `
        <div style="font-family: sans-serif; max-width: 420px; margin: 0 auto;">
          <p>Welcome to MitaPesa! Use this code to verify your email and finish setting up your account.</p>
          <p style="font-size: 28px; font-weight: 700; letter-spacing: 2px; background: #f3f2ee; padding: 16px; border-radius: 12px; text-align: center;">${code}</p>
          <p style="color: #666; font-size: 13px;">This code expires in 30 minutes. If you didn't try to create a MitaPesa account, you can safely ignore this email.</p>
        </div>
      `,
    });
    if (error) {
      throw new Error(`Resend failed to send: ${error.message || JSON.stringify(error)}`);
    }
  }

  // Sent after the account is already gone, to the address it used. Doubles
  // as a security notice: if someone deleted the account without the owner's
  // knowledge, this is the owner's first and only signal.
  async sendAccountDeleted(toEmail) {
    const { error } = await this.client.emails.send({
      from: this.fromAddress,
      to: toEmail,
      subject: "Your MitaPesa account has been deleted",
      html: `
        <div style="font-family: sans-serif; max-width: 420px; margin: 0 auto;">
          <p>Your MitaPesa account has been deleted, and your personal data — expenses, budgets, categories and saved devices — has been removed.</p>
          <p style="color: #666; font-size: 13px;">If you used a MitaPesa card, completed an identity check or made payments, financial regulations require us to keep those records — including your name and identity details held in them — for the regulated period after you close your account. They are stored securely and used only for legal and regulatory purposes.</p>
          <p style="color: #666; font-size: 13px;">If you didn't ask for this, please contact us straight away.</p>
        </div>
      `,
    });
    if (error) {
      throw new Error(`Resend failed to send: ${error.message || JSON.stringify(error)}`);
    }
  }

  // Restoring a deleted account is an unusual, admin-initiated action on
  // someone's personal data, so the owner is always told. If it wasn't them
  // asking, this email is how they find out.
  async sendAccountRestored(toEmail) {
    const { error } = await this.client.emails.send({
      from: this.fromAddress,
      to: toEmail,
      subject: "Your MitaPesa account has been restored",
      html: `
        <div style="font-family: sans-serif; max-width: 420px; margin: 0 auto;">
          <p>Your MitaPesa account has been restored by our team, with the data it held when it was deleted. You can sign in again with your previous password.</p>
          <p style="color: #666; font-size: 13px;">If you didn't ask for this, please contact us straight away.</p>
        </div>
      `,
    });
    if (error) {
      throw new Error(`Resend failed to send: ${error.message || JSON.stringify(error)}`);
    }
  }
}

module.exports = { ResendEmailProvider };
