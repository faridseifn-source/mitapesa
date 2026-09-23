const crypto = require("crypto");
const { KycProvider } = require("./KycProvider");

const FIRST_NAMES = ["Amina", "Baraka", "Elias", "Furaha", "Grace", "Hamisi", "Irene", "Juma", "Neema", "Zawadi"];
const LAST_NAMES = ["Mushi", "Kileo", "Ngowi", "Massawe", "Mrema", "Kway", "Sanga", "Chuma", "Lyimo"];
const WARDS = ["Kinondoni", "Ilala", "Temeke", "Ubungo", "Kigamboni", "Magomeni", "Mikocheni", "Sinza"];
const DISTRICTS = ["Kinondoni", "Ilala", "Temeke", "Kigamboni", "Ubungo"];
const REGIONS = ["Dar es Salaam", "Mwanza", "Arusha", "Dodoma", "Mbeya", "Morogoro", "Tanga"];
const SEXES = ["Male", "Female"];
const MARITAL_STATUSES = ["Single", "Married", "Divorced", "Widowed"];
const CITIZENSHIP_TYPES = ["Citizen by birth", "Citizen by naturalization", "Citizen by registration"];
const VILLAGES_STREETS = ["Mikocheni Street", "Sinza Village", "Kariakoo Street", "Msasani Village", "Tabata Street", "Kigamboni Village"];

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
const maskName = (name) => `${name[0]}${"*".repeat(Math.max(2, name.length - 1))}`;
const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5);
const optionsFor = (correct, pool) => shuffle([correct, ...shuffle(pool.filter((x) => x !== correct)).slice(0, 3)]);
const pad2 = (n) => String(n).padStart(2, "0");

// Keyed by refId. In-memory only — fine for a mock; a real provider would
// have no server-side session at all (NIDA/telco own that state).
const sessions = new Map();

class MockNidaProvider extends KycProvider {
  async lookupIdentity(nidaNumber) {
    const h = hashCode(nidaNumber);
    const first = FIRST_NAMES[h % FIRST_NAMES.length];
    const last = LAST_NAMES[Math.floor(h / 7) % LAST_NAMES.length];
    const phoneLast4 = String(1000 + (h % 9000));
    const ward = WARDS[h % WARDS.length];
    const district = DISTRICTS[Math.floor(h / 3) % DISTRICTS.length];
    const region = REGIONS[Math.floor(h / 5) % REGIONS.length];
    const issueYear = String(2014 + (h % 11));

    // Extra fields only exposed via getFullProfile(), after verification —
    // never returned from lookupIdentity() itself (that stays masked/partial).
    const sex = SEXES[h % SEXES.length];
    const maritalStatus = MARITAL_STATUSES[Math.floor(h / 11) % MARITAL_STATUSES.length];
    const citizenshipType = CITIZENSHIP_TYPES[Math.floor(h / 13) % CITIZENSHIP_TYPES.length];
    const villageOrStreet = VILLAGES_STREETS[Math.floor(h / 17) % VILLAGES_STREETS.length];
    const birthYear = 1970 + (h % 40);
    const birthMonth = pad2(1 + (h % 12));
    const birthDay = pad2(1 + (Math.floor(h / 19) % 28));
    const dateOfBirth = `${birthYear}-${birthMonth}-${birthDay}`;
    const nidaPhone = `+255${700000000 + (h % 99999999)}`;
    const placeOfBirth = `${district}, ${region}`;

    const refId = crypto.randomUUID();
    sessions.set(refId, {
      record: {
        first, last, ward, district, region, issueYear,
        sex, maritalStatus, citizenshipType, villageOrStreet, dateOfBirth, nidaPhone, placeOfBirth,
      },
      phoneLast4,
      otp: null,
      otpExpiresAt: null,
      kbvQuestions: null,
      attempts: 0,
    });

    return {
      refId,
      maskedName: `${maskName(first)} ${maskName(last)}`,
      maskedPhone: `+255 •• ••• ${phoneLast4}`,
      ward,
      district,
      region,
      issueYear,
    };
  }

  async sendOtp(refId) {
    const session = sessions.get(refId);
    if (!session) throw new Error("Unknown or expired KYC session");
    // Real provider: dispatch via SMS/USSD gateway to the MNO-registered number.
    session.otp = String(Math.floor(100000 + Math.random() * 900000));
    session.otpExpiresAt = Date.now() + 300_000; // 5 minutes — enough time to find it in the logs while testing
    // Always logged while this mock is active — there's no other way to
    // retrieve the code for testing, and a real provider never calls this
    // console.log line at all, so there's no risk of this leaking a real
    // OTP in production once a genuine NidaProvider replaces this class.
    console.log(`[MockNidaProvider] OTP for ${refId}: ${session.otp}`); // eslint-disable-line no-console
    return { sent: true, expiresInSec: 300 };
  }

  async verifyOtp(refId, code) {
    const session = sessions.get(refId);
    if (!session || !session.otp) return false;
    session.attempts += 1;
    // Session is deliberately NOT deleted on success here (unlike earlier
    // versions of this mock) — getFullProfile() needs it immediately
    // afterward to sync the full NIDA record. A real provider holds no
    // server-side session at all, so this cleanup concern doesn't apply to it.
    return session.otp === code && Date.now() < session.otpExpiresAt;
  }

  async getKbvQuestions(refId) {
    const session = sessions.get(refId);
    if (!session) throw new Error("Unknown or expired KYC session");
    const { record } = session;
    const yearPool = Array.from({ length: 11 }, (_, i) => String(2014 + i));
    const questions = [
      { id: "ward", prompt: "Which ward is listed on your NIDA record?", correct: record.ward, options: optionsFor(record.ward, WARDS) },
      { id: "region", prompt: "Which region issued your NIDA card?", correct: record.region, options: optionsFor(record.region, REGIONS) },
      { id: "issueYear", prompt: "What year was your NIDA card issued?", correct: record.issueYear, options: optionsFor(record.issueYear, yearPool) },
    ];
    session.kbvQuestions = questions;
    // Strip the correct answer before sending to the client.
    return questions.map(({ id, prompt, options }) => ({ id, prompt, options }));
  }

  async verifyKbv(refId, answers) {
    const session = sessions.get(refId);
    if (!session || !session.kbvQuestions) throw new Error("Call getKbvQuestions first");
    session.attempts += 1;
    const correctCount = session.kbvQuestions.filter((q) => answers[q.id] === q.correct).length;
    return { passed: correctCount >= 2, correctCount };
  }

  async getFullProfile(refId) {
    const session = sessions.get(refId);
    if (!session) throw new Error("Unknown or expired KYC session — cannot retrieve full profile");
    const { record } = session;
    return {
      firstName: record.first,
      middleName: null, // this mock dataset doesn't model middle names
      lastName: record.last,
      sex: record.sex,
      dateOfBirth: record.dateOfBirth,
      maritalStatus: record.maritalStatus,
      placeOfBirth: record.placeOfBirth,
      citizenshipType: record.citizenshipType,
      nidaPhone: record.nidaPhone,
      region: record.region,
      district: record.district,
      ward: record.ward,
      villageOrStreet: record.villageOrStreet,
      photoUrl: null, // mock provider has no photo source; a real one would supply base64/URL here
      sourceRef: refId,
    };
  }
}

module.exports = { MockNidaProvider };
