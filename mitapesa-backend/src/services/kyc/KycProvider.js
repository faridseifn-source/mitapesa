/**
 * Contract every KYC provider must satisfy. The real NIDA integration is
 * actually two external systems behind one interface:
 *   - NIDA (or an approved Reliant Party gateway) for identity lookup + KBV
 *   - An SMS/USSD gateway (MNO-specific or aggregated) for OTP delivery,
 *     since the phone number tied to an identity is SIM-registration data,
 *     not something NIDA itself exposes.
 *
 * @typedef {Object} NidaRecord
 * @property {string} refId            Opaque reference for this lookup (not the raw NIDA number)
 * @property {string} maskedName
 * @property {string} maskedPhone
 * @property {string} ward
 * @property {string} district
 * @property {string} region
 * @property {string} issueYear
 *
 * @typedef {Object} KbvQuestion
 * @property {string} id
 * @property {string} prompt
 * @property {string[]} options
 *
 * @typedef {Object} FullNidaProfile
 * @property {string} firstName
 * @property {string|null} middleName
 * @property {string} lastName
 * @property {string} sex
 * @property {string} dateOfBirth      ISO date string, e.g. "1990-04-12"
 * @property {string} maritalStatus
 * @property {string} placeOfBirth
 * @property {string} citizenshipType
 * @property {string} nidaPhone        the NIDA-registered phone, full/unmasked
 * @property {string} region
 * @property {string} district
 * @property {string} ward
 * @property {string} villageOrStreet
 * @property {string|null} photoUrl    base64 image or URL, if the provider supplies one
 * @property {string} sourceRef        opaque, non-sensitive reference from the provider
 */
class KycProvider {
  /** @param {string} nidaNumber @returns {Promise<NidaRecord>} */
  async lookupIdentity(nidaNumber) {
    throw new Error("lookupIdentity not implemented");
  }

  /** @param {string} refId @returns {Promise<{ sent: boolean, expiresInSec: number }>} */
  async sendOtp(refId) {
    throw new Error("sendOtp not implemented");
  }

  /** @param {string} refId @param {string} code @returns {Promise<boolean>} */
  async verifyOtp(refId, code) {
    throw new Error("verifyOtp not implemented");
  }

  /** @param {string} refId @returns {Promise<KbvQuestion[]>} */
  async getKbvQuestions(refId) {
    throw new Error("getKbvQuestions not implemented");
  }

  /** @param {string} refId @param {Record<string,string>} answers @returns {Promise<{ passed: boolean, correctCount: number }>} */
  async verifyKbv(refId, answers) {
    throw new Error("verifyKbv not implemented");
  }

  /**
   * Only ever called after a successful verifyOtp/verifyKbv for the same
   * refId — real NIDA access to the full record requires the identity
   * check to have already passed.
   * @param {string} refId @returns {Promise<FullNidaProfile>}
   */
  async getFullProfile(refId) {
    throw new Error("getFullProfile not implemented");
  }
}

module.exports = { KycProvider };
