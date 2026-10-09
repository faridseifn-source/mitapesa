import { useState } from "react";
import { ShieldCheck, ArrowLeft } from "lucide-react";
import { adminApi } from "../api.js";
import { Button, Input, Card } from "../components/ui.jsx";

export default function LoginPage({ onLoggedIn }) {
  const [step, setStep] = useState("password"); // password | code
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submitPassword = async (e) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const { challengeId } = await adminApi.auth.login(email, password);
      setChallengeId(challengeId);
      setStep("code");
    } catch (err) {
      setError(err.message || "Couldn't sign in.");
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const { user } = await adminApi.auth.verify(challengeId, code);
      onLoggedIn(user);
    } catch (err) {
      setError(err.message || "Incorrect code.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-ink px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-accent flex items-center justify-center mb-4">
            <ShieldCheck size={24} color="#fff" />
          </div>
          <p className="text-white font-display font-bold text-[20px]">MitaPesa Admin</p>
          <p className="text-white/50 text-[13px] mt-1">Restricted access — every sign-in is logged</p>
        </div>

        <Card className="p-7">
          {step === "password" ? (
            <form onSubmit={submitPassword}>
              <p className="text-[13px] font-semibold text-ink mb-4">Sign in</p>
              <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Email</label>
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@dugapay.com" className="mb-4" autoFocus />
              <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Password</label>
              <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="mb-5" />
              {error && <p className="text-[12.5px] text-danger mb-4">{error}</p>}
              <Button type="submit" variant="accent" disabled={busy} className="w-full">{busy ? "Checking…" : "Continue"}</Button>
            </form>
          ) : (
            <form onSubmit={submitCode}>
              <button type="button" onClick={() => { setStep("password"); setCode(""); setError(""); }} className="flex items-center gap-1 text-[12px] text-inkFaint mb-4 hover:text-inkSoft">
                <ArrowLeft size={13} /> Back
              </button>
              <p className="text-[13px] font-semibold text-ink mb-1.5">Enter your login code</p>
              <p className="text-[12.5px] text-inkFaint mb-4">We sent a 6-digit code to {email}. It expires in 10 minutes.</p>
              <Input
                inputMode="numeric" maxLength={6} required value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000" className="mb-5 text-center text-[20px] font-mono tracking-[6px]" autoFocus
              />
              {error && <p className="text-[12.5px] text-danger mb-4">{error}</p>}
              <Button type="submit" variant="accent" disabled={busy || code.length !== 6} className="w-full">{busy ? "Verifying…" : "Sign in"}</Button>
            </form>
          )}
        </Card>

        <p className="text-white/30 text-[11.5px] text-center mt-6">Sessions expire automatically after 8 hours of use.</p>
      </div>
    </div>
  );
}
