export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return 'hace instantes';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs} h`;
  const days = Math.floor(hrs / 24);
  return `hace ${days} d`;
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

const CLASSIFICATION_LABELS: Record<string, string> = {
  product_buyer: 'Compra producto',
  business_interested: 'Interés negocio',
  curious: 'Curioso',
  unknown: 'Sin clasificar',
};
export function classificationLabel(c: string): string {
  return CLASSIFICATION_LABELS[c] ?? c;
}

const CONTENT_STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador',
  pending_compliance: 'Pendiente compliance',
  approved: 'Aprobado',
  rejected: 'Rechazado',
  published: 'Publicado',
};
export function contentStatusLabel(s: string): string {
  return CONTENT_STATUS_LABELS[s] ?? s;
}
