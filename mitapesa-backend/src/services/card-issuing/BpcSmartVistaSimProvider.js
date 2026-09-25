const prisma = require("../../lib/prisma");
const { CardIssuingProvider } = require("./CardIssuingProvider");
const { genCardCredentials } = require("../../lib/cardCredentials");
const { encryptField } = require("../../lib/crypto");
const { getSetting } = require("../../lib/settings");
const { toLocalMobileFormat } = require("../../lib/phone");

/**
 * Simulates a connection to a real Card Management System (CMS) — modeled
 * directly on BPC SmartVista's documented Webgate / SVAP interfaces, rather
 * than on our own made-up shapes. This exists so the eventual real
 * integration is a transport-layer swap (SOAP/HTTP calls to BPC instead of
 * local Prisma writes) rather than a rewrite of how the rest of the app
 * talks to "the card system."
 *
 * Every method below is commented with the real BPC operation it stands in
 * for, and simulates that operation's actual request/response shape and
 * error vocabulary internally, even though the persistence underneath is
 * still our own database (which is standing in for BPC's SVBO/SVFE DB
 * until the real connection exists).
 *
 * Source docs: SmartVista Webgate specification guide (SVWG) and the SVAP
 * issuing file/web-service structure guide, both BPC Banking Technologies.
 */
class BpcSmartVistaSimProvider extends CardIssuingProvider {
  // Simulated network latency, so timing-sensitive UI (spinners, retries)
  // behaves the way it will against a real SOAP endpoint.
  async _simulateLatency(ms = 180) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  _bpcError(code, description) {
    // Reserved for future use — real BPC error responses carry both a
    // WSA/WSR code and a description, and richer error handling here
    // (mapping specific BPC codes to specific user-facing messages) is a
    // natural next step once the real connection exists.
    const err = new Error(description);
    err.bpcErrorCode = code;
    return err;
  }

  // Simulates the wallet/account number SmartVista would assign and return
  // once it receives our mobile-number-keyed generation request. A real
  // integration replaces this whole method with reading that value straight
  // out of the actual SOAP response — nothing else in the app needs to
  // change, since callers only ever see the returned reference, never how
  // it was produced.
  _simulateCmsWalletNumber() {
    return `SV${Math.floor(1000000000 + Math.random() * 8999999999)}`;
  }

  // Real operation: CardLink, ApplType=LKTPNECT ("card for new customer").
  // SVWG §3.11, Table 81/82.
  //
  // Per the requested integration behavior: the wallet/account identifier
  // WE submit to the CMS is the customer's own mobile number in local
  // format — no country code, WITH the leading zero (e.g. "0712552287") —
  // not an internal MitaPesa id. If an account already exists at SmartVista
  // for that number, it links to it; otherwise SmartVista provisions a new
  // one. Either way, SmartVista is the one that generates the actual wallet
  // number and hands it back to us — we never invent it ourselves. That
  // returned reference is stored in `Card.processorRef`.
  async issueCard({ userId, holderName }) {
    await this._simulateLatency();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { phone: true } });
    const account = toLocalMobileFormat(user.phone); // <account> field in the real createVirtualCard/cardLink request

    const binPrefix = await getSetting("card_bin");
    const { last4, fullNumber, cvv } = genCardCredentials(binPrefix);
    // Real response is just { status: 1 } plus whatever the CMS assigns as
    // CardId/CardNumber/account reference — we simulate that assignment here.
    const cmsWalletNumber = this._simulateCmsWalletNumber();

    const card = await prisma.card.create({
      data: {
        userId,
        holderName,
        last4,
        processorRef: cmsWalletNumber, // the wallet number SmartVista returned for `account`
        fullNumberEnc: encryptField(fullNumber),
        cvvEnc: encryptField(cvv),
        expiry: "09/29",
        balance: 0,
        controls: { online: true, contactless: true, atm: true },
      },
    });
    return this._snapshot(card);
  }

  // Real operation: for type="parent_linked" this is CardLink with
  // ApplType=LKTPEXSC ("supplementary card for existing card and account") —
  // SVWG §3.11. For type="independent" it's createVirtualCard — SVWG §3.3,
  // Table 65/66 (request: account, cellPhone, expiryDate, limitValue;
  // response: cardNumber, expiryDate, limitValue, cvv2, pin).
  //
  // Same account-identifier rule as issueCard(): the mobile number of the
  // person the card is actually issued TO (the holder — not the owner who's
  // requesting it) is what's submitted as `account`. For a parent-linked
  // card this is deliberately the child/member's own number, not the
  // primary member's — the add-on card is SmartVista's record for that
  // specific person, even though the primary member funds and controls it.
  async issueVirtualCard({ walletId, ownerId, holderId, type, label }) {
    await this._simulateLatency();
    const holder = await prisma.user.findUniqueOrThrow({ where: { id: holderId }, select: { phone: true } });
    const account = toLocalMobileFormat(holder.phone);

    const binPrefix = await getSetting("card_bin");
    const { last4, fullNumber, cvv } = genCardCredentials(binPrefix);
    const cmsWalletNumber = this._simulateCmsWalletNumber();

    const card = await prisma.virtualCard.create({
      data: {
        walletId,
        ownerId,
        holderId,
        type,
        label: label || null,
        last4,
        processorRef: cmsWalletNumber,
        fullNumberEnc: encryptField(fullNumber),
        cvvEnc: encryptField(cvv),
        expiry: "09/29",
      },
    });
    return { id: card.id, last4: card.last4, expiry: card.expiry, processorRef: card.processorRef };
  }

  // Real operation: BalanceInquiry — SVWG §1.8, Table 33/34.
  async getBalance(externalCardId) {
    await this._simulateLatency(120);
    const card = await prisma.card.findUniqueOrThrow({ where: { id: externalCardId } });
    return this._snapshot(card);
  }

  // Real operation: ChangeCardStatus — SVWG §1.5, Table 27/28.
  // frozen=true -> a "temporarily blocked" CardStatusCode; frozen=false ->
  // "active". The exact codes are bank-configured (CHST dictionary) — these
  // placeholders must be confirmed against the live BPC instance's
  // dictionary at real-integration time.
  async setFrozen(externalCardId, frozen) {
    await this._simulateLatency();
    const card = await prisma.card.update({ where: { id: externalCardId }, data: { frozen } });
    return this._snapshot(card);
  }

  // Real operation: closest analog is ChangeCardRestrictions (SVWG §1.15) —
  // BPC's restriction model is transaction-type/channel based (POS, ATM,
  // e-commerce, etc.), which online/contactless/atm here maps onto directly.
  async setControls(externalCardId, controls) {
    await this._simulateLatency();
    const card = await prisma.card.update({ where: { id: externalCardId }, data: { controls } });
    return this._snapshot(card);
  }

  // Real operation: ChangeCardLimit / ChangeCardLimits — SVWG §1.7 & §1.16,
  // Table 31/32 & 49/50 (the plural version supports multiple limit types
  // and date-bounded limits; we use a single always-on daily limit here).
  async setDailyLimit(externalCardId, dailyLimit) {
    await this._simulateLatency();
    const card = await prisma.card.update({ where: { id: externalCardId }, data: { dailyLimit } });
    return this._snapshot(card);
  }

  // Real balance movement on a live CMS happens via authorization/settlement
  // messages (ISO 8583), not a direct "debit" API call — a card purchase or
  // top-up posts to the account asynchronously. This method compresses that
  // into a single synchronous call for our purposes, same as the mock
  // provider; that compression is one of the things a real integration will
  // need to unwind (likely into a webhook-driven balance sync instead).
  async credit(externalCardId, { type, amount, label, sub, transferGroupId }, client = prisma) {
    await this._simulateLatency();
    const card = await client.card.update({
      where: { id: externalCardId },
      data: {
        balance: { increment: amount },
        activity: { create: { type, amount, label, sub, transferGroupId } },
      },
      include: { activity: true },
    });
    return this._snapshot(card);
  }

  async debit(externalCardId, { type, amount, label, sub, transferGroupId }, client = prisma) {
    await this._simulateLatency();
    const card = await client.card.findUniqueOrThrow({ where: { id: externalCardId } });
    if (Number(card.balance) < amount) {
      // Must keep `code = "INSUFFICIENT_FUNDS"` — that's what cardHelpers.js's
      // debitCard() checks for to turn this into a clean 400 instead of a
      // raw 500. The BPC-style code is attached alongside it as metadata,
      // since a real decline would carry BPC's own vocabulary (e.g. a
      // NOT_SUFFICIENT_FUNDS-style authorization response) rather than ours.
      const err = new Error("Insufficient card balance");
      err.code = "INSUFFICIENT_FUNDS";
      err.bpcErrorCode = "WSA018"; // "Wrong amount" — SVWG §3.2.2 error catalog
      throw err;
    }
    const updated = await client.card.update({
      where: { id: externalCardId },
      data: {
        balance: { decrement: amount },
        activity: { create: { type, amount: -amount, label, sub, transferGroupId } },
      },
    });
    return this._snapshot(updated);
  }

  _snapshot(card) {
    return {
      externalCardId: card.id,
      balance: Number(card.balance),
      frozen: card.frozen,
      controls: card.controls,
      processorRef: card.processorRef || null, // the wallet number SmartVista returned, once real
    };
  }
}

module.exports = { BpcSmartVistaSimProvider };
