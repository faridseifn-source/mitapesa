const crypto = require("crypto");
const { PaymentRailProvider } = require("./PaymentRailProvider");

const TIPS_MERCHANTS = ["Kariakoo Textile Shop", "Mama Ntilie Kitchen", "Highway Auto Spares", "Sunrise Pharmacy", "Bahari Beach Cafe"];

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

class MockTipsProvider extends PaymentRailProvider {
  async resolveRecipient(destination) {
    const name = TIPS_MERCHANTS[hashCode(destination) % TIPS_MERCHANTS.length];
    return { name, accountRef: destination };
  }

  async initiatePayment({ destination, amount }) {
    // Real implementation: call the sponsor bank's TIPS-wrapped API,
    // handle async settlement callbacks/webhooks, and reconcile by providerRef.
    return { providerRef: crypto.randomUUID(), status: "completed" };
  }

  async checkStatus(providerRef) {
    return { providerRef, status: "completed" };
  }
}

module.exports = { MockTipsProvider };
