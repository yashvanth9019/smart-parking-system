"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { useApp } from "@/context/AppContext";

export default function AdminLoginPage() {
  const router = useRouter();
  const { setSession, pushToast } = useApp();
  const [email, setEmail] = useState("admin@smartpark.io");
  const [password, setPassword] = useState("Admin@123");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.adminLogin({ email, password });
      setSession(res.access_token, res.user);
      pushToast("Admin Authenticated", `Welcome, ${res.user.name}`, "success");
      router.push("/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid admin credentials");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100 p-4">
      <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-7 shadow-2xl space-y-6">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center mx-auto shadow-lg shadow-indigo-500/25">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Admin Command Login</h1>
          <p className="text-xs text-slate-400">Authorized SmartPark RTD operations access only</p>
        </div>

        {error && (
          <div className="rounded-xl bg-rose-500/10 border border-rose-500/40 p-3 text-xs text-rose-400 font-medium">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">Admin Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-700 bg-slate-800 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-700 bg-slate-800 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Sign In to Admin Dashboard
          </button>
        </form>

        <div className="rounded-xl bg-slate-800/80 p-3 text-xs text-slate-300 space-y-1">
          <div className="font-semibold">Demo Admin Credentials:</div>
          <div>Email: <code>admin@smartpark.io</code> | Password: <code>Admin@123</code></div>
        </div>

        <div className="text-center text-xs">
          <Link href="/" className="text-slate-400 hover:text-white hover:underline">
            Return to Public Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

