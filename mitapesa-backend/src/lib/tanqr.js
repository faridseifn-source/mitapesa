/**
 * TANQR (Tanzania Quick Response Code Standard 2022) payload parser —
 * built directly against the Bank of Tanzania standard, itself based on the
 * EMVCo Merchant-Presented QR Code Specification. See
 * docs/TANQR_PAYMENT_FLOW.md for the full reference this implements against.
 *
 * Every merchant-presented TANQR/TIPS QR code is a sequence of TLV
 * (Tag-Length-Value) data objects: a 2-digit tag, a 2-digit length, then
 * that many characters of value. Some tags (26, 62) are themselves
 * templates containing nested TLV data objects.
 */

const { dammCheckDigit, dammValidate } = require("./damm");

/**
 * TIPS Alias Merchant ID (TANQR Annex 3 §2) — a feature-phone-friendly
 * manual entry format: AAA-CCCC-S (3-digit Acquirer Code + 4-digit
 * Merchant Code + 1 Damm check digit), displayed/typed without the hyphens
 * as an 8-digit string.
 *
 * The spec doesn't mandate exactly how an acquirer maps its full merchant
 * account number down to 4 digits — that's acquirer-specific. This
 * implementation's convention (documented here for anyone extending it):
 * Acquirer Code = the 3-digit participant-code portion of the 5-digit
 * Acquirer ID (i.e. without its 2-digit category prefix); Merchant Code =
 * the first 4 digits of the merchant's account number, matching the
 * spec's own worked example (Merchant Account "12345678" → Merchant Code
 * "1234"). Consistent within our own registry, which is what matters for
 * resolving it back.
 */
function buildAliasMerchantId(acquirerId, merchantId) {
  const acquirerCode = acquirerId.slice(-3);
  const merchantCode = merchantId.slice(0, 4).padStart(4, "0");
  const check = dammCheckDigit(`${acquirerCode}${merchantCode}`);
  return `${acquirerCode}${merchantCode}${check}`;
}

function parseAliasMerchantId(alias) {
  const digits = String(alias).replace(/\D/g, "");
  if (digits.length !== 8) throw new Error("Merchant number should be 8 digits");
  if (!dammValidate(digits)) throw new Error("That merchant number doesn't look right — please check it and try again");
  return { acquirerCode: digits.slice(0, 3), merchantCode: digits.slice(3, 7) };
}

const TAGS = {
  PAYLOAD_FORMAT_INDICATOR: "00",
  POINT_OF_INITIATION_METHOD: "01",
  TIPS_MERCHANT_ACCOUNT_INFO: "26", // BOT-assigned root for TIPS in Tanzania
  MERCHANT_CATEGORY_CODE: "52",
  TRANSACTION_CURRENCY: "53",
  TRANSACTION_AMOUNT: "54",
  TIP_OR_CONVENIENCE_INDICATOR: "55",
  CONVENIENCE_FEE_FIXED: "56",
  CONVENIENCE_FEE_PERCENTAGE: "57",
  COUNTRY_CODE: "58",
  MERCHANT_NAME: "59",
  MERCHANT_CITY: "60",
  POSTAL_CODE: "61",
  ADDITIONAL_DATA_FIELD_TEMPLATE: "62",
  CRC: "63",
};

const ADDITIONAL_DATA_SUBTAGS = {
  "01": "billNumber",
  "02": "mobileNumber",
  "03": "storeLabel",
  "04": "loyaltyNumber",
  "05": "referenceLabel",
  "06": "customerLabel",
  "07": "terminalLabel",
  "08": "purposeOfTransaction",
};

const TZS_CURRENCY_CODE = "834"; // ISO 4217 numeric for Tanzanian Shillings

/**
 * Parses a flat TLV string into an ordered list of { tag, length, value }.
 * Does not recurse into templates — caller decides which tags to descend into.
 */
function parseTlv(raw) {
  const objects = [];
  let i = 0;
  while (i < raw.length) {
    if (i + 4 > raw.length) throw new Error("Malformed QR payload: truncated data object");
    const tag = raw.slice(i, i + 2);
    const lengthStr = raw.slice(i + 2, i + 4);
    const length = parseInt(lengthStr, 10);
    if (isNaN(length)) throw new Error(`Malformed QR payload: invalid length at tag ${tag}`);
    const valueStart = i + 4;
    const valueEnd = valueStart + length;
    if (valueEnd > raw.length) throw new Error(`Malformed QR payload: tag ${tag} length exceeds remaining data`);
    objects.push({ tag, length, value: raw.slice(valueStart, valueEnd) });
    i = valueEnd;
  }
  return objects;
}

/**
 * CRC-16/CCITT-FALSE — polynomial 0x1021, initial value 0xFFFF, as specified
 * in TANQR §5.5 / [ISO/IEC 13239]. Computed over every data object up to and
 * including the CRC tag+length ("6304"), excluding the CRC value itself.
 */
function computeCrc16(data) {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * Parses and fully validates a scanned TANQR payload string.
 * @param {string} raw — the raw string decoded from the QR image
 * @returns {object} structured, validated payload
 * @throws {Error} with a customer-safe message if the payload is malformed,
 *   the CRC doesn't match, or it isn't a TIPS-format Tanzanian QR code
 */
function parseTanqrPayload(raw) {
  if (!raw || typeof raw !== "string" || raw.length < 20) {
    throw new Error("This doesn't look like a valid payment QR code");
  }

  // CRC must be validated over the exact original string, before any other parsing.
  const crcTagIndex = raw.lastIndexOf(`${TAGS.CRC}04`);
  if (crcTagIndex === -1 || crcTagIndex + 8 !== raw.length) {
    throw new Error("QR code is missing its checksum — it may be damaged or incomplete");
  }
  const providedCrc = raw.slice(crcTagIndex + 4, crcTagIndex + 8).toUpperCase();
  const dataForCrc = raw.slice(0, crcTagIndex + 4); // includes "6304", excludes the CRC value
  const expectedCrc = computeCrc16(dataForCrc);
  if (providedCrc !== expectedCrc) {
    throw new Error("QR code checksum doesn't match — it may have been altered or corrupted");
  }

  const objects = parseTlv(raw);
  const byTag = Object.fromEntries(objects.map((o) => [o.tag, o]));

  if (byTag[TAGS.PAYLOAD_FORMAT_INDICATOR]?.value !== "01") {
    throw new Error("Unsupported QR code format");
  }

  const poiValue = byTag[TAGS.POINT_OF_INITIATION_METHOD]?.value;
  if (poiValue !== "11" && poiValue !== "12") {
    throw new Error("QR code is missing a valid initiation method");
  }
  const pointOfInitiationMethod = poiValue === "12" ? "dynamic" : "static";

  const merchantTemplate = byTag[TAGS.TIPS_MERCHANT_ACCOUNT_INFO];
  if (!merchantTemplate) {
    throw new Error("This QR code isn't a recognized Tanzania payment code");
  }
  const merchantSubObjects = parseTlv(merchantTemplate.value);
  const merchantByTag = Object.fromEntries(merchantSubObjects.map((o) => [o.tag, o.value]));
  const domainName = merchantByTag["00"];
  const acquirerId = merchantByTag["01"];
  const merchantId = merchantByTag["02"];
  if (domainName !== "tz.go.bot.tips") {
    throw new Error("This QR code isn't a recognized TIPS payment code");
  }
  if (!acquirerId || acquirerId.length !== 5) {
    throw new Error("QR code is missing a valid acquirer identifier");
  }
  if (!merchantId) {
    throw new Error("QR code is missing a merchant identifier");
  }

  const merchantName = byTag[TAGS.MERCHANT_NAME]?.value;
  if (!merchantName) throw new Error("QR code is missing the merchant name");
  const countryCode = byTag[TAGS.COUNTRY_CODE]?.value || "TZ";
  const merchantCity = byTag[TAGS.MERCHANT_CITY]?.value || null;
  const postalCode = byTag[TAGS.POSTAL_CODE]?.value || null;
  const mcc = byTag[TAGS.MERCHANT_CATEGORY_CODE]?.value || null;

  const currencyCode = byTag[TAGS.TRANSACTION_CURRENCY]?.value;
  if (currencyCode && currencyCode !== TZS_CURRENCY_CODE) {
    throw new Error("This QR code isn't for a Tanzanian Shilling payment");
  }

  const amountStr = byTag[TAGS.TRANSACTION_AMOUNT]?.value;
  const amount = amountStr ? Number(amountStr) : null;
  if (amountStr && (isNaN(amount) || amount <= 0)) {
    throw new Error("QR code has an invalid transaction amount");
  }

  let additionalData = {};
  const additionalTemplate = byTag[TAGS.ADDITIONAL_DATA_FIELD_TEMPLATE];
  if (additionalTemplate) {
    const subObjects = parseTlv(additionalTemplate.value);
    additionalData = Object.fromEntries(
      subObjects.filter((o) => ADDITIONAL_DATA_SUBTAGS[o.tag]).map((o) => [ADDITIONAL_DATA_SUBTAGS[o.tag], o.value])
    );
  }

  return {
    pointOfInitiationMethod, // "static" | "dynamic"
    acquirerId,
    merchantId,
    merchantName,
    merchantCity,
    postalCode,
    mcc,
    countryCode,
    currencyCode: currencyCode || TZS_CURRENCY_CODE,
    amount, // null if the QR doesn't fix an amount (customer must enter one)
    amountFixed: amount !== null,
    additionalData,
    rawPayload: raw,
  };
}

module.exports = { parseTanqrPayload, computeCrc16, buildAliasMerchantId, parseAliasMerchantId, TAGS };
