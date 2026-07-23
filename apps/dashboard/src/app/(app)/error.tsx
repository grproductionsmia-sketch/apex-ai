'use client';

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md rounded-2xl border border-danger/30 bg-danger/5 p-8 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-danger/40 bg-danger/10 text-danger">
          !
        </div>
        <h1 className="font-display text-lg font-semibold">No se pudo cargar el tablero</h1>
        <p className="mt-2 text-sm text-muted">
          Hubo un problema al leer los datos. No mostramos métricas hasta poder confirmarlas —
          en un centro de mando, un cero falso es peor que un error visible.
        </p>
        <button
          onClick={reset}
          className="mt-5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-background transition hover:opacity-90"
        >
          Reintentar
        </button>
      </div>
    </div>
  );
}
