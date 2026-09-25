const { PaymentGatewayProvider } = require("./PaymentGatewayProvider");
const { getSettingNumber } = require("../../lib/settings");

/**
 * Simulates a real payment gateway charge — used until MitaPesa actually
 * signs up with a real gateway (Flutterwave, DPO, Selcom, or similar are
 * common choices in this region). Always succeeds by default, but honors
 * voice_credit_purchase_simulated_failure_rate, the same simulated-
 * failure-injection pattern cbs_simulated_failure_rate and tips_
 * simulated_failure_rate already use elsewhere in this app — so the
 * failure-handling path (a declined card, a gateway timeout) can
 * actually be tested before a real gateway ever exists to fail for real.
 */
class MockPaymentGatewayProvider extends PaymentGatewayProvider {
  async chargeCard({ userId, amountTzs, description }) {
    const failureRate = (await getSettingNumber("voice_credit_purchase_simulated_failure_rate")) || 0;
    if (Math.random() * 100 < failureRate) {
      return { success: false, gatewayReference: null, failureReason: "Simulated card decline (mock payment gateway)." };
    }
    return {
      success: true,
      gatewayReference: `mock_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      failureReason: null,
    };
  }
}

module.exports = { MockPaymentGatewayProvider };
