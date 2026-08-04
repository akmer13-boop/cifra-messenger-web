"use client";

type RuntimeError = Error & { digest?: string };

function safeDigest(error: RuntimeError): string | null {
  const digest = error.digest?.trim();
  return digest && /^[A-Za-z0-9._-]{1,128}$/.test(digest) ? digest : null;
}

export default function Error({
  error,
  reset,
}: {
  error: RuntimeError;
  reset: () => void;
}) {
  const digest = safeDigest(error);

  return (
    <main className="runtime-recovery-shell">
      <section className="runtime-recovery-card" role="alert">
        <span className="runtime-recovery-mark" aria-hidden="true">
          C
        </span>
        <p className="runtime-recovery-kicker">CIFRA MESSENGER</p>
        <h1>Не удалось открыть экран</h1>
        <p>
          Интерфейс столкнулся с ошибкой. Повторите попытку; если экран не
          восстановится, безопасно перезагрузите приложение.
        </p>
        {digest ? (
          <p className="runtime-recovery-digest">
            Код для поддержки: <code>{digest}</code>
          </p>
        ) : null}
        <div className="runtime-recovery-actions">
          <button type="button" onClick={reset} autoFocus>
            Повторить
          </button>
          <button type="button" onClick={() => window.location.reload()}>
            Перезагрузить
          </button>
        </div>
      </section>
    </main>
  );
}
