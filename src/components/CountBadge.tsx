/** Shared, width-adaptive count. The tooltip keeps the exact value above 999. */
export function CountBadge({ count, label, placement = 'inline' }: {
  count: number;
  label: string;
  placement?: 'inline' | 'navigation';
}) {
  const value = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const description = `${value} ${label}`;
  return <span className={`count-badge count-badge--${placement}`}
    title={description} aria-label={description}>{value > 999 ? '999+' : value}</span>;
}
