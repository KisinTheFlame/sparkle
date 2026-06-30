import { useCallback, useEffect, useState } from "react";
import type { AuthStatus, AuthStatusResponse } from "@sparkle/shared/schemas/auth";
import { fetchClaudeCodeStatus, logoutClaudeCode, startClaudeCodeLogin } from "@/lib/auth-api";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 11 * 60 * 1000;

const STATUS_LABEL: Record<AuthStatus, string> = {
  active: "已登录",
  expired: "已过期",
  refresh_failed: "刷新失败",
  logged_out: "已登出",
  unavailable: "未登录",
};

const STATUS_COLOR: Record<AuthStatus, string> = {
  active: "bg-emerald-500",
  expired: "bg-amber-500",
  refresh_failed: "bg-red-500",
  logged_out: "bg-slate-400",
  unavailable: "bg-slate-400",
};

export function ClaudeCodeLoginPanel() {
  const [status, setStatus] = useState<AuthStatusResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<AuthStatusResponse | null> => {
    try {
      const next = await fetchClaudeCodeStatus();
      setStatus(next);
      if (next.isLoggedIn) {
        setPolling(false);
      }
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next = await fetchClaudeCodeStatus();
        if (active) {
          setStatus(next);
        }
      } catch (e) {
        if (active) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!polling) {
      return;
    }
    const interval = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    const stop = setTimeout(() => setPolling(false), POLL_TIMEOUT_MS);
    return () => {
      clearInterval(interval);
      clearTimeout(stop);
    };
  }, [polling, refresh]);

  const onLogin = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { loginUrl } = await startClaudeCodeLogin();
      window.open(loginUrl, "_blank", "noopener,noreferrer");
      setPolling(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const onLogout = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await logoutClaudeCode();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const currentStatus: AuthStatus = status?.status ?? "unavailable";
  const isLoggedIn = status?.isLoggedIn ?? false;

  return (
    <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <header className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Claude Code 登录</h2>
        <span className="inline-flex items-center gap-2 text-sm text-slate-600">
          <span className={`h-2.5 w-2.5 rounded-full ${STATUS_COLOR[currentStatus]}`} />
          {STATUS_LABEL[currentStatus]}
        </span>
      </header>

      {status?.session?.email ? (
        <p className="mb-4 text-sm text-slate-500">账号：{status.session.email}</p>
      ) : (
        <p className="mb-4 text-sm text-slate-500">尚未关联 Claude 账号。</p>
      )}

      <div className="flex gap-2">
        {isLoggedIn ? (
          <button
            type="button"
            onClick={() => void onLogout()}
            disabled={busy}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
          >
            登出
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void onLogin()}
            disabled={busy || polling}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {polling ? "等待授权中…" : "登录"}
          </button>
        )}
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busy}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
        >
          刷新
        </button>
      </div>

      {polling && (
        <p className="mt-3 text-xs text-slate-500">
          已在新标签页打开 Claude 授权页；完成授权后本面板会自动更新。
        </p>
      )}

      {error && <p className="mt-3 text-xs text-red-500">错误：{error}</p>}
    </section>
  );
}
