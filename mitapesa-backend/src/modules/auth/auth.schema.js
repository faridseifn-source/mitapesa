const { z } = require("zod");

const registerSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(8), // national number, e.g. "712345678" (no +255 prefix)
  password: z.string().min(8),
  phoneVerifyToken: z.string().min(20).optional(),
  emailVerifyToken: z.string().min(20).optional(),
}).refine((data) => data.phoneVerifyToken || data.emailVerifyToken, {
  message: "Either phoneVerifyToken or emailVerifyToken is required",
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(8),
  newPassword: z.string().min(8),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

module.exports = { registerSchema, loginSchema, refreshSchema, forgotPasswordSchema, resetPasswordSchema, changePasswordSchema };
