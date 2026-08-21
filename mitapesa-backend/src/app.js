const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const { ZodError } = require("zod");
const env = require("./lib/env");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");

const authRoutes = require("./modules/auth/auth.routes");
const webauthnRoutes = require("./modules/auth/webauthn.routes");
const pushRoutes = require("./modules/push/push.routes");
const institutionsRoutes = require("./modules/institutions/institutions.routes");
const receiptsRoutes = require("./modules/receipts/receipts.routes");
const exchangeRatesAdminRoutes = require("./modules/exchange-rates/exchangeRates.admin.routes");
const feesAdminRoutes = require("./modules/fees/fees.admin.routes");
const feesRoutes = require("./modules/fees/fees.routes");
const usersRoutes = require("./modules/users/users.routes");
const categoriesRoutes = require("./modules/categories/categories.routes");
const budgetsRoutes = require("./modules/budgets/budgets.routes");
const transactionsRoutes = require("./modules/transactions/transactions.routes");
const walletsRoutes = require("./modules/wallets/wallets.routes");
const cardsRoutes = require("./modules/cards/cards.routes");
const virtualCardsRoutes = require("./modules/virtual-cards/virtual-cards.routes");
const kycRoutes = require("./modules/kyc/kyc.routes");
const notificationsRoutes = require("./modules/notifications/notifications.routes");
const adminRoutes = require("./modules/admin/admin.routes");
const adminAuthRoutes = require("./modules/admin/admin-auth.routes");
const supportRoutes = require("./modules/support/support.routes");
const qrPaymentsRoutes = require("./modules/qr-payments/qrPayments.routes");
const settingsRoutes = require("./modules/settings/settings.routes");

const app = express();

app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    // No origin header (e.g. server-to-server, curl) is allowed through —
    // browsers always send it for cross-origin requests, which is what
    // this check actually protects against.
    if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);
    callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: "2mb" }));
if (env.nodeEnv !== "test") app.use(morgan(env.nodeEnv === "production" ? "combined" : "dev"));

app.get("/health", (req, res) => res.json({ ok: true, env: env.nodeEnv }));

app.use("/auth", authRoutes);
app.use("/auth/webauthn", webauthnRoutes);
app.use("/push", pushRoutes);
app.use("/admin/institutions", institutionsRoutes);
app.use("/receipts", receiptsRoutes);
app.use("/admin/exchange-rates", exchangeRatesAdminRoutes);
app.use("/admin/fees", feesAdminRoutes);
app.use("/fees", feesRoutes);
app.use("/users", usersRoutes);
app.use("/categories", categoriesRoutes);
app.use("/budgets", budgetsRoutes);
app.use("/transactions", transactionsRoutes);
app.use("/wallets", walletsRoutes);
app.use("/cards", cardsRoutes);
app.use("/virtual-cards", virtualCardsRoutes);
app.use("/kyc", kycRoutes);
app.use("/notifications", notificationsRoutes);
// Order matters: /admin/auth must be mounted before /admin, since
// adminRoutes applies requireAuth+requireAdmin to everything under /admin
// as path-prefix middleware — if /admin were mounted first, an
// unauthenticated request to /admin/auth/login would be intercepted and
// rejected by that gate before ever reaching the login route itself.
app.use("/admin/auth", adminAuthRoutes);
app.use("/admin", adminRoutes);
app.use("/support", supportRoutes);
app.use("/qr", qrPaymentsRoutes);
app.use("/settings", settingsRoutes);

app.use(notFoundHandler);

// Turn Zod validation failures into clean 400s before they hit the generic handler.
app.use((err, req, res, next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "Invalid request", details: err.issues });
  }
  next(err);
});
app.use(errorHandler);

module.exports = app;
