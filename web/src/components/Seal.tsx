export function SealMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 1.6c1 0 1.7 1 2.7 1.3 1 .3 2.2-.1 3 .5.9.6 1 1.8 1.6 2.6.6.8 1.8 1.2 2.1 2.2.3 1-.4 2-.4 3.1 0 1 .7 2.1.4 3.1-.3 1-1.5 1.4-2.1 2.2-.6.8-.7 2-1.6 2.6-.8.6-2 .2-3 .5-1 .3-1.7 1.3-2.7 1.3s-1.7-1-2.7-1.3c-1-.3-2.2.1-3-.5-.9-.6-1-1.8-1.6-2.6-.6-.8-1.8-1.2-2.1-2.2-.3-1 .4-2.1.4-3.1 0-1.1-.7-2.1-.4-3.1.3-1 1.5-1.4 2.1-2.2.6-.8.7-2 1.6-2.6.8-.6 2-.2 3-.5 1-.3 1.7-1.3 2.7-1.3Z"
      />
      <path d="M8.2 12.2h7.6M12 8.4v7.6" stroke="var(--paper-raised)" strokeWidth="1.5" strokeLinecap="round" opacity="0.92" />
    </svg>
  );
}

export function Sealed({ label = "Reason sealed" }: { label?: string }) {
  return (
    <span className="sealed">
      <SealMark size={16} />
      {label}
    </span>
  );
}
