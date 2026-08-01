"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import { writeClinicAccessSession } from "../../lib/clinic-access";

export default function LoginPage() {
  const [clinics, setClinics] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedScope, setSelectedScope] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const router = useRouter();

  useEffect(() => {
    supabase
      .from("clinics")
      .select("id, name")
      .order("name", { ascending: true })
      .then(({ data }) => {
        setClinics(((data || []) as Array<{ id: string; name: string }>));
      });
  }, []);

  useEffect(() => {
    if (lockedUntil <= 0) return;
    function tick() {
      const remaining = Math.ceil((lockedUntil - Date.now()) / 1000);
      if (remaining <= 0) {
        setCountdown(0);
        setLockedUntil(0);
        setError("");
        if (timerRef.current) clearInterval(timerRef.current);
      } else {
        setCountdown(remaining);
      }
    }
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [lockedUntil]);

  function formatCountdown(secs: number) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (lockedUntil > Date.now()) return;
    if (!selectedScope) {
      setError("Please choose which clinic will open the POS.");
      return;
    }
    setLoading(true);
    setError("");

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    const data = await res.json();

    if (res.ok) {
      if (selectedScope === "manager") {
        writeClinicAccessSession({
          mode: "manager",
          clinicId: null,
          clinicName: "Manager",
        });
      } else {
        const selectedClinic = clinics.find((clinic) => clinic.id === selectedScope);
        if (!selectedClinic) {
          setError("Please choose a valid clinic.");
          setLoading(false);
          return;
        }
        writeClinicAccessSession({
          mode: "clinic",
          clinicId: selectedClinic.id,
          clinicName: selectedClinic.name,
        });
      }
      router.push("/");
      return;
    }

    if (res.status === 429) {
      setLockedUntil(Date.now() + data.remaining * 1000);
    } else {
      const left = data.attemptsLeft;
      setError(left === 1 ? "Wrong password. 1 attempt left before lockout." : `Wrong password. ${left} attempts left.`);
    }
    setLoading(false);
  }

  const isLocked = lockedUntil > Date.now() && countdown > 0;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="bg-white rounded-xl shadow-md p-8 w-full max-w-sm">
        <h1 className="text-xl font-semibold text-slate-800 mb-1">Skin &amp; Smile</h1>
        <p className="text-sm text-slate-500 mb-6">Choose which clinic will open the POS, then enter the password.</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <select
            value={selectedScope}
            onChange={(e) => setSelectedScope(e.target.value)}
            disabled={isLocked || loading}
            className="w-full border border-slate-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          >
            <option value="">What Clinic will open the POS?</option>
            <option value="manager">Manager</option>
            {clinics.map((clinic) => (
              <option key={clinic.id} value={clinic.id}>
                {clinic.name}
              </option>
            ))}
          </select>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            disabled={isLocked}
            className="w-full border border-slate-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            autoFocus
          />
          {isLocked ? (
            <p className="text-sm text-orange-600 font-medium">
              Too many attempts. Try again in {formatCountdown(countdown)}.
            </p>
          ) : error ? (
            <p className="text-sm text-red-500">{error}</p>
          ) : null}
          <button
            type="submit"
            disabled={loading || isLocked}
            className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Checking..." : "Enter"}
          </button>
        </form>
      </div>
    </div>
  );
}
